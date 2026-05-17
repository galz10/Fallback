import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseService } from "../electron/main/database-service.js";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-performance-fixture-"));
const databasePath = path.join(tempDir, "fallback.sqlite");
let database: DatabaseService | null = new DatabaseService(databasePath);

try {
  const activeDatabase = database;
  assert.ok(activeDatabase);
  seedLargeCache(activeDatabase);

  for (const indexName of [
    "idx_repo_accounts_account_watch",
    "idx_repos_watch_priority_name",
    "idx_sync_jobs_status_repo_created",
    "idx_repo_group_memberships_repo_group",
    "idx_comments_repo_updated_created",
    "idx_workflow_runs_repo_started_updated",
    "idx_check_runs_repo_pr_commit",
    "idx_commit_statuses_repo_commit_updated"
  ]) {
    assertIndexExists(activeDatabase, indexName);
  }

  const startupRepos = timed("listStartupRepoShellsForActiveAccount", 20, () =>
    activeDatabase.localCache.repos.listStartupRepoShellsForActiveAccount()
  );
  assert.equal(startupRepos.length, 100);

  const repos = timed("listWatchedReposForActiveAccount", 80, () => activeDatabase.localCache.repos.listWatchedReposForActiveAccount());
  assert.equal(repos.length, 100);

  const prs = timed("listPullRequests", 120, () => activeDatabase.localCache.githubWork.listPullRequests("repo-1"));
  assert.ok(prs.length > 0);

  const issues = timed("listIssues", 80, () =>
    activeDatabase.localCache.githubWork.listIssues("repo-1", { state: "open", limit: 100, offset: 0 })
  );
  assert.equal(issues.length, 75);

  const issueCount = timed("countIssues", 50, () => activeDatabase.localCache.githubWork.countIssues("repo-1", { state: "open" }));
  assert.equal(issueCount, 75);

  const checks = timed("listActionChecks", 120, () => activeDatabase.localCache.githubWork.listActionChecks("repo-1"));
  assert.ok(checks.length > 0);

  const workflows = timed("listWorkflowRuns", 80, () => activeDatabase.localCache.githubWork.listWorkflowRuns("repo-1"));
  assert.ok(workflows.length > 0);

  const myPrs = timed("listUserPullRequests", 120, () => activeDatabase.localCache.githubWork.listUserPullRequests());
  assert.ok(myPrs.length > 0);

  const myIssues = timed("listUserIssues", 120, () => activeDatabase.localCache.githubWork.listUserIssues());
  assert.ok(myIssues.length > 0);

  assert.equal(activeDatabase.localCache.appMetadata.getAppMetadata("performance_index_set_version"), "2026-05-12");
  activeDatabase.close();
  database = null;
  const reopened = timed("reopenCurrentSchemaDatabase", 80, () => new DatabaseService(databasePath));
  reopened.close();

  console.log("Performance fixture tests ok");
} finally {
  database?.close();
  await rm(tempDir, { force: true, recursive: true });
}

function seedLargeCache(database: DatabaseService): void {
  const now = "2026-05-01T00:00:00.000Z";
  const account = database.localCache.accounts.upsertGitHubAccount({
    id: 42,
    login: "octocat",
    avatarUrl: "https://avatars.githubusercontent.com/u/42?v=4",
    avatarCachedUrl: `data:image/png;base64,${"a".repeat(32_000)}`,
    htmlUrl: "https://github.com/octocat",
    tokenSource: "keychain",
    tokenScopes: ["repo"]
  });
  database.localCache.accounts.setActiveGitHubAccount(account.id);

  const insert = database.db.transaction(() => {
    const repoInsert = database.db.prepare(
      `INSERT INTO repos (
         id, github_repo_id, owner, name, full_name, description, owner_avatar_url, is_private, is_fork,
         watch_enabled, watch_priority, sync_status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 1, ?, 'fresh', ?, ?)`
    );
    const repoAccountInsert = database.db.prepare(
      `INSERT INTO repo_accounts (repo_id, account_id, endpoint, watch_enabled, permission_admin, permission_push, permission_pull, updated_at)
       VALUES (?, ?, ?, 1, 1, 1, 1, ?)`
    );
    const groupInsert = database.db.prepare("INSERT INTO repo_groups (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)");
    const membershipInsert = database.db.prepare("INSERT INTO repo_group_memberships (group_id, repo_id, created_at) VALUES (?, ?, ?)");
    const syncJobInsert = database.db.prepare(
      `INSERT INTO sync_jobs (id, repo_id, account_id, job_type, status, priority, progress_message, created_at, updated_at)
       VALUES (?, ?, ?, 'repo_sync', ?, ?, 'Queued', ?, ?)`
    );
    const prInsert = database.db.prepare(
      `INSERT INTO pull_requests (
         id, repo_id, github_pr_id, number, title, author_login, assignee_logins, requested_reviewer_logins,
         state, is_draft, locked, merged, head_branch, head_sha, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?)`
    );
    const userPrInsert = database.db.prepare(
      `INSERT INTO user_pull_requests (repo_id, pr_number, github_user_login, relation, last_synced_at)
       VALUES (?, ?, ?, 'reviewer', ?)`
    );
    const issueInsert = database.db.prepare(
      `INSERT INTO issues (
         id, repo_id, github_issue_id, number, title, author_login, assignee_logins, state, locked,
         is_pull_request, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`
    );
    const userIssueInsert = database.db.prepare(
      `INSERT INTO user_issues (repo_id, issue_number, github_user_login, relation, last_synced_at)
       VALUES (?, ?, ?, 'assignee', ?)`
    );
    const commentInsert = database.db.prepare(
      `INSERT INTO comments (id, repo_id, entity_type, entity_number, github_comment_id, author_login, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const checkInsert = database.db.prepare(
      `INSERT INTO check_runs (
         id, repo_id, pr_number, commit_sha, github_check_run_id, name, status, conclusion, started_at, completed_at, last_synced_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?)`
    );
    const statusInsert = database.db.prepare(
      `INSERT INTO commit_statuses (id, repo_id, commit_sha, context, state, created_at, updated_at, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const workflowInsert = database.db.prepare(
      `INSERT INTO workflow_runs (
         id, repo_id, github_workflow_run_id, workflow_name, display_title, run_number, event, status, conclusion,
         head_branch, head_sha, run_started_at, created_at, updated_at, last_synced_at
       ) VALUES (?, ?, ?, 'CI', ?, ?, 'pull_request', 'completed', ?, ?, ?, ?, ?, ?, ?)`
    );
    const searchInsert = database.db.prepare(
      `INSERT INTO search_index (
         entity_id, repo_id, entity_type, entity_number, title, body, author_login, state, labels, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (let group = 1; group <= 5; group += 1) groupInsert.run(`group-${group}`, `Group ${group}`, now, now);

    for (let repoIndex = 1; repoIndex <= 100; repoIndex += 1) {
      const repoId = `repo-${repoIndex}`;
      repoInsert.run(
        repoId,
        10_000 + repoIndex,
        "octo",
        `repo-${repoIndex}`,
        `octo/repo-${repoIndex}`,
        `Fixture repository ${repoIndex}`,
        "https://avatars.githubusercontent.com/u/42?v=4",
        100 - repoIndex,
        now,
        now
      );
      repoAccountInsert.run(repoId, account.id, account.endpoint, now);
      membershipInsert.run(`group-${(repoIndex % 5) + 1}`, repoId, now);
      syncJobInsert.run(`sync-${repoIndex}`, repoId, account.id, repoIndex % 8 === 0 ? "queued" : "completed", repoIndex, now, now);

      for (let prIndex = 1; prIndex <= 10; prIndex += 1) {
        const number = repoIndex * 1_000 + prIndex;
        const sha = `sha-${repoIndex}-${prIndex}`;
        prInsert.run(
          `pr-${repoIndex}-${prIndex}`,
          repoId,
          100_000 + number,
          number,
          `Fixture PR ${number}`,
          prIndex % 2 === 0 ? "octocat" : "mona",
          prIndex % 3 === 0 ? "octocat" : "",
          prIndex % 4 === 0 ? "octocat" : "",
          prIndex % 5 === 0 ? "closed" : "open",
          `branch-${prIndex}`,
          sha,
          now,
          now
        );
        if (prIndex % 2 === 0) userPrInsert.run(repoId, number, "octocat", now);
        checkInsert.run(
          `check-${repoIndex}-${prIndex}`,
          repoId,
          number,
          sha,
          200_000 + number,
          `Check ${prIndex}`,
          prIndex % 7 === 0 ? "failure" : "success",
          now,
          now,
          now
        );
        statusInsert.run(
          `status-${repoIndex}-${prIndex}`,
          repoId,
          sha,
          `status/${prIndex}`,
          prIndex % 6 === 0 ? "failure" : "success",
          now,
          now,
          now
        );
        workflowInsert.run(
          `workflow-${repoIndex}-${prIndex}`,
          repoId,
          300_000 + number,
          `Workflow ${prIndex}`,
          prIndex,
          prIndex % 6 === 0 ? "failure" : "success",
          `branch-${prIndex}`,
          sha,
          now,
          now,
          now,
          now
        );
      }

      for (let issueIndex = 1; issueIndex <= 100; issueIndex += 1) {
        const number = repoIndex * 10_000 + issueIndex;
        issueInsert.run(
          `issue-${repoIndex}-${issueIndex}`,
          repoId,
          400_000 + number,
          number,
          `Fixture issue ${number}`,
          issueIndex % 2 === 0 ? "octocat" : "mona",
          issueIndex % 3 === 0 ? "octocat" : "",
          issueIndex % 4 === 0 ? "closed" : "open",
          now,
          now
        );
        if (issueIndex % 3 === 0) userIssueInsert.run(repoId, number, "octocat", now);
        commentInsert.run(
          `comment-${repoIndex}-${issueIndex}`,
          repoId,
          "issue",
          number,
          500_000 + number,
          "octocat",
          `Fixture comment ${number}`,
          now,
          now
        );
        for (let searchIndex = 1; searchIndex <= 5; searchIndex += 1) {
          searchInsert.run(
            `search-${repoIndex}-${issueIndex}-${searchIndex}`,
            repoId,
            "issue",
            number,
            `Fixture searchable issue ${number}`,
            `Body ${searchIndex}`,
            "octocat",
            "open",
            "performance,fixture",
            now,
            now
          );
        }
      }
    }
  });

  insert();
}

function timed<T>(name: string, budgetMs: number, load: () => T): T {
  const startedAt = performance.now();
  const value = load();
  const durationMs = performance.now() - startedAt;
  assert.ok(durationMs <= budgetMs, `${name} took ${durationMs.toFixed(1)}ms; budget is ${budgetMs}ms`);
  return value;
}

function assertIndexExists(database: DatabaseService, indexName: string): void {
  const row = database.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(indexName);
  assert.ok(row, `${indexName} should exist`);
}
