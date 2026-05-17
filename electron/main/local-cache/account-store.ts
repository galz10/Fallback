import type { GitHubAccountSession } from "../../../src/shared/domain/auth.js";
import { nowIso } from "../path-utils.js";
import { LocalCacheStoreBase } from "./store-base.js";
import { githubAccountRowId, mapGitHubAccount, normalizeGitHubEndpoint } from "./store-helpers.js";
import type { GitHubAccountInput } from "./store-types.js";

export class AccountStore extends LocalCacheStoreBase {
  getGitHubAccount(): GitHubAccountSession | null {
    const activeAccountId = this.getAppMetadata("active_github_account_id");
    if (activeAccountId) {
      const active = this.getGitHubAccountById(activeAccountId);
      if (active) return active;
      this.setAppMetadata("active_github_account_id", "");
    }

    const row = this.db
      .prepare(
        `SELECT *
         FROM accounts
         WHERE github_user_id IS NOT NULL
           AND COALESCE(profile_hidden, 0) = 0
         ORDER BY CASE auth_status WHEN 'connected' THEN 0 ELSE 1 END, updated_at DESC
         LIMIT 1`
      )
      .get() as Record<string, unknown> | undefined;
    return row ? mapGitHubAccount(row) : null;
  }

  listGitHubAccounts(): GitHubAccountSession[] {
    const activeAccountId = this.getAppMetadata("active_github_account_id");
    return (
      this.db
        .prepare(
          `SELECT *
           FROM accounts
           WHERE github_user_id IS NOT NULL
             AND COALESCE(profile_hidden, 0) = 0
           ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, CASE auth_status WHEN 'connected' THEN 0 ELSE 1 END, updated_at DESC`
        )
        .all(activeAccountId ?? "") as Record<string, unknown>[]
    ).map(mapGitHubAccount);
  }

  upsertGitHubAccount(input: GitHubAccountInput): GitHubAccountSession {
    const timestamp = nowIso();
    const githubUserId = String(input.id);
    const endpoint = normalizeGitHubEndpoint(input.endpoint);
    const accountId = githubAccountRowId(endpoint, githubUserId);
    const lastValidatedAt = input.lastValidatedAt === undefined ? timestamp : input.lastValidatedAt;
    this.migrateLegacyGitHubAccountId(githubUserId, accountId, endpoint);
    this.db
      .prepare(
        `INSERT INTO accounts (
           id, github_user_id, github_login, github_avatar_url, github_avatar_cached_url, github_endpoint, github_html_url,
           github_name, github_account_type, profile_name, profile_color, token_source, token_scopes, auth_status, last_validated_at,
           created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           github_user_id = excluded.github_user_id,
           github_login = excluded.github_login,
           github_avatar_url = excluded.github_avatar_url,
           github_avatar_cached_url = COALESCE(excluded.github_avatar_cached_url, accounts.github_avatar_cached_url),
           github_endpoint = excluded.github_endpoint,
           github_html_url = excluded.github_html_url,
           github_name = excluded.github_name,
           github_account_type = excluded.github_account_type,
           profile_name = COALESCE(excluded.profile_name, accounts.profile_name),
           profile_color = COALESCE(excluded.profile_color, accounts.profile_color),
           profile_hidden = 0,
           token_source = COALESCE(excluded.token_source, accounts.token_source),
           token_scopes = COALESCE(excluded.token_scopes, accounts.token_scopes),
           auth_status = excluded.auth_status,
           last_validated_at = COALESCE(excluded.last_validated_at, accounts.last_validated_at),
           updated_at = excluded.updated_at`
      )
      .run(
        accountId,
        githubUserId,
        input.login,
        input.avatarUrl,
        input.avatarCachedUrl ?? null,
        endpoint,
        input.htmlUrl ?? null,
        input.name ?? null,
        input.accountType ?? null,
        input.profileName ?? null,
        input.profileColor ?? null,
        input.tokenSource ?? null,
        input.tokenScopes ? input.tokenScopes.join(",") : null,
        input.authStatus ?? "connected",
        lastValidatedAt,
        timestamp,
        timestamp
      );
    return this.getGitHubAccountById(accountId)!;
  }

  setGitHubAccountAvatarCache(accountId: string, cachedUrl: string | null): GitHubAccountSession | null {
    this.db.prepare("UPDATE accounts SET github_avatar_cached_url = ?, updated_at = ? WHERE id = ?").run(cachedUrl, nowIso(), accountId);
    return this.getGitHubAccountById(accountId);
  }

  migrateLegacyGitHubAccountId(githubUserId: string, nextAccountId: string, endpoint: string): void {
    const legacyAccountId = `github:${githubUserId}`;
    if (legacyAccountId === nextAccountId) return;
    const legacy = this.db.prepare("SELECT id FROM accounts WHERE id = ?").get(legacyAccountId);
    const next = this.db.prepare("SELECT id FROM accounts WHERE id = ?").get(nextAccountId);
    if (!legacy || next) return;
    this.db
      .prepare("UPDATE accounts SET id = ?, github_endpoint = ?, updated_at = ? WHERE id = ?")
      .run(nextAccountId, endpoint, nowIso(), legacyAccountId);
  }

  getGitHubAccountById(accountId: string): GitHubAccountSession | null {
    const row = this.db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId) as Record<string, unknown> | undefined;
    return row ? mapGitHubAccount(row) : null;
  }

  setActiveGitHubAccount(accountId: string | null): GitHubAccountSession | null {
    if (!accountId) {
      this.setAppMetadata("active_github_account_id", "");
      return null;
    }
    const account = this.getGitHubAccountById(accountId);
    if (!account) throw new Error("GitHub account not found.");
    this.setAppMetadata("active_github_account_id", account.id);
    this.db.prepare("UPDATE accounts SET profile_last_selected_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), account.id);
    return this.getGitHubAccountById(account.id);
  }

  updateGitHubProfile(accountId: string, input: { profileName?: string | null; profileColor?: string | null }): GitHubAccountSession {
    const current = this.getGitHubAccountById(accountId);
    if (!current) throw new Error("GitHub profile not found.");
    const profileName =
      input.profileName === undefined ? current.profileName : input.profileName?.trim() ? input.profileName.trim().slice(0, 80) : null;
    const profileColor =
      input.profileColor === undefined ? current.profileColor : input.profileColor?.trim() ? input.profileColor.trim().slice(0, 24) : null;
    this.db
      .prepare("UPDATE accounts SET profile_name = ?, profile_color = ?, updated_at = ? WHERE id = ?")
      .run(profileName, profileColor, nowIso(), accountId);
    return this.getGitHubAccountById(accountId)!;
  }

  listRepoFoldersUniquelyWatchedByAccount(accountId: string): Array<{ owner: string; name: string; localPath: string | null }> {
    return this.db
      .prepare(
        `SELECT r.owner, r.name, r.local_path AS localPath
         FROM repos r
         JOIN repo_accounts target ON target.repo_id = r.id
         WHERE target.account_id = ?
           AND target.watch_enabled = 1
           AND NOT EXISTS (
             SELECT 1
             FROM repo_accounts other
             WHERE other.repo_id = r.id
               AND other.account_id != ?
               AND other.watch_enabled = 1
           )`
      )
      .all(accountId, accountId) as Array<{ owner: string; name: string; localPath: string | null }>;
  }

  deleteGitHubAccount(accountId: string): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM repo_accounts WHERE account_id = ?").run(accountId);
      this.reconcileGlobalRepoWatchStates();
      this.db.prepare("DELETE FROM accounts WHERE id = ?").run(accountId);
      if (this.getAppMetadata("active_github_account_id") === accountId) {
        const next = this.listGitHubAccounts()[0] ?? null;
        this.setAppMetadata("active_github_account_id", next?.id ?? "");
      }
    })();
  }

  deleteAllGitHubAccounts(): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM repo_accounts").run();
      this.db.prepare("UPDATE repos SET watch_enabled = 0, sync_status = 'stale', updated_at = ? WHERE watch_enabled = 1").run(nowIso());
      this.db.prepare("DELETE FROM accounts").run();
      this.setAppMetadata("active_github_account_id", "");
    })();
  }

  setGitHubAccountTokenSource(accountId: string, tokenSource: "environment" | "keychain" | null): void {
    this.db.prepare("UPDATE accounts SET token_source = ?, updated_at = ? WHERE id = ?").run(tokenSource, nowIso(), accountId);
  }

  setGitHubAccountAuthState(
    accountId: string,
    input: {
      authStatus: GitHubAccountSession["authStatus"];
      tokenScopes?: string[];
      lastValidatedAt?: string | null;
    }
  ): void {
    this.db
      .prepare(
        `UPDATE accounts
         SET auth_status = ?,
             token_scopes = COALESCE(?, token_scopes),
             last_validated_at = COALESCE(?, last_validated_at),
             updated_at = ?
         WHERE id = ?`
      )
      .run(input.authStatus, input.tokenScopes ? input.tokenScopes.join(",") : null, input.lastValidatedAt ?? null, nowIso(), accountId);
  }

  setCurrentGitHubAccountAuthState(input: {
    authStatus: GitHubAccountSession["authStatus"];
    tokenScopes?: string[];
    lastValidatedAt?: string | null;
  }): void {
    const account = this.getGitHubAccount();
    if (account) this.setGitHubAccountAuthState(account.id, input);
  }
}
