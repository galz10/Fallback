import assert from "node:assert/strict";
import { AuthService } from "../electron/main/auth-service.js";
import { DatabaseService } from "../electron/main/database-service.js";
import { classifyAuthFailure } from "../electron/main/error-classification.js";
import { GitHubApiError, GitHubClient } from "../electron/main/github-client.js";
import type { TokenService } from "../electron/main/token-service.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const resetAt = "2030-01-01T00:00:00.000Z";

assert.equal(classifyAuthFailure(new GitHubApiError(401, "Unauthorized", "Bad credentials"))?.status, "revoked");
assert.equal(classifyAuthFailure(new GitHubApiError(401, "Unauthorized", "Token expired"))?.status, "expired");
assert.equal(classifyAuthFailure(new TypeError("fetch failed")), null);
assert.equal(
  classifyAuthFailure(new GitHubApiError(401, "Unauthorized", "One-time password required", null, { "x-github-otp": "required; app" }))
    ?.status,
  "unknown_error"
);
assert.equal(
  classifyAuthFailure(
    new GitHubApiError(403, "Forbidden", JSON.stringify({ message: "Resource protected by organization SAML enforcement" }))
  )?.status,
  "org_sso_required"
);
assert.equal(
  classifyAuthFailure(
    new GitHubApiError(403, "Forbidden", JSON.stringify({ message: "Requires authentication" }), null, {
      "x-accepted-oauth-scopes": "repo"
    })
  )?.status,
  "insufficient_scope"
);
const rateLimitFailure = classifyAuthFailure(new GitHubApiError(403, "Forbidden", "API rate limit exceeded", { remaining: 0, resetAt }));
assert.equal(rateLimitFailure?.status, "rate_limited");
assert.equal(rateLimitFailure?.resetAt, resetAt);
assert.match(rateLimitFailure?.message ?? "", /rate limit/i);
assert.equal(classifyAuthFailure(new GitHubApiError(429, "Too Many Requests", "slow down"))?.status, "rate_limited");

const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-auth-classification-"));
const database = new DatabaseService(path.join(tempDir, "fallback.db"));

try {
  const account = database.localCache.accounts.upsertGitHubAccount({
    id: 42,
    login: "mona",
    endpoint: "https://api.github.com",
    htmlUrl: "https://github.com/mona",
    avatarUrl: null,
    name: null,
    accountType: "User",
    tokenSource: "keychain",
    tokenScopes: ["repo"],
    authStatus: "connected",
    lastValidatedAt: "2026-01-01T00:00:00.000Z"
  });
  database.localCache.accounts.setActiveGitHubAccount(account.id);

  const auth = new AuthService(
    {
      getSource: async () => "keychain",
      setToken: async () => undefined,
      deleteToken: async () => undefined,
      withAccount: async (_account, task) => task()
    } as unknown as TokenService,
    { get: async () => Promise.reject(new GitHubApiError(401, "Unauthorized", "Bad credentials")) } as unknown as GitHubClient,
    database
  );
  const state = await auth.getAuthState();
  assert.equal(state.status, "revoked");
  assert.match(state.message, /revoked|rejected/i);
  assert.equal(database.localCache.accounts.getGitHubAccountById(account.id)?.authStatus, "revoked");
  assert.equal(database.localCache.accounts.listGitHubAccounts().length, 1);

  database.localCache.accounts.setGitHubAccountAuthState(account.id, {
    authStatus: "connected",
    lastValidatedAt: "2026-01-01T00:00:00.000Z"
  });
  const offlineAuth = new AuthService(
    {
      getSource: async () => "keychain",
      setToken: async () => undefined,
      deleteToken: async () => undefined,
      withAccount: async (_account, task) => task()
    } as unknown as TokenService,
    { get: async () => Promise.reject(new TypeError("fetch failed")) } as unknown as GitHubClient,
    database
  );
  const offlineState = await offlineAuth.getAuthState();
  assert.equal(offlineState.status, "connected");
  assert.equal(database.localCache.accounts.getGitHubAccountById(account.id)?.authStatus, "connected");
} finally {
  database.close();
  await rm(tempDir, { force: true, recursive: true });
}

console.log("Auth classification tests ok");
