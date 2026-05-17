import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "../electron/main/database-service.js";
import {
  emptyPullRequestReviewDraft,
  reviewDraftCommentCount,
  reviewFailureCopy,
  reviewSubmitPayload,
  reviewSubmitState,
  upsertReviewDraftComment
} from "../src/shared/pr-review-drafts.js";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-pr-review-drafts-test-"));
const database = new DatabaseService(path.join(tempDir, "fallback.sqlite"));

try {
  insertRepo(database, tempDir);
  insertPullRequest(database, "head-a");

  let draft = database.localCache.reviewDrafts.upsertPullRequestReviewDraft("octo-repo", 7, {
    headSha: "head-a",
    event: "REQUEST_CHANGES",
    body: "Please tighten this up.",
    comments: [
      {
        id: "draft-1",
        fileId: "src/app.ts",
        path: "src/app.ts",
        body: "This branch needs a guard.",
        line: 12,
        side: "RIGHT",
        diffSide: "additions"
      }
    ],
    reviewedFiles: ["src/app.ts"]
  });
  assert.equal(draft.outdated, false);
  assert.equal(reviewDraftCommentCount(draft), 1);
  assert.deepEqual(reviewSubmitPayload(draft), {
    event: "REQUEST_CHANGES",
    body: "Please tighten this up.",
    comments: [{ path: "src/app.ts", body: "This branch needs a guard.", line: 12, side: "RIGHT" }]
  });
  assert.equal(reviewSubmitState({ draft, connected: true, online: true, canWrite: true }).canSubmit, true);

  database.db.prepare("UPDATE pull_requests SET head_sha = ? WHERE repo_id = ? AND number = ?").run("head-b", "octo-repo", 7);
  draft = database.localCache.reviewDrafts.getPullRequestReviewDraft("octo-repo", 7)!;
  assert.equal(draft.outdated, true);
  assert.equal(reviewSubmitState({ draft, connected: true, online: true, canWrite: true }).canSubmit, false);
  assert.match(reviewSubmitState({ draft, connected: true, online: true, canWrite: true }).message, /older PR head/);

  const next = emptyPullRequestReviewDraft({ repoId: "octo-repo", prNumber: 7, headSha: "head-b" });
  const comments = upsertReviewDraftComment(next.comments, {
    id: "draft-2",
    fileId: "README.md",
    path: "README.md",
    body: "Fresh comment",
    line: 2,
    side: "RIGHT",
    diffSide: "additions"
  });
  draft = database.localCache.reviewDrafts.upsertPullRequestReviewDraft("octo-repo", 7, { headSha: "head-b", event: "COMMENT", comments });
  assert.equal(draft.outdated, false);
  assert.equal(draft.comments[0]?.body, "Fresh comment");

  database.localCache.reviewDrafts.clearPullRequestReviewDraft("octo-repo", 7, "head-b");
  assert.equal(database.localCache.reviewDrafts.getPullRequestReviewDraft("octo-repo", 7)?.headSha, "head-a");
  assert.equal(database.localCache.reviewDrafts.getPullRequestReviewDraft("octo-repo", 7)?.outdated, true);

  assert.match(reviewFailureCopy("API rate limit exceeded"), /rate limited/);
  assert.match(reviewFailureCopy("403 Resource not accessible by integration"), /permissions/);
} finally {
  database.close();
  await rm(tempDir, { force: true, recursive: true });
}

function insertRepo(db: DatabaseService, workspacePath: string): void {
  db.db
    .prepare(
      `INSERT INTO repos (
        id, github_repo_id, owner, name, full_name, is_private, default_branch, html_url,
        workspace_path, local_path, watch_mode, clone_enabled, clone_status, watch_enabled,
        sync_status, created_at, updated_at
      )
      VALUES ('octo-repo', 1, 'octo', 'repo', 'octo/repo', 0, 'main', 'https://github.com/octo/repo',
        ?, ?, 'cloned', 1, 'cloned', 1, 'fresh', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    )
    .run(workspacePath, workspacePath);
}

function insertPullRequest(db: DatabaseService, headSha: string): void {
  db.db
    .prepare(
      `INSERT INTO pull_requests (
        id, repo_id, github_pr_id, number, title, state, is_draft, merged, head_sha, created_at, updated_at
      )
      VALUES ('pr-7', 'octo-repo', 700, 7, 'Review me', 'open', 0, 0, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    )
    .run(headSha);
}

console.log("PR review draft tests ok");
