import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { CredentialDiagnosticsService } from "../electron/main/credential-diagnostics-service.js";
import { DatabaseService } from "../electron/main/database-service.js";
import { GitHubApiError, type GitHubClient } from "../electron/main/github-client.js";
import { IdentityService } from "../electron/main/identity-service.js";

const execFileAsync = promisify(execFile);

class MockGitHub {
  mode: "ok" | "revoked" | "scope" | "sso" | "rate" | "network" = "ok";
  scopes = ["repo", "read:user"];

  async get(pathname: string): Promise<unknown> {
    if (pathname === "/user") {
      if (this.mode === "revoked") throw new GitHubApiError(401, "Unauthorized", "Bad credentials");
      if (this.mode === "rate")
        throw new GitHubApiError(429, "Too Many Requests", "API rate limit exceeded", { remaining: 0, resetAt: null });
      if (this.mode === "network") throw new TypeError("fetch failed");
      return { login: "mona" };
    }
    if (pathname.startsWith("/repos/")) {
      if (this.mode === "scope") {
        throw new GitHubApiError(403, "Forbidden", "Resource not accessible by token", null, {
          "x-accepted-oauth-scopes": "repo"
        });
      }
      if (this.mode === "sso") {
        throw new GitHubApiError(403, "Forbidden", "Resource protected by organization SSO", null, {
          "x-github-sso": "required; url=https://github.com/orgs/octo/sso"
        });
      }
      return { permissions: { pull: true, push: false, admin: false } };
    }
    return {};
  }

  getOAuthScopes(): string[] {
    return this.scopes;
  }
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-credential-diagnostics-test-"));
const repoPath = path.join(tempDir, "repo");
const missingRepoPath = path.join(tempDir, "not-a-repo");
const database = new DatabaseService(path.join(tempDir, "fallback.sqlite"));
const github = new MockGitHub();
const identity = new IdentityService(database);
const diagnostics = new CredentialDiagnosticsService(database, github as unknown as GitHubClient, identity);

try {
  await git(tempDir, ["init", "-b", "main", "repo"]);
  await git(repoPath, ["config", "user.email", "mona@example.com"]);
  await git(repoPath, ["config", "user.name", "Mona"]);
  await git(repoPath, ["config", "commit.gpgsign", "false"]);
  await git(repoPath, ["remote", "add", "origin", "https://127.0.0.1:1/octo/repo.git"]);
  await writeFile(path.join(repoPath, "README.md"), "hello\n");
  await git(repoPath, ["add", "README.md"]);
  await git(repoPath, ["commit", "-m", "initial"]);

  database.db
    .prepare(
      `INSERT INTO repos (
        id, github_repo_id, owner, name, full_name, is_private, default_branch, html_url,
        workspace_path, local_path, watch_mode, clone_enabled, clone_status, watch_enabled,
        sync_status, created_at, updated_at
      )
      VALUES ('octo-repo', 1, 'octo', 'repo', 'octo/repo', 1, 'main', 'https://github.com/octo/repo',
        ?, ?, 'cloned', 1, 'cloned', 1, 'fresh', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    )
    .run(tempDir, repoPath);
  database.db
    .prepare(
      `INSERT INTO repos (
        id, github_repo_id, owner, name, full_name, is_private, default_branch, html_url,
        workspace_path, local_path, watch_mode, clone_enabled, clone_status, watch_enabled,
        sync_status, created_at, updated_at
      )
      VALUES ('missing-local', 2, 'octo', 'missing', 'octo/missing', 0, 'main', 'https://github.com/octo/missing',
        ?, ?, 'cloned', 1, 'cloned', 1, 'fresh', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    )
    .run(tempDir, missingRepoPath);
  const account = database.localCache.accounts.upsertGitHubAccount({
    id: "42",
    login: "mona",
    avatarUrl: null,
    name: "Mona",
    tokenScopes: ["repo", "read:user"]
  });
  database.localCache.accounts.setActiveGitHubAccount(account.id);

  let report = await diagnostics.check("octo-repo");
  assert.equal(report.results.find((result) => result.surface === "api")?.status, "ok");
  assert.equal(report.results.find((result) => result.surface === "signing")?.summary, "Commit signing is off.");
  assert.match(report.results.find((result) => result.surface === "api")?.detail ?? "", /Token scopes: repo read:user/);
  assert.equal(report.results.find((result) => result.surface === "https_remote")?.status, "failed");

  github.mode = "revoked";
  report = await diagnostics.check("octo-repo");
  assert.equal(report.results.find((result) => result.surface === "api")?.summary, "GitHub token is expired or revoked.");

  github.mode = "scope";
  report = await diagnostics.check("octo-repo");
  assert.equal(
    report.results.find((result) => result.surface === "repo_permission")?.summary,
    "GitHub token is missing required permissions."
  );

  github.mode = "sso";
  report = await diagnostics.check("octo-repo");
  assert.equal(report.results.find((result) => result.surface === "sso")?.status, "failed");

  github.mode = "rate";
  report = await diagnostics.check("octo-repo");
  assert.equal(report.results.find((result) => result.surface === "api")?.status, "warning");

  github.mode = "network";
  report = await diagnostics.check("octo-repo");
  assert.equal(report.results.find((result) => result.surface === "network")?.summary, "Network connectivity failed.");

  github.mode = "ok";
  github.scopes = ["read:user"];
  report = await diagnostics.check("octo-repo");
  assert.equal(
    report.results.find((result) => result.surface === "repo_permission")?.summary,
    "Token scope is insufficient for private repositories."
  );

  const missingGit = new CredentialDiagnosticsService(database, github as unknown as GitHubClient, identity, {
    gitCommand: "__fallback_missing_git__"
  });
  report = await missingGit.check("octo-repo");
  assert.equal(report.results.find((result) => result.surface === "git_binary")?.status, "failed");

  report = await diagnostics.check("missing-local");
  assert.equal(report.results.find((result) => result.surface === "local_identity")?.summary, "Local path is not a Git repository.");

  assert.ok(database.localCache.diagnostics.credentialDiagnosticEvents().some((event) => event.code === "credential_https_remote_failed"));
  assert.ok(database.localCache.diagnostics.credentialDiagnosticEvents().some((event) => event.code === "credential_signing_metadata"));
} finally {
  database.close();
  await rm(tempDir, { force: true, recursive: true });
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

console.log("Credential diagnostics tests ok");
