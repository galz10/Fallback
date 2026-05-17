import assert from "node:assert/strict";
import {
  operationRecoveryCopy,
  operationRecoveryState,
  recoveryCommandBundle,
  recoveryRecordHint,
  recoveryReflogHint,
  recoverySafetyRef
} from "../src/shared/operation-recovery.js";
import type { OperationRecord } from "../src/shared/domain/operation.js";

const operation = record({
  id: "op-123",
  recoveryHeadSha: "abc123",
  recoveryRef: "refs/fallback/recovery/main-before-pull",
  recoveryReflogHint: "Inspect git reflog around abc123.",
  resultStashRefs: ["stash@{0}"],
  completedAt: new Date().toISOString()
});

const state = operationRecoveryState(operation);
assert.equal(state.status, "available");
assert.ok(state.actions.some((action) => action.kind === "restore_safety_ref" && action.available));
assert.ok(state.actions.some((action) => action.kind === "apply_result_stash" && action.command === "git stash apply stash@{0}"));
assert.match(recoveryCommandBundle(operation), /git switch -c fallback-recovery-op123 refs\/fallback\/recovery\/main-before-pull/);

const stale = operationRecoveryState(
  record({
    recoveryHeadSha: "abc123",
    recoveryRef: "refs/fallback/recovery/old",
    completedAt: "2026-01-01T00:00:00.000Z"
  }),
  new Date("2026-01-10T00:00:00.000Z")
);
assert.equal(stale.status, "stale");
assert.equal(stale.actions.find((action) => action.kind === "restore_safety_ref")?.available, false);

const noRecoveryOperation = record({ recoveryHeadSha: null, recoveryRef: null, recoveryReflogHint: null, resultStashRefs: [] });
const none = operationRecoveryState(noRecoveryOperation);
assert.equal(none.status, "none");
assert.equal(operationRecoveryCopy(noRecoveryOperation), null);

assert.equal(recoveryReflogHint("abc123"), "Inspect git reflog around abc123 or run git show abc123 to review the pre-operation commit.");
assert.equal(recoverySafetyRef({ operationId: "op/123", operationKind: "discard file" }), "refs/fallback/operations/discard-file/op-123");
assert.match(
  recoveryRecordHint({
    headSha: "abc123",
    branch: "main",
    isDirty: true,
    fileCount: 2,
    stashRefs: ["stash@{0}"],
    safetyRef: "refs/fallback/operations/discard_file/op-1",
    reflogHint: "Inspect git reflog around abc123."
  }) ?? "",
  /worktree was dirty with 2 changed files/
);

console.log("Operation recovery tests ok");

function record(patch: Partial<OperationRecord>): OperationRecord {
  return {
    id: "op",
    repoId: "repo-1",
    repoFullName: "octo/repo",
    workspaceId: "workspace-1",
    workspacePath: "/tmp/repo",
    workspaceBranch: "main",
    kind: "pull_branch",
    status: "failed",
    riskLevel: "normal",
    commandSummary: "Pull from origin/main",
    redactedCommand: "git pull --ff-only <remote:origin> <branch:main>",
    recoveryHeadSha: "abc123",
    recoveryBranch: "main",
    recoveryIsDirty: false,
    recoveryFileCount: 0,
    recoveryStashRefs: [],
    recoveryHint: null,
    recoveryReflogHint: "Inspect git reflog around abc123.",
    recoveryRef: "refs/fallback/recovery/main-before-pull",
    resultSummary: null,
    resultStashRefs: [],
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
    errorCode: "git_network_conflict",
    errorMessage: "conflict",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    ...patch
  };
}
