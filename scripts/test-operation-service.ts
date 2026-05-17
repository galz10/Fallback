import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "../electron/main/database-service.js";
import { gitRaw } from "../electron/main/git-command.js";
import { SyncService } from "../electron/main/sync-service.js";
import type { GitHubClient } from "../electron/main/github-client.js";
import type { WorkspaceService } from "../electron/main/workspace-service.js";
import { localGitOperationPolicy } from "../electron/main/modules/local-git/local-git-operation-catalog.js";
import {
  createOperationRecordFixture,
  createOperationServiceFixture,
  insertWatchedRepoFixture
} from "./helpers/operation-record-fixtures.js";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-operation-test-"));
const database = new DatabaseService(path.join(tempDir, "fallback.sqlite"));

try {
  assert.equal(localGitOperationPolicy("discard_file").createsSafetyRef, true);
  assert.equal(localGitOperationPolicy("switch_workspace").capturesRecovery, false);
  assert.equal(localGitOperationPolicy("remove_workspace", "destructive").riskLevel, "destructive");

  insertWatchedRepoFixture(database, { id: "octo-repo", workspacePath: tempDir, localPath: tempDir });
  const account = database.localCache.accounts.upsertGitHubAccount({
    id: 1,
    login: "mona",
    endpoint: "https://api.github.com",
    avatarUrl: null,
    tokenSource: "environment",
    authStatus: "connected"
  });
  database.localCache.repoAccounts.associateRepoAccount("octo-repo", account, { pull: true, push: true }, { watchEnabled: true });
  const operations = createOperationServiceFixture(database);

  const value = await operations.run({
    repoId: "octo-repo",
    kind: "stage_all",
    riskLevel: "low",
    commandSummary: "Stage all local changes",
    redactedCommand: "git add -A",
    execute: async () => "ok"
  });
  assert.equal(value, "ok");
  const success = database.localCache.operationRecords.listRecent("octo-repo").find((operation) => operation.kind === "stage_all");
  assert.equal(success?.status, "succeeded");
  assert.equal(success?.redactedCommand, "git add -A");
  assert.ok(success?.workspaceId);
  assert.equal(success?.workspacePath, tempDir);
  assert.equal(success?.workspaceBranch, null);
  assert.ok((success?.durationMs ?? -1) >= 0);

  await assert.rejects(
    operations.run({
      repoId: "octo-repo",
      kind: "commit",
      commandSummary: "Commit: secret",
      redactedCommand: "git commit -m <summary>",
      execute: async () => {
        throw new Error("commit rejected");
      }
    }),
    /commit rejected/
  );
  const failure = database.localCache.operationRecords.listRecent("octo-repo").find((operation) => operation.kind === "commit");
  assert.equal(failure?.status, "failed");
  assert.equal(failure?.errorCode, "commit_failed");
  assert.equal(failure?.redactedCommand, "git commit -m <summary>");
  assert.ok(!failure?.redactedCommand?.includes("secret"));

  await assert.rejects(
    operations.run({
      repoId: "octo-repo",
      kind: "stash",
      commandSummary: "Stash local changes",
      redactedCommand: "git stash push -u -m <message>",
      timeoutMs: 20,
      execute: async () => new Promise(() => undefined)
    }),
    /timed out/
  );
  const timedOut = database.operationRecords
    .listRecent("octo-repo")
    .find((operation) => operation.kind === "stash" && operation.errorCode === "operation_timeout");
  assert.equal(timedOut?.status, "failed");
  assert.equal(timedOut?.errorCode, "operation_timeout");

  const running = operations.run({
    repoId: "octo-repo",
    kind: "stage_all",
    commandSummary: "Stage all local changes",
    redactedCommand: "git add -A",
    execute: async ({ signal }) =>
      new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => resolve("late"), 10_000);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timeout);
            reject(new Error("cancelled by signal"));
          },
          { once: true }
        );
      })
  });
  const active = await waitForActiveOperation(database, "octo-repo");
  await assert.rejects(
    operations.run({
      repoId: "octo-repo",
      kind: "unstage_all",
      commandSummary: "Unstage all local changes",
      redactedCommand: "git reset",
      execute: async () => "blocked"
    }),
    /Another operation is already running/
  );
  operations.cancel(active.id);
  await assert.rejects(running, /cancellation|cancelled/i);
  const cancelled = database.localCache.operationRecords.get(active.id);
  assert.equal(cancelled?.status, "cancelled");
  assert.equal(cancelled?.errorCode, "operation_cancelled");

  await gitRaw(tempDir, ["init"]);
  const gitStartedAt = Date.now();
  const runningGit = operations.run({
    repoId: "octo-repo",
    kind: "fetch_branch",
    commandSummary: "Slow git command",
    redactedCommand: "git fallback-sleep",
    timeoutMs: 30_000,
    execute: async ({ signal }) =>
      gitRaw(tempDir, ["-c", 'alias.fallback-sleep=!node -e "setTimeout(() => {}, 10000)"', "fallback-sleep"], 30_000, [0], signal)
  });
  const activeGit = await waitForActiveOperation(database, "octo-repo");
  operations.cancel(activeGit.id);
  await assert.rejects(runningGit, /cancellation/i);
  assert.ok(Date.now() - gitStartedAt < 5_000, "expected cancellation to abort the in-flight git process");

  const timeoutGitStartedAt = Date.now();
  await assert.rejects(
    operations.run({
      repoId: "octo-repo",
      kind: "pull_branch",
      commandSummary: "Slow timeout git command",
      redactedCommand: "git fallback-timeout",
      timeoutMs: 50,
      execute: async ({ signal }) =>
        gitRaw(tempDir, ["-c", 'alias.fallback-timeout=!node -e "setTimeout(() => {}, 10000)"', "fallback-timeout"], 30_000, [0], signal)
    }),
    /timed out/
  );
  assert.ok(Date.now() - timeoutGitStartedAt < 5_000, "expected timeout to abort the in-flight git process");
  const timedOutGit = database.operationRecords
    .listRecent("octo-repo")
    .find((operation) => operation.kind === "pull_branch" && operation.errorCode === "operation_timeout");
  assert.equal(timedOutGit?.status, "failed");

  createOperationRecordFixture(database, {
    repoId: "octo-repo",
    kind: "discard_file",
    status: "running",
    riskLevel: "destructive",
    commandSummary: "Discard README.md",
    redactedCommand: "git restore -- <path:README.md>"
  });
  const sync = new SyncService(
    database,
    {
      ensureRepoFolder: () => tempDir,
      ensureRepoClone: async () => tempDir,
      repoPath: () => tempDir,
      updateRepoMarker: () => undefined
    } as unknown as WorkspaceService,
    { getRateLimit: () => null } as unknown as GitHubClient
  );
  const deferred = await sync.enqueueRepoSync("octo-repo", "background_repo_sync");
  const syncJob = database.localCache.syncJobs.getSyncJob(deferred.id);
  assert.ok(syncJob?.notBefore);
  assert.equal(syncJob?.progressMessage, "Paused while a foreground operation is running");

  console.log("Operation service tests ok");
} finally {
  database.close();
  await rm(tempDir, { force: true, recursive: true });
}

async function waitForActiveOperation(db: DatabaseService, repoId: string) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const operation = db.operationRecords.active(repoId);
    if (operation?.status === "running") return operation;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for active operation.");
}
