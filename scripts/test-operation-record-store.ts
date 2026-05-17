import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "../electron/main/database-service.js";
import { insertWatchedRepoFixture, upsertRepoWorkspaceFixture } from "./helpers/operation-record-fixtures.js";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-operation-record-store-test-"));
const database = new DatabaseService(path.join(tempDir, "fallback.sqlite"));

try {
  insertWatchedRepoFixture(database, { id: "octo-repo", workspacePath: tempDir, localPath: tempDir });
  upsertRepoWorkspaceFixture(database, { id: "workspace-1", repoId: "octo-repo", localPath: tempDir });

  const store = database.operationRecords;
  const first = store.create({
    repoId: "octo-repo",
    workspaceId: "workspace-1",
    workspacePath: tempDir,
    workspaceBranch: "main",
    kind: "discard_file",
    riskLevel: "destructive",
    commandSummary: "Discard README.md",
    redactedCommand: "git restore/clean -- <path:README.md>",
    recoveryHeadSha: "abc123",
    recoveryBranch: "main",
    recoveryIsDirty: true,
    recoveryFileCount: 2,
    recoveryStashRefs: ["stash@{0}"],
    recoveryHint: "Before this operation, HEAD was abc123.",
    recoveryReflogHint: "Inspect git reflog around abc123.",
    recoveryRef: "refs/fallback/operations/discard_file/op-1"
  });

  assert.equal(first.repoFullName, "octo/repo");
  assert.equal(first.status, "queued");
  assert.equal(first.riskLevel, "destructive");
  assert.equal(first.recoveryIsDirty, true);
  assert.equal(first.recoveryFileCount, 2);
  assert.deepEqual(first.recoveryStashRefs, ["stash@{0}"]);
  assert.equal(first.resultSummary, null);
  assert.deepEqual(first.resultStashRefs, []);

  const updated = store.update(first.id, {
    status: "succeeded",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
    resultSummary: "Created stash stash@{1}.",
    resultStashRefs: ["stash@{1}"]
  });
  assert.equal(updated?.status, "succeeded");
  assert.equal(updated?.durationMs, 1000);
  assert.deepEqual(updated?.resultStashRefs, ["stash@{1}"]);

  const second = store.create({
    repoId: "octo-repo",
    kind: "pull_branch",
    status: "running",
    commandSummary: "Pull from origin/main",
    redactedCommand: "git pull --ff-only <remote:origin> <branch:main>"
  });

  assert.equal(store.active("octo-repo")?.id, second.id);
  assert.deepEqual(
    store.listRecent("octo-repo").map((operation) => operation.id),
    [second.id, first.id]
  );

  const recoveryDiagnostics = store.recoveryDiagnostics();
  assert.equal(recoveryDiagnostics.length, 1);
  assert.equal(recoveryDiagnostics[0]?.repoFullName, "octo/repo");
  assert.equal(recoveryDiagnostics[0]?.recoveryRef, "refs/fallback/operations/discard_file/op-1");

  assert.equal(database.localCache.operationRecords.get(first.id)?.id, first.id);
  assert.equal(database.localCache.operationRecords.listRecent("octo-repo").length, 2);
  assert.equal(database.localCache.operationRecords.active("octo-repo")?.id, second.id);

  console.log("Operation record store tests ok");
} finally {
  database.close();
  await rm(tempDir, { force: true, recursive: true });
}
