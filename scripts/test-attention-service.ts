import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { AttentionService } from "../electron/main/attention-service.js";
import { DatabaseService } from "../electron/main/database-service.js";
import { SettingsService } from "../electron/main/settings-service.js";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-attention-service-"));
const databasePath = path.join(tempDir, "fallback.sqlite");
const now = "2020-01-01T12:00:00.000Z";

try {
  const database = new DatabaseService(databasePath);
  const settings = new SettingsService();
  settings.update({ workspacePath: tempDir });
  const attention = new AttentionService(database, settings);

  const monaAccount = database.localCache.accounts.upsertGitHubAccount({
    id: 1,
    login: "mona",
    endpoint: "https://api.github.com",
    avatarUrl: null,
    tokenSource: "environment",
    tokenScopes: ["repo"],
    authStatus: "connected",
    lastValidatedAt: now
  });
  database.db
    .prepare(
      `INSERT INTO repos (
        id, github_repo_id, owner, name, full_name, default_branch, local_path, watch_mode, clone_status,
        watch_enabled, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run("octo-repo", 1, "octo", "repo", "octo/repo", "main", tempDir, "cloned", "cloned", 1, now, now);
  database.localCache.repoAccounts.associateRepoAccount("octo-repo", monaAccount, { pull: true, push: true }, { watchEnabled: true });
  database.db
    .prepare(
      `INSERT INTO pull_requests (
        id, repo_id, github_pr_id, number, title, body, author_login, assignee_logins, requested_reviewer_logins,
        state, is_draft, merged, head_sha, base_sha, comments_count, review_comments_count, html_url,
        created_at, updated_at, last_synced_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "pr-1",
      "octo-repo",
      10,
      7,
      "Fix retry loop",
      null,
      "mona",
      "[]",
      "[]",
      "open",
      0,
      0,
      "b".repeat(40),
      "a".repeat(40),
      0,
      0,
      "https://github.com/octo/repo/pull/7",
      now,
      now,
      now
    );
  database.db
    .prepare(
      `INSERT INTO check_runs (
        id, repo_id, pr_number, commit_sha, github_check_run_id, name, status, conclusion, completed_at, last_synced_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run("check-1", "octo-repo", 7, "b".repeat(40), 99, "unit-tests", "completed", "failure", now, now);
  database.db
    .prepare(`INSERT INTO user_pull_requests (repo_id, pr_number, github_user_login, relation, last_synced_at) VALUES (?, ?, ?, ?, ?)`)
    .run("octo-repo", 7, "mona", "author", now);

  database.db
    .prepare(
      `INSERT INTO pull_requests (
        id, repo_id, github_pr_id, number, title, body, author_login, assignee_logins, requested_reviewer_logins,
        state, is_draft, merged, head_sha, base_sha, comments_count, review_comments_count, html_url,
        created_at, updated_at, last_synced_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "pr-2",
      "octo-repo",
      11,
      8,
      "Waiting on somebody else's review",
      null,
      "mona",
      "[]",
      '["scidomino"]',
      "open",
      0,
      0,
      "c".repeat(40),
      "a".repeat(40),
      0,
      0,
      "https://github.com/octo/repo/pull/8",
      now,
      now,
      now
    );
  database.db
    .prepare(`INSERT INTO user_pull_requests (repo_id, pr_number, github_user_login, relation, last_synced_at) VALUES (?, ?, ?, ?, ?)`)
    .run("octo-repo", 8, "mona", "author", now);

  database.db
    .prepare(
      `INSERT INTO pull_requests (
        id, repo_id, github_pr_id, number, title, body, author_login, assignee_logins, requested_reviewer_logins,
        state, is_draft, merged, head_sha, base_sha, comments_count, review_comments_count, html_url,
        created_at, updated_at, last_synced_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "pr-assigned",
      "octo-repo",
      13,
      10,
      "Assigned follow-up",
      null,
      "octocat",
      "mona",
      "[]",
      "open",
      0,
      0,
      "e".repeat(40),
      "a".repeat(40),
      0,
      0,
      "https://github.com/octo/repo/pull/10",
      now,
      now,
      now
    );
  database.db
    .prepare(`INSERT INTO user_pull_requests (repo_id, pr_number, github_user_login, relation, last_synced_at) VALUES (?, ?, ?, ?, ?)`)
    .run("octo-repo", 10, "mona", "assignee", now);

  database.db
    .prepare(
      `INSERT INTO pull_requests (
        id, repo_id, github_pr_id, number, title, body, author_login, assignee_logins, requested_reviewer_logins,
        state, is_draft, merged, head_sha, base_sha, comments_count, review_comments_count, html_url,
        created_at, updated_at, last_synced_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "pr-cached-author",
      "octo-repo",
      14,
      11,
      "Cached authored PR without relation row",
      null,
      "mona",
      "[]",
      "[]",
      "open",
      0,
      0,
      "f".repeat(40),
      "a".repeat(40),
      0,
      0,
      "https://github.com/octo/repo/pull/11",
      now,
      now,
      now
    );

  database.db
    .prepare(
      `INSERT INTO pull_requests (
        id, repo_id, github_pr_id, number, title, body, author_login, assignee_logins, requested_reviewer_logins,
        state, is_draft, merged, head_sha, base_sha, comments_count, review_comments_count, html_url,
        created_at, updated_at, closed_at, merged_at, last_synced_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "pr-closed",
      "octo-repo",
      12,
      9,
      "Already merged",
      null,
      "mona",
      "[]",
      "[]",
      "closed",
      0,
      1,
      "d".repeat(40),
      "a".repeat(40),
      0,
      0,
      "https://github.com/octo/repo/pull/9",
      now,
      now,
      now,
      now,
      now
    );
  database.db
    .prepare(`INSERT INTO user_pull_requests (repo_id, pr_number, github_user_login, relation, last_synced_at) VALUES (?, ?, ?, ?, ?)`)
    .run("octo-repo", 9, "mona", "author", now);
  database.localCache.notifications.upsertNotificationEvent({
    eventKey: "pr-state:octo-repo:77:closed",
    entityType: "pull_request",
    repoId: "octo-repo",
    entityNumber: 77,
    eventKind: "state_change",
    actorLogin: "mona",
    actorIsBot: false,
    title: "PR #77 closed",
    bodyPreview: "Closed without a cached PR row",
    htmlUrl: "https://github.com/octo/repo/pull/77",
    githubCreatedAt: now,
    githubUpdatedAt: now,
    importance: 10,
    promotesToMyWork: false,
    collapseKey: null,
    payload: { state: "closed" }
  });
  database.localCache.notifications.upsertNotificationEvent({
    eventKey: "pr-state:octo-repo:78:review-requested:scidomino",
    entityType: "pull_request",
    repoId: "octo-repo",
    entityNumber: 78,
    eventKind: "review_request",
    actorLogin: null,
    actorIsBot: false,
    title: "scidomino was requested for review",
    bodyPreview: "A review request for somebody else",
    htmlUrl: "https://github.com/octo/repo/pull/78",
    githubCreatedAt: now,
    githubUpdatedAt: now,
    importance: 90,
    promotesToMyWork: true,
    collapseKey: null,
    payload: { reviewer: "scidomino" }
  });
  database.db
    .prepare(
      `INSERT INTO issues (
        id, repo_id, github_issue_id, number, title, body, author_login, assignee_logins, state, locked,
        comments_count, html_url, created_at, updated_at, last_synced_at, is_pull_request
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "issue-assigned-elsewhere",
      "octo-repo",
      22598,
      22598,
      "Feat: Subagent trajectory should be visible via `/chat share`",
      null,
      "abhipatel12",
      "scidomino",
      "open",
      0,
      1,
      "https://github.com/octo/repo/issues/22598",
      now,
      now,
      now,
      0
    );
  database.db
    .prepare(
      `INSERT INTO issues (
        id, repo_id, github_issue_id, number, title, body, author_login, assignee_logins, state, locked,
        comments_count, html_url, created_at, updated_at, last_synced_at, is_pull_request
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "issue-unrelated-comment",
      "octo-repo",
      26911,
      26911,
      "429 Too many Requests",
      null,
      "DMeredith88",
      null,
      "open",
      0,
      1,
      "https://github.com/octo/repo/issues/26911",
      now,
      now,
      now,
      0
    );
  database.db
    .prepare(
      `INSERT INTO comments (
        id, repo_id, entity_type, entity_number, github_comment_id, author_login, body, html_url, created_at, updated_at, last_synced_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "comment-unrelated-26911",
      "octo-repo",
      "issue",
      26911,
      2691101,
      "DMeredith88",
      "Still seeing quota failures after a fresh session.",
      "https://github.com/octo/repo/issues/26911#issuecomment-2691101",
      now,
      now,
      now
    );
  database.db
    .prepare(
      `INSERT INTO issues (
        id, repo_id, github_issue_id, number, title, body, author_login, assignee_logins, state, locked,
        comments_count, html_url, created_at, updated_at, closed_at, last_synced_at, is_pull_request
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "issue-closed-assigned",
      "octo-repo",
      23143,
      23143,
      "Closed issue assigned to mona",
      null,
      "octocat",
      "mona",
      "closed",
      0,
      1,
      "https://github.com/octo/repo/issues/23143",
      now,
      now,
      now,
      now,
      0
    );
  database.localCache.notifications.upsertNotificationEvent({
    eventKey: "issue-assignment:octo-repo:23143:mona",
    entityType: "issue",
    repoId: "octo-repo",
    entityNumber: 23143,
    eventKind: "assignment",
    actorLogin: "octocat",
    actorIsBot: false,
    title: "Issue #23143 assigned",
    bodyPreview: "Closed issue assigned to mona",
    htmlUrl: "https://github.com/octo/repo/issues/23143",
    githubCreatedAt: now,
    githubUpdatedAt: now,
    importance: 50,
    promotesToMyWork: true,
    collapseKey: null,
    payload: { assignees: ["mona"] }
  });
  database.db
    .prepare(
      `INSERT INTO pull_requests (
        id, repo_id, github_pr_id, number, title, body, author_login, assignee_logins, requested_reviewer_logins,
        state, is_draft, merged, head_sha, base_sha, comments_count, review_comments_count, html_url,
        created_at, updated_at, closed_at, merged_at, last_synced_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "pr-merged-stale-review",
      "octo-repo",
      15,
      12,
      "Merged PR with stale review request",
      null,
      "octocat",
      "[]",
      "[]",
      "closed",
      0,
      1,
      "a".repeat(40),
      "b".repeat(40),
      0,
      0,
      "https://github.com/octo/repo/pull/12",
      now,
      now,
      now,
      now,
      now
    );
  database.localCache.notifications.upsertNotificationEvent({
    eventKey: "pr-state:octo-repo:12:review-requested:mona",
    entityType: "pull_request",
    repoId: "octo-repo",
    entityNumber: 12,
    eventKind: "review_request",
    actorLogin: null,
    actorIsBot: false,
    title: "mona was requested for review",
    bodyPreview: "Merged PR with stale review request",
    htmlUrl: "https://github.com/octo/repo/pull/12",
    githubCreatedAt: now,
    githubUpdatedAt: now,
    importance: 90,
    promotesToMyWork: true,
    collapseKey: null,
    payload: { reviewer: "mona" }
  });

  attention.deriveForRepo("octo-repo");

  const atRisk = attention.list({ surface: "my_work", lane: "at_risk" });
  assert.equal(atRisk.length, 1);
  assert.equal(atRisk[0]?.reason, "checks_failing");
  assert.equal(atRisk[0]?.suggestedAction, "Resolve");
  assert.equal(atRisk[0]?.urgency, "critical");
  assert.equal(
    attention.list({ surface: "notifications" }).some((item) => item.id === atRisk[0]!.id),
    false
  );
  assert.equal(
    attention.list({ surface: "notifications", filter: "actionable" }).some((item) => item.id === atRisk[0]!.id),
    false
  );
  assert.equal(
    attention.list({ surface: "notifications" }).some((item) => item.id === "pull_request:octo-repo:9"),
    false
  );
  assert.equal(
    attention.list({ surface: "notifications" }).some((item) => item.id === "pull_request:octo-repo:77"),
    false
  );
  assert.equal(
    attention.list({ surface: "notifications" }).some((item) => item.id === "pull_request:octo-repo:78"),
    false
  );
  assert.equal(
    attention.list({ surface: "notifications" }).some((item) => item.id === "issue:octo-repo:22598"),
    false
  );
  assert.equal(
    attention.list({ surface: "notifications", filter: "actionable" }).some((item) => item.id === "issue:octo-repo:22598"),
    false
  );
  assert.equal(
    attention.list({ surface: "notifications" }).some((item) => item.id === "issue:octo-repo:26911"),
    false
  );
  assert.equal(
    attention.list({ surface: "notifications", filter: "actionable" }).some((item) => item.id === "issue:octo-repo:26911"),
    false
  );
  assert.equal(
    attention.list({ surface: "notifications" }).some((item) => item.id === "issue:octo-repo:23143"),
    false
  );
  assert.equal(
    attention.list({ surface: "notifications", filter: "actionable" }).some((item) => item.id === "issue:octo-repo:23143"),
    false
  );
  assert.equal(
    attention.list({ surface: "notifications" }).some((item) => item.id === "pull_request:octo-repo:12"),
    false
  );
  assert.equal(
    attention.list({ surface: "notifications", filter: "actionable" }).some((item) => item.id === "pull_request:octo-repo:12"),
    false
  );
  const needsMe = attention.list({ surface: "my_work", lane: "needs_me" });
  assert.equal(needsMe.length, 1);
  assert.equal(needsMe[0]?.id, "pull_request:octo-repo:10");
  assert.equal(needsMe[0]?.reason, "assigned_to_you");
  const waiting = attention.list({ surface: "my_work", lane: "waiting" });
  assert.ok(waiting.some((item) => item.id === "pull_request:octo-repo:11"));
  const otherReviewerPr = attention.list({ surface: "my_work" }).find((item) => item.id === "pull_request:octo-repo:8");
  assert.ok(otherReviewerPr);
  assert.equal(otherReviewerPr.reason === "explicit_review_request", false);
  assert.equal(otherReviewerPr.whatChanged.includes("scidomino was requested for review"), false);
  assert.equal(attention.summary().actionableCount, 2);
  assert.equal(attention.summary().waitingCount, 2);
  assert.equal(attention.summary().unreadCount, 0);
  const inboxNeedsAction = attention.list({ filter: "actionable" });
  assert.equal(inboxNeedsAction.length, attention.summary().actionableCount);
  assert.ok(inboxNeedsAction.some((item) => item.id === atRisk[0]!.id));
  assert.ok(inboxNeedsAction.some((item) => item.id === needsMe[0]!.id));
  const inboxWaiting = attention.list({ filter: "waiting" });
  assert.equal(inboxWaiting.length, attention.summary().waitingCount);

  const otherAccount = database.localCache.accounts.upsertGitHubAccount({
    id: 2,
    login: "hubot",
    endpoint: "https://api.github.com",
    avatarUrl: null,
    tokenSource: "environment",
    tokenScopes: ["repo"],
    authStatus: "connected",
    lastValidatedAt: now
  });
  database.localCache.accounts.setActiveGitHubAccount(otherAccount.id);
  assert.equal(attention.list({ surface: "my_work", lane: "needs_me" }).length, 0);
  assert.equal(attention.summary().actionableCount, 0);
  database.localCache.accounts.setActiveGitHubAccount(monaAccount.id);
  assert.equal(attention.list({ surface: "my_work", lane: "needs_me" }).length, 1);

  attention.markDone(needsMe[0]!.id);
  assert.equal(attention.list({ surface: "my_work", lane: "needs_me" }).length, 0);
  assert.equal(attention.list({ surface: "my_work", lane: "done" }).length, 1);
  attention.undoDone(needsMe[0]!.id);
  attention.snooze(needsMe[0]!.id, "9999-01-02T09:00:00.000Z");
  assert.equal(attention.list({ surface: "my_work", lane: "snoozed" }).length, 1);
  attention.unsnooze(needsMe[0]!.id);
  assert.equal(attention.list({ surface: "my_work", lane: "needs_me" }).length, 1);

  console.log("Attention service tests ok");
  await delay(300);
  database.close();
} finally {
  await rm(tempDir, { force: true, recursive: true });
}
