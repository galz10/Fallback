import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "../electron/main/database-service.js";
import { OfflineWritebackQueueService } from "../electron/main/github-work/offline-writeback-queue.js";

class FakeHealth {
  state: "online" | "offline" = "online";

  async offlineStatus() {
    return {
      state: this.state,
      message: this.state,
      checkedAt: new Date().toISOString()
    };
  }

  async runProbe() {
    return [];
  }
}

class FakeSync {
  issueComments = 0;

  async addIssueComment(): Promise<void> {
    this.issueComments += 1;
  }

  async addPullRequestComment(): Promise<void> {
    return undefined;
  }

  async submitPullRequestReview(): Promise<void> {
    return undefined;
  }

  async syncIssue(): Promise<void> {
    return undefined;
  }

  async syncPullRequest(): Promise<void> {
    return undefined;
  }
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-offline-actions-test-"));
const database = new DatabaseService(path.join(tempDir, "fallback.sqlite"));
let service: OfflineWritebackQueueService | null = null;

try {
  const account = database.localCache.accounts.upsertGitHubAccount({
    id: 42,
    login: "mona",
    avatarUrl: null,
    tokenSource: "keychain",
    authStatus: "connected"
  });
  database.localCache.accounts.setActiveGitHubAccount(account.id);
  insertRepo(database, tempDir);
  insertPullRequest(database, "head-a");

  const created = database.localCache.offlineActions.createOfflineAction({
    repoId: "octo-repo",
    actionType: "issue_comment",
    entityType: "issue",
    entityNumber: 12,
    body: "Queued body",
    payload: { actionType: "issue_comment", body: "Queued body" }
  });
  assert.equal(created.status, "queued");
  assert.equal(database.localCache.offlineActions.offlineActionSummary().active, 1);

  const updated = database.localCache.offlineActions.updateOfflineAction(created.id, {
    body: "Updated body",
    payload: { actionType: "issue_comment", body: "Updated body" }
  });
  assert.equal(updated.body, "Updated body");

  database.localCache.offlineActions.markOfflineActionSending(created.id);
  database.db
    .prepare("UPDATE offline_actions SET last_attempt_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 10 * 60_000).toISOString(), created.id);
  assert.equal(database.localCache.offlineActions.recoverInterruptedOfflineActions(), 1);
  assert.equal(database.localCache.offlineActions.getOfflineAction(created.id)?.status, "failed_retryable");

  const cancelled = database.localCache.offlineActions.cancelOfflineAction(created.id);
  assert.equal(cancelled.status, "cancelled");

  const sync = new FakeSync();
  const health = new FakeHealth();
  service = new OfflineWritebackQueueService(database, sync as never, health as never, { onChanged: () => undefined });

  health.state = "offline";
  const queued = await service.submitIssueComment("octo-repo", 12, "Send later", { clientOnline: false });
  assert.equal(queued.mode, "queued");
  assert.equal(sync.issueComments, 0);

  health.state = "online";
  database.db.prepare("UPDATE offline_actions SET next_attempt_at = ? WHERE id = ?").run(new Date(0).toISOString(), queued.action.id);
  await service.flushDueActions("test");
  assert.equal(sync.issueComments, 1);
  assert.equal(database.localCache.offlineActions.getOfflineAction(queued.action.id)?.status, "sent");

  health.state = "offline";
  const review = await service.submitPullRequestReview(
    "octo-repo",
    7,
    {
      event: "COMMENT",
      comments: [{ path: "src/app.ts", body: "Inline", line: 2, side: "RIGHT" }]
    },
    { clientOnline: false }
  );
  assert.equal(review.mode, "queued");
  database.db.prepare("UPDATE pull_requests SET head_sha = ? WHERE repo_id = ? AND number = ?").run("head-b", "octo-repo", 7);
  database.db.prepare("UPDATE offline_actions SET next_attempt_at = ? WHERE id = ?").run(new Date(0).toISOString(), review.action.id);
  health.state = "online";
  await service.flushDueActions("test");
  const blocked = database.localCache.offlineActions.getOfflineAction(review.action.id);
  assert.equal(blocked?.status, "blocked");
  assert.equal(blocked?.lastErrorCode, "pr_head_changed");

  console.log("Offline action queue tests ok");
} finally {
  service?.stop();
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
