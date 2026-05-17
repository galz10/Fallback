import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "../electron/main/database-service.js";
import { GitHubApiError, GitHubClient } from "../electron/main/github-client.js";
import { HealthService } from "../electron/main/health-service.js";

class MockGitHubClient {
  mode: "ok" | "actions_404" | "auth" | "offline" | "rate_limited" | "revoked" | "server_error" | "unknown" = "ok";
  requestCount = 0;

  async get(path?: string): Promise<unknown> {
    this.requestCount += 1;
    if (this.mode === "actions_404" && path?.includes("/actions/runs")) throw new GitHubApiError(404, "Not Found", "Not Found");
    if (this.mode === "auth") throw new GitHubApiError(401, "Unauthorized", "Bad credentials");
    if (this.mode === "offline") throw new TypeError("fetch failed");
    if (this.mode === "rate_limited") throw new GitHubApiError(403, "Forbidden", "API rate limit exceeded");
    if (this.mode === "revoked") throw new GitHubApiError(404, "Not Found", "Not Found");
    if (this.mode === "server_error") throw new GitHubApiError(503, "Service Unavailable", "GitHub API unavailable");
    if (this.mode === "unknown") throw new Error("TLS handshake failed");
    return {};
  }

  async post(): Promise<unknown> {
    return this.get();
  }

  async paginate(): Promise<unknown[]> {
    await this.get();
    return [{ number: 1 }];
  }
}

const originalFetch = globalThis.fetch;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-health-test-"));
const database = new DatabaseService(path.join(tempDir, "fallback.sqlite"));
const github = new MockGitHubClient();
const health = new HealthService(database, github as unknown as GitHubClient);
const git = (...args: string[]) => execFileSync("git", args, { stdio: "ignore" });

try {
  const clonePath = prepareGitClone(tempDir);
  upsertConnectedAccount();
  database.db
    .prepare(
      `INSERT INTO repos (
         id, github_repo_id, owner, name, full_name, is_private, is_fork, default_branch, local_path,
         watch_mode, clone_enabled, clone_status, watch_enabled, sync_status, created_at, updated_at
       )
       VALUES (
         'github.com/octo/repo', 1, 'octo', 'repo', 'octo/repo', 0, 0, 'main', ?, 'cloned', 1, 'cloned',
         1, 'fresh', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
       )`
    )
    .run(clonePath);

  globalThis.fetch = async () =>
    jsonResponse({
      components: [
        { name: "API Requests", status: "operational" },
        { name: "Pull Requests", status: "partial_outage" }
      ]
    });

  const global = await health.runProbe();
  assert.ok(global.some((probe) => probe.surface === "rest_api" && probe.status === "operational"));
  assert.ok(global.some((probe) => probe.surface === "pull_requests" && probe.status === "degraded"));

  const repo = await health.runProbe("github.com/octo/repo");
  assert.ok(repo.some((probe) => probe.repoId === "github.com/octo/repo" && probe.surface === "repo_metadata"));
  assert.ok(repo.some((probe) => probe.repoId === "github.com/octo/repo" && probe.surface === "git" && probe.status === "operational"));
  const matrix = health.matrix();
  assert.ok(matrix.some((row) => row.repoFullName === "octo/repo" && row.api === "operational"));
  assert.ok(matrix.some((row) => row.repoFullName === "octo/repo" && row.git === "operational"));
  const history = await health.history();
  assert.equal(history.days.length, 90);
  assert.ok(history.totalChecks > 0);
  assert.ok(typeof history.uptimePercent === "number");
  const pullRequestUptime = history.services.find((service) => service.surface === "pull_requests");
  assert.ok(pullRequestUptime);
  assert.ok(pullRequestUptime.totalChecks > 0);
  assert.ok(pullRequestUptime.days.some((day) => day.status === "degraded"));

  await assertOfflineState("auth", "auth_error");
  await assertOfflineState("rate_limited", "rate_limited");
  await assertOfflineState("revoked", "repo_access_revoked");
  await assertOfflineState("offline", "offline");
  await assertOfflineState("unknown", "unknown_error");
  await assertAccountFailuresDoNotDegradeGitHubAvailability();
  await assertServerErrorsDegradeGitHubAvailability();
  await assertOptionalRepoFeature404DoesNotDriveOffline();
  await assertSyncProbeDoesNotDriveOffline();
  await assertFreshGlobalProbeClearsStaleRepoOffline();
  await assertSignedOutHealthDoesNotCallGitHubApi();
  await new Promise((resolve) => setTimeout(resolve, 300));

  console.log("Health service tests ok");
} finally {
  globalThis.fetch = originalFetch;
  database.close();
  await rm(tempDir, { force: true, recursive: true });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

async function assertOfflineState(
  mode: MockGitHubClient["mode"],
  state: Awaited<ReturnType<HealthService["offlineStatus"]>>["state"]
): Promise<void> {
  github.mode = mode;
  database.db.prepare("DELETE FROM health_probes").run();
  await health.runProbe("github.com/octo/repo");
  assert.equal((await health.offlineStatus()).state, state);
}

async function assertSyncProbeDoesNotDriveOffline(): Promise<void> {
  github.mode = "ok";
  database.db.prepare("DELETE FROM health_probes").run();
  globalThis.fetch = async () => jsonResponse({ components: [{ name: "API Requests", status: "operational" }] });
  await health.runProbe();
  database.localCache.health.recordHealthProbes([
    {
      repoId: "github.com/octo/repo",
      repoFullName: "octo/repo",
      surface: "sync",
      status: "offline",
      latencyMs: null,
      httpStatus: null,
      errorCode: "network_offline",
      errorMessage: "fetch failed",
      checkedAt: new Date(Date.now() + 1_000).toISOString()
    }
  ]);

  assert.equal((await health.summary()).status, "operational");
  assert.equal((await health.offlineStatus()).state, "online");
}

async function assertFreshGlobalProbeClearsStaleRepoOffline(): Promise<void> {
  github.mode = "ok";
  database.db.prepare("DELETE FROM health_probes").run();
  globalThis.fetch = async () => jsonResponse({ components: [{ name: "API Requests", status: "operational" }] });
  database.localCache.health.recordHealthProbes([
    {
      repoId: "github.com/octo/repo",
      repoFullName: "octo/repo",
      surface: "repo_metadata",
      status: "offline",
      latencyMs: null,
      httpStatus: null,
      errorCode: "network_offline",
      errorMessage: "fetch failed",
      checkedAt: new Date(Date.now() - 60_000).toISOString()
    }
  ]);

  await health.runProbe();
  assert.equal((await health.offlineStatus()).state, "online");
}

async function assertOptionalRepoFeature404DoesNotDriveOffline(): Promise<void> {
  github.mode = "actions_404";
  database.db.prepare("DELETE FROM health_probes").run();
  await health.runProbe("github.com/octo/repo");
  assert.equal((await health.offlineStatus()).state, "online");
}

async function assertAccountFailuresDoNotDegradeGitHubAvailability(): Promise<void> {
  for (const mode of ["auth", "rate_limited"] as const) {
    github.mode = mode;
    database.db.prepare("DELETE FROM health_probes").run();
    globalThis.fetch = async () => jsonResponse({ components: [{ name: "API Requests", status: "operational" }] });
    await health.runProbe();

    assert.equal((await health.summary()).status, "operational");
    assert.equal((await health.offlineStatus()).state, mode === "auth" ? "auth_error" : "rate_limited");

    database.db.prepare("DELETE FROM health_history_snapshots").run();
    const history = await health.history();
    assert.equal(history.days.at(-1)?.status, "operational");
    assert.equal(history.services.find((service) => service.surface === "api")?.days.at(-1)?.status, "operational");
  }
}

async function assertServerErrorsDegradeGitHubAvailability(): Promise<void> {
  github.mode = "server_error";
  database.db.prepare("DELETE FROM health_probes").run();
  globalThis.fetch = async () => jsonResponse({ components: [{ name: "API Requests", status: "operational" }] });
  await health.runProbe();

  assert.equal((await health.summary()).status, "down");
  assert.equal((await health.offlineStatus()).state, "github_down");
}

async function assertSignedOutHealthDoesNotCallGitHubApi(): Promise<void> {
  database.localCache.accounts.deleteAllGitHubAccounts();
  database.db.prepare("DELETE FROM health_probes").run();
  github.requestCount = 0;
  globalThis.fetch = async () => jsonResponse({ components: [{ name: "API Requests", status: "operational" }] });
  await health.runProbe();
  assert.equal(github.requestCount, 0);
  const globalProbes = database.localCache.health.latestHealthProbes();
  assert.ok(globalProbes.some((probe) => probe.surface === "github_status" && probe.status === "operational"));
  assert.ok(globalProbes.some((probe) => probe.surface === "graphql_api" && probe.status === "unknown"));

  await health.runProbe("github.com/octo/repo");
  assert.equal(github.requestCount, 0);
  const repoProbes = database.localCache.health.latestHealthProbes().filter((probe) => probe.repoId === "github.com/octo/repo");
  assert.ok(repoProbes.some((probe) => probe.surface === "repo_metadata" && probe.status === "unknown"));
  upsertConnectedAccount();
}

function upsertConnectedAccount(): void {
  database.localCache.accounts.upsertGitHubAccount({
    id: "1",
    login: "octocat",
    endpoint: "https://api.github.com",
    htmlUrl: "https://github.com/octocat",
    avatarUrl: null,
    tokenSource: "environment",
    authStatus: "connected"
  });
}

function prepareGitClone(root: string): string {
  const remote = path.join(root, "remote.git");
  const seed = path.join(root, "seed");
  const clone = path.join(root, "clone");
  git("init", "--bare", remote);
  git("init", seed);
  git("-C", seed, "config", "user.email", "fallback@example.test");
  git("-C", seed, "config", "user.name", "Fallback Test");
  git("-C", seed, "checkout", "-b", "main");
  writeFileSync(path.join(seed, "README.md"), "fallback\n");
  git("-C", seed, "add", "README.md");
  git("-C", seed, "commit", "-m", "Initial commit");
  git("-C", seed, "remote", "add", "origin", remote);
  git("-C", seed, "push", "-u", "origin", "main");
  git("clone", "--quiet", remote, clone);
  return clone;
}
