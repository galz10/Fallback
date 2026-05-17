import assert from "node:assert/strict";
import { withTempDatabase } from "../tests/fixtures/sqlite.js";

const cutoff = "2025-05-13T00:00:00.000Z";
const oldClosedAt = "2024-05-12T23:59:59.000Z";
const recentClosedAt = "2025-05-13T00:00:00.000Z";
const now = "2026-05-13T12:00:00.000Z";

await withTempDatabase("closed-issue-retention", async ({ database }) => {
  const db = database.db;
  db.prepare(
    `INSERT INTO repos (
       id, github_repo_id, owner, name, full_name, is_private, is_fork, archived, has_issues, is_template,
       watch_enabled, created_at, updated_at
     )
     VALUES ('octo-repo', 1, 'octo', 'repo', 'octo/repo', 0, 0, 0, 1, 0, 1, ?, ?)`
  ).run(now, now);

  insertIssue(db, 1, "closed", oldClosedAt, 0);
  insertIssue(db, 2, "closed", recentClosedAt, 0);
  insertIssue(db, 3, "open", oldClosedAt, 0);
  insertIssue(db, 4, "closed", null, 0);
  insertIssue(db, 5, "closed", oldClosedAt, 1);
  insertIssueCacheRows(db, 1);
  insertIssueCacheRows(db, 2);

  const result = database.localCache.cacheSummary.pruneClosedIssuesOlderThan(cutoff, { repoId: "octo-repo" });

  assert.equal(result.issues, 1);
  assert.equal(result.comments, 1);
  assert.equal(result.labels, 1);
  assert.equal(result.userRelations, 1);
  assert.equal(result.searchRows, 2);
  assert.equal(result.attentionStates, 1);
  assert.equal(result.notificationEvents, 1);

  assert.deepEqual(issueNumbers(db), [2, 3, 4, 5]);
  assert.equal(count(db, "comments", "entity_type = 'issue' AND entity_number = 1"), 0);
  assert.equal(count(db, "comments", "entity_type = 'issue' AND entity_number = 2"), 1);
  assert.equal(count(db, "entity_labels", "entity_type = 'issue' AND entity_number = 1"), 0);
  assert.equal(count(db, "user_issues", "issue_number = 1"), 0);
  assert.equal(count(db, "search_index", "entity_number = 1"), 0);
  assert.equal(count(db, "attention_states", "entity_number = 1"), 0);
  assert.equal(count(db, "notification_events", "entity_number = 1"), 0);
});

await withTempDatabase("closed-issue-retention-disabled", async ({ database }) => {
  const db = database.db;
  db.prepare(
    `INSERT INTO repos (
       id, github_repo_id, owner, name, full_name, is_private, is_fork, archived, has_issues, is_template,
       watch_enabled, created_at, updated_at
     )
     VALUES ('octo-repo', 1, 'octo', 'repo', 'octo/repo', 0, 0, 0, 1, 0, 1, ?, ?)`
  ).run(now, now);
  insertIssue(db, 1, "closed", oldClosedAt, 0);

  const result = database.localCache.cacheSummary.pruneClosedIssuesOlderThanAge(0, { repoId: "octo-repo" });

  assert.equal(result.issues, 0);
  assert.deepEqual(issueNumbers(db), [1]);
});

console.log("Closed issue cache retention tests ok");

function insertIssue(
  db: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } },
  number: number,
  state: "open" | "closed",
  closedAt: string | null,
  isPullRequest: 0 | 1
): void {
  db.prepare(
    `INSERT INTO issues (
       id, repo_id, github_issue_id, number, title, state, locked, created_at, updated_at, closed_at, last_synced_at, is_pull_request
     )
     VALUES (?, 'octo-repo', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
  ).run(`issue-${number}`, number, number, `Issue ${number}`, state, now, now, closedAt, now, isPullRequest);
}

function insertIssueCacheRows(db: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } }, issueNumber: number): void {
  db.prepare("INSERT INTO labels (id, repo_id, name) VALUES (?, 'octo-repo', ?)").run(`label-${issueNumber}`, `label-${issueNumber}`);
  db.prepare("INSERT INTO entity_labels (id, repo_id, entity_type, entity_number, label_id) VALUES (?, 'octo-repo', 'issue', ?, ?)").run(
    `entity-label-${issueNumber}`,
    issueNumber,
    `label-${issueNumber}`
  );
  db.prepare(
    `INSERT INTO comments (
       id, repo_id, entity_type, entity_number, github_comment_id, author_login, body, created_at, updated_at, last_synced_at
     )
     VALUES (?, 'octo-repo', 'issue', ?, ?, 'mona', 'comment', ?, ?, ?)`
  ).run(`comment-${issueNumber}`, issueNumber, issueNumber, now, now, now);
  db.prepare(
    `INSERT INTO user_issues (repo_id, issue_number, github_user_login, relation, last_synced_at)
     VALUES ('octo-repo', ?, 'mona', 'author', ?)`
  ).run(issueNumber, now);
  db.prepare(
    `INSERT INTO search_index (
       entity_id, repo_id, entity_type, entity_number, title, body, author_login, state, labels, created_at, updated_at
     )
     VALUES (?, 'octo-repo', 'issue', ?, 'issue', 'body', 'mona', 'closed', 'bug', ?, ?)`
  ).run(`issue-${issueNumber}`, issueNumber, now, now);
  db.prepare(
    `INSERT INTO search_index (
       entity_id, repo_id, entity_type, entity_number, title, body, author_login, state, labels, created_at, updated_at
     )
     VALUES (?, 'octo-repo', 'comment', ?, 'comment', 'body', 'mona', NULL, '', ?, ?)`
  ).run(`comment-${issueNumber}`, issueNumber, now, now);
  db.prepare(
    `INSERT INTO attention_states (id, entity_type, repo_id, entity_number, account_login, created_at, updated_at)
     VALUES (?, 'issue', 'octo-repo', ?, 'mona', ?, ?)`
  ).run(`attention-${issueNumber}`, issueNumber, now, now);
  db.prepare(
    `INSERT INTO notification_events (
       id, event_key, entity_type, repo_id, entity_number, event_kind, title, first_seen_at, last_seen_at
     )
     VALUES (?, ?, 'issue', 'octo-repo', ?, 'state_change', 'Issue', ?, ?)`
  ).run(`notification-${issueNumber}`, `issue-${issueNumber}`, issueNumber, now, now);
}

function issueNumbers(db: { prepare: (sql: string) => { all: () => Array<{ number: number }> } }): number[] {
  return db
    .prepare("SELECT number FROM issues ORDER BY number")
    .all()
    .map((row) => row.number);
}

function count(db: { prepare: (sql: string) => { get: () => { count: number } } }, table: string, where: string): number {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get().count;
}
