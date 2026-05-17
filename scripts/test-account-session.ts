import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AuthService } from "../electron/main/auth-service.js";
import { CacheService } from "../electron/main/cache-service.js";
import { DatabaseService } from "../electron/main/database-service.js";
import { GitHubClient } from "../electron/main/github-client.js";
import { SettingsService } from "../electron/main/settings-service.js";
import { accountTokenKey, TokenService, type SecureTokenStore } from "../electron/main/token-service.js";
import { WorkspaceService } from "../electron/main/workspace-service.js";

class MemorySecureStore implements SecureTokenStore {
  readonly values = new Map<string, string>();

  async getPassword(service: string, account: string): Promise<string | null> {
    return this.values.get(`${service}:${account}`) ?? null;
  }

  async setPassword(service: string, account: string, password: string): Promise<void> {
    this.values.set(`${service}:${account}`, password);
  }

  async deletePassword(service: string, account: string): Promise<boolean> {
    return this.values.delete(`${service}:${account}`);
  }
}

const originalFetch = globalThis.fetch;
const originalGitHubToken = process.env.GITHUB_TOKEN;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-account-session-test-"));
const settings = new SettingsService();
settings.update({ workspacePath: tempDir });
const database = new DatabaseService(settings.databasePath());
const workspace = new WorkspaceService(() => settings.get());
const secureStore = new MemorySecureStore();
const tokenService = new TokenService(secureStore);
const secretToken = "fake-token-for-account-session";

try {
  delete process.env.GITHUB_TOKEN;
  await tokenService.setToken("legacy-token");
  const legacyAccount = database.localCache.accounts.upsertGitHubAccount({
    id: 1,
    login: "mona",
    endpoint: "https://api.github.com",
    avatarUrl: null,
    tokenSource: null
  });
  assert.equal(await tokenService.migrateLegacyToken(legacyAccount), true);
  assert.equal(await tokenService.getToken(legacyAccount), "legacy-token");
  assert.equal(await secureStore.getPassword("Fallback", "github-oauth-token"), null);
  assert.equal(await secureStore.getPassword("Fallback", accountTokenKey(legacyAccount)), "legacy-token");

  globalThis.fetch = async (input, init) => {
    if (String(input) === "https://api.github.com/user") {
      const authorization = new Headers(init?.headers as HeadersInit).get("authorization");
      if (authorization !== `Bearer ${secretToken}`) {
        return new Response(JSON.stringify({ message: "Bad credentials" }), {
          status: 401,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(
        JSON.stringify({
          id: 1,
          login: "mona",
          avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
          html_url: "https://github.com/mona",
          name: "Mona Lisa",
          type: "User"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    throw new Error(`Unexpected fetch ${String(input)}`);
  };

  const auth = new AuthService(
    tokenService,
    new GitHubClient(() => tokenService.getToken(database.localCache.accounts.getGitHubAccount())),
    database,
    undefined,
    workspace
  );
  await auth.connectGitHub(secretToken);
  const account = database.localCache.accounts.getGitHubAccount();
  assert.ok(account);
  assert.equal(account.login, "mona");
  assert.equal(account.endpoint, "https://api.github.com");
  assert.equal(account.tokenSource, "keychain");
  assert.deepEqual(account.tokenScopes, ["repo", "read:user", "read:org"]);
  assert.ok(account.lastValidatedAt);
  assert.equal(await tokenService.getToken(account), secretToken);

  const appStyleAuth = new AuthService(tokenService, new GitHubClient(() => tokenService.getToken()), database);
  const appStyleAuthState = await appStyleAuth.validateCurrentAccount();
  assert.equal(appStyleAuthState.status, "connected");
  assert.equal(database.localCache.accounts.getGitHubAccountById(account.id)?.authStatus, "connected");

  const accountRows = database.db.prepare("SELECT * FROM accounts").all();
  assert.equal(JSON.stringify(accountRows).includes(secretToken), false);

  const other = database.localCache.accounts.upsertGitHubAccount({
    id: 2,
    login: "octo",
    endpoint: "https://api.github.com",
    avatarUrl: null,
    tokenSource: "keychain"
  });
  await tokenService.setToken("other-token", other);
  const renamed = auth.renameProfile(other.id, "Personal");
  assert.equal(renamed.profileName, "Personal");
  const colored = auth.updateProfileColor(other.id, "green");
  assert.equal(colored.profileColor, "green");
  await auth.selectAccount(other.id);
  assert.equal(database.localCache.accounts.getGitHubAccount()?.id, other.id);
  const missingTokenAccount = database.localCache.accounts.upsertGitHubAccount({
    id: 3,
    login: "missing-token",
    endpoint: "https://api.github.com",
    avatarUrl: null,
    tokenSource: "keychain"
  });
  await assert.rejects(() => auth.selectAccount(missingTokenAccount.id), /No token is available/);
  assert.equal(database.localCache.accounts.getGitHubAccount()?.id, other.id);

  const timestamp = new Date().toISOString();
  database.db
    .prepare(
      `INSERT INTO repos (
         id, github_repo_id, owner, name, full_name, is_private, is_fork, watch_enabled, sync_status, created_at, updated_at
       ) VALUES
         ('work-repo', 100, 'work', 'app', 'work/app', 1, 0, 1, 'fresh', ?, ?),
         ('personal-repo', 101, 'mona', 'notes', 'mona/notes', 0, 0, 1, 'fresh', ?, ?),
         ('shared-repo', 102, 'octo', 'shared', 'octo/shared', 0, 0, 1, 'fresh', ?, ?)`
    )
    .run(timestamp, timestamp, timestamp, timestamp, timestamp, timestamp);
  database.localCache.repoAccounts.associateRepoAccount("work-repo", account, { pull: true, push: true }, { watchEnabled: true });
  database.localCache.repoAccounts.associateRepoAccount("shared-repo", account, { pull: true, push: true }, { watchEnabled: true });
  database.localCache.repoAccounts.associateRepoAccount("personal-repo", other, { pull: true, push: true }, { watchEnabled: true });
  database.localCache.repoAccounts.associateRepoAccount("shared-repo", other, { pull: true, push: false }, { watchEnabled: true });
  database.localCache.repoAccounts.associateRepoAccount("work-repo", other, { pull: true, push: false });
  const workPath = workspace.ensureRepoFolder("work", "app", "cloned");
  const personalPath = workspace.ensureRepoFolder("mona", "notes", "cloned");
  const sharedPath = workspace.ensureRepoFolder("octo", "shared", "cloned");
  await writeFile(path.join(workPath, "work.txt"), "work\n");
  await writeFile(path.join(personalPath, "personal.txt"), "personal\n");
  await writeFile(path.join(sharedPath, "shared.txt"), "shared\n");
  database.db.prepare("UPDATE repos SET local_path = ? WHERE id = ?").run(workPath, "work-repo");
  database.db.prepare("UPDATE repos SET local_path = ? WHERE id = ?").run(personalPath, "personal-repo");
  database.db.prepare("UPDATE repos SET local_path = ? WHERE id = ?").run(sharedPath, "shared-repo");
  database.localCache.repoAccounts.setRepoAccountSyncState("shared-repo", other.id, "queued", null);
  let repoAccountState = database.db
    .prepare(
      "SELECT sync_status, sync_error, last_synced_at, last_successful_sync_at FROM repo_accounts WHERE repo_id = ? AND account_id = ?"
    )
    .get("shared-repo", other.id) as
    | { sync_status: string | null; sync_error: string | null; last_synced_at: string | null; last_successful_sync_at: string | null }
    | undefined;
  assert.equal(repoAccountState?.sync_status, "queued");
  assert.ok(repoAccountState?.last_synced_at);
  assert.equal(repoAccountState?.last_successful_sync_at, null);
  database.localCache.repoAccounts.setRepoAccountSyncState("shared-repo", other.id, "fresh", null, timestamp);
  repoAccountState = database.db
    .prepare(
      "SELECT sync_status, sync_error, last_synced_at, last_successful_sync_at FROM repo_accounts WHERE repo_id = ? AND account_id = ?"
    )
    .get("shared-repo", other.id) as
    | { sync_status: string | null; sync_error: string | null; last_synced_at: string | null; last_successful_sync_at: string | null }
    | undefined;
  assert.equal(repoAccountState?.sync_status, "fresh");
  assert.equal(repoAccountState?.last_successful_sync_at, timestamp);

  database.db
    .prepare(
      `INSERT INTO search_index (
         entity_id, repo_id, entity_type, entity_number, title, body, author_login, state, labels, created_at, updated_at
       ) VALUES
         ('work-issue', 'work-repo', 'issue', 1, 'Work-only incident', 'secret work body', 'mona', 'open', '', ?, ?),
         ('personal-issue', 'personal-repo', 'issue', 2, 'Personal notes', 'personal body', 'octo', 'open', '', ?, ?),
         ('shared-issue', 'shared-repo', 'issue', 3, 'Shared context', 'shared body', 'mona', 'open', '', ?, ?)`
    )
    .run(timestamp, timestamp, timestamp, timestamp, timestamp, timestamp);

  await auth.selectAccount(account.id);
  assert.deepEqual(
    database.localCache.repos
      .listWatchedReposForActiveAccount()
      .map((repo) => repo.id)
      .sort(),
    ["shared-repo", "work-repo"]
  );
  assert.deepEqual(
    database.localCache.searchIndex
      .searchForActiveAccount("body")
      .map((item) => item.repoId)
      .sort(),
    ["shared-repo", "work-repo"]
  );
  const workSyncJob = database.localCache.syncJobs.createSyncJob("work-repo", "repo_sync");
  assert.equal(workSyncJob.accountId, account.id);
  await auth.disconnectGitHub();
  assert.equal(existsSync(workPath), true, "expected disconnect to preserve the active profile's repo folder");
  await auth.connectGitHub(secretToken);
  assert.deepEqual(
    database.localCache.repos
      .listWatchedReposForActiveAccount()
      .map((repo) => repo.id)
      .sort(),
    ["shared-repo", "work-repo"]
  );
  assert.equal(existsSync(workPath), true, "expected reconnect to keep the active profile's repo folder");

  await auth.selectAccount(other.id);
  assert.deepEqual(
    database.localCache.repos
      .listWatchedReposForActiveAccount()
      .map((repo) => repo.id)
      .sort(),
    ["personal-repo", "shared-repo"]
  );
  assert.deepEqual(
    database.localCache.searchIndex
      .searchForActiveAccount("body")
      .map((item) => item.repoId)
      .sort(),
    ["personal-repo", "shared-repo"]
  );
  assert.equal(database.localCache.repos.repoIsVisibleToAccount("work-repo", other.id), false);
  assert.throws(
    () => database.localCache.repos.requireRepoVisibleToActiveAccount("work-repo"),
    /not available in the active GitHub profile/
  );
  database.localCache.repos.unwatchRepo("shared-repo");
  assert.deepEqual(
    database.localCache.repos
      .listWatchedReposForActiveAccount()
      .map((repo) => repo.id)
      .sort(),
    ["personal-repo"]
  );
  assert.equal(database.localCache.repos.repoIsVisibleToAccount("shared-repo", account.id), true);

  await auth.deleteAccount(other.id);
  assert.equal(await tokenService.getToken(other), undefined);
  assert.equal(await tokenService.getToken(account), secretToken);
  assert.equal(database.localCache.accounts.getGitHubAccount()?.id, account.id);
  assert.equal(existsSync(personalPath), false, "expected unique profile repo folder to be removed with the profile");
  assert.equal(existsSync(sharedPath), true, "expected shared repo folder to remain for the surviving profile");
  assert.equal(existsSync(workPath), true, "expected surviving profile repo folder to remain");

  const cache = new CacheService(database, settings, workspace);
  const redacted = await readFile(cache.exportDiagnostics().path, "utf8");
  const sensitive = await readFile(cache.exportDiagnostics(true).path, "utf8");
  assert.equal(redacted.includes(secretToken), false);
  assert.equal(sensitive.includes(secretToken), false);

  await auth.deleteAllAccounts();
  assert.equal(database.localCache.accounts.listGitHubAccounts().length, 0);
  assert.equal(await tokenService.getToken(account), undefined);
  assert.equal(existsSync(workPath), false, "expected all account removal to remove remaining managed repo folders");
  assert.equal(existsSync(sharedPath), false, "expected all account removal to remove shared managed repo folders");

  console.log("Account session tests ok");
} finally {
  globalThis.fetch = originalFetch;
  if (originalGitHubToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = originalGitHubToken;
  database.close();
  await rm(tempDir, { force: true, recursive: true });
}
