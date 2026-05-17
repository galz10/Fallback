import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AuthService } from "../electron/main/auth-service.js";
import { DatabaseService } from "../electron/main/database-service.js";
import { GitHubApiError, GitHubClient } from "../electron/main/github-client.js";
import { SyncService } from "../electron/main/sync-service.js";
import type { TokenService } from "../electron/main/token-service.js";
import { WorkspaceService } from "../electron/main/workspace-service.js";
import { syncPriority } from "../src/shared/sync-policy.js";
import { MockGitHubClient as BaseMockGitHubClient } from "../tests/fixtures/mock-github.js";

let database: DatabaseService;

async function waitForJob(repoId: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (!database.localCache.syncJobs.activeSyncJob(repoId)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for sync job.");
}

async function waitForSyncIdle(sync: SyncService, repoId: string): Promise<void> {
  let idleSamples = 0;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = sync as unknown as { processing?: boolean; queue?: unknown[] };
    if (!database.localCache.syncJobs.activeSyncJob(repoId) && !state.processing && (state.queue?.length ?? 0) === 0) {
      idleSamples += 1;
      if (idleSamples >= 5) return;
    } else {
      idleSamples = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for sync queue.");
}

function pickCounts(summary: {
  pullRequests: number;
  issues: number;
  comments: number;
  reviews: number;
  checkRuns: number;
  commitStatuses: number;
}) {
  return {
    pullRequests: summary.pullRequests,
    issues: summary.issues,
    comments: summary.comments,
    reviews: summary.reviews,
    checkRuns: summary.checkRuns,
    commitStatuses: summary.commitStatuses
  };
}

function latestSyncProbe(repoId: string) {
  return database.localCache.health.latestHealthProbes().find((probe) => probe.repoId === repoId && probe.surface === "sync");
}

class MockGitHubClient extends BaseMockGitHubClient {
  failRepoSync = false;
  failRepoSyncAuth = false;
  optionalChecksStatus: 403 | 404 | null = null;

  async get<T>(apiPath: string): Promise<T> {
    this.recordCall("GET", apiPath);
    if (this.failRepoSync && apiPath === "/repos/octo/repo") throw new TypeError("fetch failed");
    if (this.failRepoSyncAuth && apiPath === "/repos/octo/repo") throw new GitHubApiError(401, "Unauthorized", "Bad credentials");
    if (apiPath === "/user") return { id: 42, login: "mona", avatar_url: null } as T;
    if (apiPath === "/repos/octo/repo") return repo as T;
    if (apiPath === "/repos/octo/repo/pulls/1") return pullRequest as T;
    if (apiPath === "/repos/octo/repo/pulls/9") return userPullRequest as T;
    if (apiPath === "/repos/octo/repo/commits/head-sha/check-runs") {
      if (this.optionalChecksStatus) throw new GitHubApiError(this.optionalChecksStatus, "Unavailable", "checks unavailable");
      return { total_count: 1, check_runs: [checkRun] } as T;
    }
    if (apiPath === "/repos/octo/repo/actions/runs") return { total_count: 1, workflow_runs: [workflowRun] } as T;
    throw new GitHubApiError(404, "Not Found", "not found");
  }

  async getText(apiPath: string): Promise<string> {
    this.recordCall("GET", apiPath);
    return `diff --git a/src/a.ts b/src/a.ts
index 0000000..1111111 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old
+new
`;
  }

  async paginate<T>(apiPath: string, params?: Record<string, string | number | boolean | undefined>): Promise<T[]> {
    this.recordCall("PAGINATE", apiPath);
    const state = params?.state;
    if (apiPath === "/user/repos") return [repo] as T[];
    if (apiPath === "/user/starred") return [starredRepo, repo] as T[];
    if (apiPath === "/repos/octo/repo/pulls" && state === "open") return [pullRequest] as T[];
    if (apiPath === "/repos/octo/repo/pulls" && state === "closed") return [] as T[];
    if (apiPath === "/repos/octo/repo/issues" && params?.filter === "created") return [userPullRequestIssue] as T[];
    if (apiPath === "/repos/octo/repo/issues" && params?.filter === "assigned") return [] as T[];
    if (apiPath === "/repos/octo/repo/issues" && params?.filter === "mentioned") return [] as T[];
    if (apiPath === "/repos/octo/repo/issues" && state === "open") return [issue, pullRequestIssue] as T[];
    if (apiPath === "/repos/octo/repo/issues" && state === "closed") return [] as T[];
    if (apiPath === "/repos/octo/repo/labels") return [label] as T[];
    if (apiPath === "/orgs/octo/issue-types") return issueTypes as T[];
    if (apiPath === "/orgs/octo/issue-fields") return issueFields as T[];
    if (apiPath === "/repos/octo/repo/issues/1/comments") return [issueComment] as T[];
    if (apiPath === "/repos/octo/repo/issues/2/comments") return [issueComment] as T[];
    if (apiPath === "/repos/octo/repo/pulls/1/reviews") return [review] as T[];
    if (apiPath === "/repos/octo/repo/pulls/1/comments") return [reviewComment] as T[];
    if (apiPath === "/repos/octo/repo/commits/head-sha/statuses" && this.optionalChecksStatus) {
      throw new GitHubApiError(this.optionalChecksStatus, "Unavailable", "statuses unavailable");
    }
    if (apiPath === "/repos/octo/repo/commits/head-sha/statuses") return [status] as T[];
    return [];
  }

  async getConditional<T>(
    apiPath: string,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<{ status: 200; data: T; etag: string | null; lastModified: string | null; headers: Headers }> {
    this.recordCall("CONDITIONAL", apiPath);
    return {
      status: 200,
      data: (await this.paginate<T extends Array<infer Item> ? Item : T>(apiPath, params)) as T,
      etag: `"${apiPath}:${params?.state ?? ""}:${params?.page ?? ""}"`,
      lastModified: "Wed, 01 Jan 2026 00:00:00 GMT",
      headers: new Headers()
    };
  }
}

const label = { id: 10, name: "bug", color: "cc0000", description: null };
const issueTypes = [
  { id: 410, name: "Bug", description: "Something broken", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: 411, name: "Task", description: "Follow-up work", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }
];
const issueFields = [
  {
    id: 510,
    name: "Priority",
    data_type: "single_select",
    options: [
      { id: 610, name: "P0", color: "red", description: null },
      { id: 611, name: "P1", color: "orange", description: null }
    ]
  },
  {
    id: 511,
    name: "Effort",
    data_type: "single_select",
    options: [
      { id: 620, name: "Small", color: "green", description: null },
      { id: 621, name: "Large", color: "blue", description: null }
    ]
  }
];
const repo = {
  id: 1,
  owner: { login: "octo", avatar_url: "https://avatars.githubusercontent.com/u/42?v=4" },
  name: "repo",
  full_name: "octo/repo",
  description: "demo",
  private: false,
  fork: false,
  archived: false,
  has_issues: true,
  is_template: false,
  language: "TypeScript",
  default_branch: "main",
  html_url: "https://github.com/octo/repo",
  clone_url: null,
  ssh_url: null,
  visibility: "public",
  permissions: { admin: false, push: true, pull: true },
  pushed_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z"
};
const starredRepo = {
  id: 2,
  owner: { login: "google-gemini", avatar_url: "https://avatars.githubusercontent.com/u/99?v=4" },
  name: "gemini-cli",
  full_name: "google-gemini/gemini-cli",
  description: "starred repo",
  private: false,
  fork: false,
  archived: false,
  has_issues: true,
  is_template: false,
  language: "TypeScript",
  default_branch: "main",
  html_url: "https://github.com/google-gemini/gemini-cli",
  clone_url: null,
  ssh_url: null,
  visibility: "public",
  permissions: null,
  pushed_at: "2026-01-03T00:00:00Z",
  updated_at: "2026-01-03T00:00:00Z"
};
const pullRequest = {
  id: 101,
  number: 1,
  title: "Fix bug",
  body: "body",
  user: { login: "mona" },
  assignees: [{ login: "octocat" }],
  requested_reviewers: [{ login: "hubot" }],
  state: "open",
  draft: false,
  locked: false,
  merged: false,
  base: { ref: "main", sha: "base-sha" },
  head: { ref: "fix", sha: "head-sha" },
  html_url: "https://github.com/octo/repo/pull/1",
  diff_url: null,
  patch_url: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  closed_at: null,
  merged_at: null,
  labels: [label]
};
const issue = {
  id: 202,
  number: 2,
  title: "Issue",
  body: "issue body",
  user: { login: "mona" },
  assignees: [{ login: "octocat" }],
  state: "open",
  type: { id: 410, name: "Bug" },
  locked: false,
  comments: 1,
  html_url: "https://github.com/octo/repo/issues/2",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  closed_at: null,
  labels: [label]
};
const pullRequestIssue = { ...issue, id: 201, number: 1, title: "PR issue row", pull_request: {} };
const userPullRequest = {
  ...pullRequest,
  id: 109,
  number: 9,
  title: "My older PR",
  html_url: "https://github.com/octo/repo/pull/9",
  updated_at: "2025-12-01T00:00:00Z"
};
const userPullRequestIssue = {
  ...pullRequestIssue,
  id: 209,
  number: 9,
  title: "My older PR issue row",
  updated_at: "2025-12-01T00:00:00Z"
};
const issueComment = {
  id: 301,
  user: { login: "mona" },
  body: "comment",
  html_url: "https://github.com/octo/repo/issues/2#issuecomment-301",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z"
};
const review = {
  id: 401,
  user: { login: "hubot" },
  state: "APPROVED",
  body: "ship it",
  html_url: "https://github.com/octo/repo/pull/1#pullrequestreview-401",
  commit_id: "head-sha",
  submitted_at: "2026-01-01T00:00:00Z"
};
const reviewComment = { ...issueComment, id: 501, path: "src/a.ts", diff_hunk: "@@" };
const checkRun = {
  id: 601,
  name: "ci",
  status: "completed",
  conclusion: "success",
  started_at: "2026-01-01T00:00:00Z",
  completed_at: "2026-01-01T00:01:00Z",
  html_url: "https://github.com/octo/repo/actions/runs/1",
  details_url: null
};
const status = {
  id: 701,
  context: "legacy-ci",
  state: "success",
  description: null,
  target_url: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z"
};
const workflowRun = {
  id: 801,
  name: "CI",
  display_title: "Fix bug",
  run_number: 12,
  event: "pull_request",
  status: "completed",
  conclusion: "success",
  head_branch: "feature",
  head_sha: "head-sha",
  html_url: "https://github.com/octo/repo/actions/runs/801",
  run_started_at: "2026-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:02:00Z"
};

async function run(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-sync-test-"));
  const databasePath = path.join(tempDir, "fallback.sqlite");
  database = new DatabaseService(databasePath);
  upsertConnectedAccount();
  const github = new MockGitHubClient();
  let foregroundRemoteRefreshes = 0;
  const workspace = {
    ensureRepoFolder: () => tempDir,
    ensureRepoClone: async () => tempDir,
    repoPath: () => tempDir,
    updateRepoMarker: () => undefined,
    refreshRepoRemoteState: async () => {
      foregroundRemoteRefreshes += 1;
      throw new Error("repoCodeSummary should not refresh remote state in the foreground");
    }
  } as unknown as WorkspaceService;
  const sync = new SyncService(database, workspace, github as unknown as GitHubClient);

  try {
    const repo = await sync.watchRepo("octo/repo");
    assert.ok(repo);
    assert.equal(repo.ownerAvatarUrl, "https://avatars.githubusercontent.com/u/42?v=4");
    assert.equal(repo.visibility, "public");
    assert.equal(repo.isFork, false);
    assert.equal(repo.archived, false);
    assert.equal(repo.hasIssues, true);
    assert.equal(repo.isTemplate, false);
    assert.equal(repo.language, "TypeScript");
    assert.deepEqual(repo.permissions, { admin: false, push: true, pull: true });
    assert.equal(repo.pushedAt, "2026-01-01T00:00:00Z");
    assert.equal(repo.githubUpdatedAt, "2026-01-01T00:00:00Z");
    assert.equal(repo.cloneStatus, "pending");
    const available = await sync.listAvailableRepos();
    const availableRepo = available.find((item) => item.fullName === "octo/repo");
    assert.equal(availableRepo?.visibility, "public");
    assert.equal(availableRepo?.language, "TypeScript");
    assert.deepEqual(availableRepo?.permissions, { admin: false, push: true, pull: true });
    assert.equal(availableRepo?.pushedAt, "2026-01-01T00:00:00Z");
    assert.deepEqual(available.map((item) => item.fullName).sort(), ["google-gemini/gemini-cli", "octo/repo"]);
    assert.equal(available.filter((item) => item.fullName === "octo/repo").length, 1);
    assert.equal(available.find((item) => item.fullName === "google-gemini/gemini-cli")?.permissions, null);
    const repoColumns = new Set(
      (database.db.prepare("PRAGMA table_info(repos)").all() as Array<{ name: string }>).map((column) => column.name)
    );
    for (const column of ["archived", "has_issues", "is_template", "language", "permission_admin", "permission_push", "permission_pull"]) {
      assert.ok(repoColumns.has(column), `expected repos.${column} to exist`);
    }
    await waitForJob(repo.id);

    const first = database.localCache.cacheSummary.cacheSummary(tempDir, path.join(tempDir, "fallback.sqlite"));
    assert.equal(first.pullRequests, 2);
    assert.equal(first.issues, 1);
    assert.equal((database.db.prepare("SELECT COUNT(*) AS count FROM issues").get() as { count: number }).count, 3);
    assert.equal(database.localCache.githubWork.listIssues(repo.id).length, 1);

    const now = new Date().toISOString();
    database.db
      .prepare(
        `INSERT INTO repos (
           id, github_repo_id, owner, name, full_name, is_private, is_fork, watch_enabled, sync_status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 'never_synced', ?, ?)`
      )
      .run("repo-unwatched", 99, "octo", "unwatched", "octo/unwatched", now, now);
    database.db
      .prepare(
        `INSERT INTO pull_requests (id, repo_id, github_pr_id, number, title, state, is_draft, locked, merged)
         VALUES ('pr-unwatched', 'repo-unwatched', 901, 1, 'Unwatched PR', 'open', 0, 0, 0)`
      )
      .run();
    database.db
      .prepare(
        `INSERT INTO issues (id, repo_id, github_issue_id, number, title, state, locked, is_pull_request)
         VALUES ('issue-unwatched', 'repo-unwatched', 902, 2, 'Unwatched ticket', 'open', 0, 0)`
      )
      .run();
    database.db
      .prepare(
        `INSERT INTO comments (id, repo_id, entity_type, entity_number, github_comment_id)
         VALUES ('comment-unwatched', 'repo-unwatched', 'issue', 2, 903)`
      )
      .run();
    database.db
      .prepare(
        `INSERT INTO reviews (id, repo_id, pr_number, github_review_id, state)
         VALUES ('review-unwatched', 'repo-unwatched', 1, 904, 'APPROVED')`
      )
      .run();
    database.db
      .prepare(
        `INSERT INTO check_runs (id, repo_id, commit_sha, github_check_run_id, name)
         VALUES ('check-unwatched', 'repo-unwatched', 'sha-unwatched', 905, 'ci')`
      )
      .run();
    database.db
      .prepare(
        `INSERT INTO commit_statuses (id, repo_id, commit_sha, context, state)
         VALUES ('status-unwatched', 'repo-unwatched', 'sha-unwatched', 'ci', 'success')`
      )
      .run();
    database.db
      .prepare(
        `INSERT INTO search_index (entity_id, repo_id, entity_type, entity_number, title, body, author_login, state, labels, created_at, updated_at)
         VALUES ('search-unwatched', 'repo-unwatched', 'issue', 2, 'Unwatched ticket', '', 'mona', 'open', '', ?, ?)`
      )
      .run(now, now);
    assert.deepEqual(
      pickCounts(database.localCache.cacheSummary.cacheSummary(tempDir, path.join(tempDir, "fallback.sqlite"))),
      pickCounts(first),
      "cache summary counts must ignore rows for unwatched repositories"
    );

    github.clearCalls();
    await sync.syncRepo(repo.id);
    const second = database.localCache.cacheSummary.cacheSummary(tempDir, path.join(tempDir, "fallback.sqlite"));
    assert.deepEqual(pickCounts(second), pickCounts(first), "re-running sync should update rows without duplicates");
    assert.equal(github.callCount("PAGINATE", "/repos/octo/repo/issues/2/comments"), 0);
    assert.equal(github.callCount("PAGINATE", "/repos/octo/repo/issues/1/comments"), 0);
    assert.equal(github.callCount("PAGINATE", "/repos/octo/repo/pulls/1/reviews"), 0);
    assert.equal(github.callCount("PAGINATE", "/repos/octo/repo/pulls/1/comments"), 0);
    assert.equal(github.callCount("GET", "/repos/octo/repo/commits/head-sha/check-runs"), 0);
    assert.equal(github.callCount("PAGINATE", "/repos/octo/repo/commits/head-sha/statuses"), 0);
    assert.equal(latestSyncProbe(repo.id)?.status, "operational");
    assert.equal(database.localCache.searchIndex.search("Fix", { entityType: "pull_request", state: "open", label: "bug" }).length, 1);
    assert.equal(database.localCache.searchIndex.search("My older PR", { entityType: "pull_request", state: "open" }).length, 1);
    assert.equal(database.localCache.searchIndex.search("Issue", { entityType: "issue", author: "mona" }).length, 1);
    assert.equal(database.localCache.searchIndex.search("octo", { entityType: "repo" }).length, 1);
    assert.deepEqual(database.localCache.githubWork.listPullRequests(repo.id)[0]?.labels, ["bug"]);
    assert.deepEqual(database.localCache.githubWork.listPullRequests(repo.id)[0]?.assigneeLogins, ["octocat"]);
    assert.deepEqual(database.localCache.githubWork.listPullRequests(repo.id)[0]?.requestedReviewerLogins, ["hubot"]);
    assert.equal(database.localCache.githubWork.listPullRequests(repo.id)[0]?.reviewState, "approved");
    assert.equal(database.localCache.githubWork.listPullRequests(repo.id)[0]?.checkState, "passing");
    assert.equal(database.localCache.githubWork.listPullRequests(repo.id)[0]?.checkCount, 2);
    assert.equal(database.localCache.githubWork.listActionChecks(repo.id).length, 2);
    assert.equal(database.localCache.githubWork.listActionChecks(repo.id)[0]?.state, "passing");
    assert.ok(database.localCache.githubWork.listActionChecks(repo.id).some((check) => check.prNumber !== null));
    assert.equal(database.localCache.githubWork.listWorkflowRuns(repo.id).length, 1);
    assert.deepEqual(database.localCache.githubWork.listIssues(repo.id)[0]?.labels, ["bug"]);
    assert.deepEqual(database.localCache.githubWork.listIssues(repo.id)[0]?.assigneeLogins, ["octocat"]);
    assert.equal(database.localCache.githubWork.listIssues(repo.id)[0]?.issueTypeName, "Bug");
    assert.deepEqual(database.localCache.githubWork.listIssueTypes(repo.id), ["Bug", "Task"]);
    assert.deepEqual(database.localCache.githubWork.listIssueFieldOptions(repo.id), {
      effort: ["Large", "Small"],
      priority: ["P0", "P1"]
    });
    assert.equal(database.localCache.githubWork.listIssues(repo.id)[0]?.repoFullName, "octo/repo");
    assert.equal(database.localCache.githubWork.listUserIssues("octocat").length, 1);

    github.optionalChecksStatus = 403;
    const fallbackJob403 = await sync.syncPullRequest(repo.id, 1);
    assert.equal(fallbackJob403.status, "success");
    github.optionalChecksStatus = 404;
    const fallbackJob404 = await sync.syncPullRequest(repo.id, 1);
    assert.equal(fallbackJob404.status, "success");
    github.optionalChecksStatus = null;

    github.failRepoSync = true;
    await sync.syncRepo(repo.id);
    assert.equal(database.localCache.repos.getRepo(repo.id)?.syncStatus, "offline");
    assert.equal(latestSyncProbe(repo.id)?.status, "offline");
    assert.ok(database.localCache.repos.getRepo(repo.id)?.lastSuccessfulSyncAt);
    assert.equal(database.localCache.searchIndex.search("Fix", { entityType: "pull_request", state: "open", label: "bug" }).length, 1);
    github.failRepoSync = false;
    await sync.syncRepo(repo.id);
    assert.equal(database.localCache.repos.getRepo(repo.id)?.syncStatus, "fresh");
    assert.equal(latestSyncProbe(repo.id)?.status, "operational");

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
    github.failRepoSyncAuth = true;
    await sync.syncRepo(repo.id);
    assert.equal(database.localCache.repos.getRepo(repo.id)?.syncStatus, "auth_error");
    assert.equal(database.localCache.accounts.getGitHubAccountById(account.id)?.authStatus, "revoked");
    assert.equal(database.localCache.searchIndex.search("Fix", { entityType: "pull_request", state: "open", label: "bug" }).length, 1);
    github.failRepoSyncAuth = false;
    database.localCache.accounts.setGitHubAccountAuthState(account.id, { authStatus: "connected" });

    github.rateLimit = { remaining: 10, resetAt: new Date(Date.now() + 60_000).toISOString() };
    const queued = await sync.enqueueRepoSync(repo.id, "background_repo_sync");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const queuedJob = database.localCache.syncJobs.getSyncJob(queued.id);
    assert.equal(queuedJob?.status, "queued");
    assert.equal(queuedJob?.reason, "background_maintenance");
    assert.ok(queuedJob?.notBefore, "rate-limited background jobs should record a resume time");
    assert.match(queuedJob?.progressMessage ?? "", /paused until/i);
    assert.match(queued.warningMessage ?? "", /rate limit is low/i);
    assert.ok(database.localCache.diagnostics.diagnosticEvents().some((event) => event.code === "rate_limit_backoff"));

    const deduped = await sync.enqueueRepoSync(repo.id, "background_repo_sync");
    assert.equal(deduped.id, queued.id);

    const manual = await sync.enqueueRepoSync(repo.id, "manual_repo_sync", {
      priority: syncPriority.manual,
      reason: "manual_refresh",
      bypassCooldown: true
    });
    assert.equal(manual.id, queued.id);
    await waitForJob(repo.id);
    const manualJob = database.localCache.syncJobs.getSyncJob(manual.id);
    assert.equal(manualJob?.status, "success");
    assert.equal(manualJob?.reason, "manual_refresh");
    assert.equal(manualJob?.priority, syncPriority.manual);
    assert.equal(manualJob?.notBefore, null);
    assert.ok((manualJob?.attemptCount ?? 0) > 0);
    github.rateLimit = { remaining: 5000, resetAt: new Date(Date.now() + 60_000).toISOString() };

    const orphanedQueuedJob = database.localCache.syncJobs.createSyncJob(repo.id, "background_repo_sync", {
      priority: syncPriority.maintenance,
      reason: "background_maintenance",
      dedupeKey: `${repo.id}:background_repo_sync`
    });
    database.localCache.syncJobs.updateSyncJob(orphanedQueuedJob.id, { progressMessage: "Background Maintenance: waiting to sync" });
    database.localCache.repos.setRepoSyncState(repo.id, "queued", null);
    const resumedSync = new SyncService(database, workspace, github as unknown as GitHubClient);
    const resumedManual = await resumedSync.enqueueRepoSync(repo.id, "manual_repo_sync", {
      priority: syncPriority.manual,
      reason: "manual_refresh",
      bypassCooldown: true
    });
    assert.equal(resumedManual.id, orphanedQueuedJob.id);
    await waitForSyncIdle(resumedSync, repo.id);
    const resumedManualJob = database.localCache.syncJobs.getSyncJob(resumedManual.id);
    assert.equal(resumedManualJob?.status, "success");
    assert.equal(resumedManualJob?.reason, "manual_refresh");

    await mkdir(path.join(tempDir, ".git"), { recursive: true });
    github.clearCalls();
    const localCodeSummary = await sync.repoCodeSummary(repo.id);
    assert.equal(localCodeSummary.defaultBranch, "main");
    assert.equal(localCodeSummary.fromCache, true);
    assert.equal(foregroundRemoteRefreshes, 0);
    assert.equal(github.callCount("GET", "/repos/octo/repo"), 0);
    assert.equal(github.callCount("PAGINATE", "/repos/octo/repo/commits"), 0);

    const repoCount = database.localCache.repos.listWatchedRepos().length;
    const auth = new AuthService(
      { getSource: async () => "keychain", setToken: async () => undefined, deleteToken: async () => undefined } as unknown as TokenService,
      { get: async () => Promise.reject(new GitHubApiError(401, "Unauthorized", "Bad credentials")) } as unknown as GitHubClient
    );
    const authState = await auth.getAuthState();
    assert.equal(authState.status, "revoked");
    assert.equal(database.localCache.repos.listWatchedRepos().length, repoCount);

    await waitForSyncIdle(sync, repo.id);
    assert.equal(database.localCache.searchIndex.search("comment", { entityType: "comment" }).length, 3);
    assert.equal(database.localCache.searchIndex.search("ship", { entityType: "review" }).length, 1);

    console.log("Sync service mocked DB tests ok");
  } finally {
    database.close();
    await rm(tempDir, { force: true, recursive: true });
  }
}

function upsertConnectedAccount(): void {
  database.localCache.accounts.upsertGitHubAccount({
    id: "42",
    login: "mona",
    endpoint: "https://api.github.com",
    htmlUrl: "https://github.com/mona",
    avatarUrl: null,
    tokenSource: "environment",
    authStatus: "connected"
  });
}

await run();
