import assert from "node:assert/strict";
import type { BranchIntegrityFinding } from "../src/shared/domain/branch-integrity.js";
import type { OperationRecord } from "../src/shared/domain/operation.js";
import type { RepoWorkspace } from "../src/shared/domain/watched-repo.js";
import { emptyPullRequestReviewDraft, upsertReviewDraftComment } from "../src/shared/pr-review-drafts.js";
import {
  branchSafetyFindingCopy,
  branchSafetyReport,
  operationSafetyCopy,
  reviewContinuityCopy,
  workspaceProductCopy
} from "../src/shared/product-coherence.js";

const finding = branchFinding({ kind: "tested_tree_mismatch", severity: "critical" });
const findingCopy = branchSafetyFindingCopy(finding);
assert.equal(findingCopy.label, "Merged code differs from tested code");
assert.match(findingCopy.whyItMatters, /merge queue/);
assert.match(branchSafetyReport([finding]), /Branch Watch report/);
assert.match(branchSafetyReport([finding]), /What happened:/);

const draft = {
  ...emptyPullRequestReviewDraft({ repoId: "octo-repo", prNumber: 9, headSha: "head-a" }),
  comments: upsertReviewDraftComment([], {
    id: "draft-1",
    fileId: "src/app.ts",
    path: "src/app.ts",
    body: "Check this guard.",
    line: 10,
    side: "RIGHT",
    diffSide: "additions"
  }),
  reviewedFiles: ["src/app.ts"]
};
const continuity = reviewContinuityCopy({ draft, currentHeadSha: "head-b", online: false, accountLogin: "mona" });
assert.equal(continuity.hasWork, true);
assert.equal(continuity.headState, "stale");
assert.match(continuity.summary, /new commits/);
assert.match(continuity.sendPreview, /queue locally/);

const safety = operationSafetyCopy(operationRecord({ status: "blocked", recoveryHint: "Commit or stash local changes before pulling." }));
assert.match(safety.state, /main/);
assert.match(safety.risk, /destructive risk/);
assert.match(safety.recovery, /Commit or stash/);

const dirtyWorkspace = workspaceProductCopy(workspace({ kind: "worktree", isDirty: true }));
assert.equal(dirtyWorkspace.displayKind, "Parallel workspace");
assert.equal(dirtyWorkspace.cleanupStatus, "dirty");
assert.match(dirtyWorkspace.cleanupDetail, /Commit, stash/);

console.log("product coherence copy tests ok");

function branchFinding(patch: Partial<BranchIntegrityFinding>): BranchIntegrityFinding {
  return {
    id: "finding-1",
    repoId: "octo-repo",
    branchName: "main",
    severity: patch.severity ?? "high",
    kind: patch.kind ?? "unexpected_direct_push",
    title: "Internal title",
    summary: "The branch changed after the last trusted checkpoint.",
    landedSha: "a".repeat(40),
    expectedSha: "b".repeat(40),
    landedTreeSha: "c".repeat(40),
    expectedTreeSha: "d".repeat(40),
    prNumbers: [7],
    confidence: "strong",
    evidence: {},
    status: "open",
    recoveryPlan: patch.recoveryPlan ?? null,
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
    resolvedAt: null
  };
}

function operationRecord(patch: Partial<OperationRecord>): OperationRecord {
  return {
    id: "op-1",
    repoId: "octo-repo",
    repoFullName: "octo/repo",
    workspaceId: "workspace-1",
    workspacePath: "/tmp/repo",
    workspaceBranch: "main",
    kind: "pull_branch",
    status: patch.status ?? "succeeded",
    riskLevel: "destructive",
    commandSummary: "Pull with --ff-only",
    redactedCommand: "git pull --ff-only",
    recoveryHeadSha: null,
    recoveryBranch: "main",
    recoveryIsDirty: true,
    recoveryFileCount: 2,
    recoveryStashRefs: [],
    recoveryHint: patch.recoveryHint ?? null,
    recoveryReflogHint: null,
    recoveryRef: null,
    resultSummary: patch.resultSummary ?? null,
    resultStashRefs: [],
    errorCode: null,
    errorMessage: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z"
  };
}

function workspace(patch: Partial<RepoWorkspace>): RepoWorkspace {
  return {
    id: "workspace-1",
    repoId: "octo-repo",
    kind: patch.kind ?? "clone",
    localPath: patch.localPath ?? "/tmp/repo/fallback-codex-work",
    gitCommonDir: null,
    gitDir: null,
    mainWorktreePath: "/tmp/repo",
    branch: patch.branch ?? "feature",
    headSha: "a".repeat(40),
    isActive: false,
    isDirty: patch.isDirty ?? false,
    locked: patch.locked ?? false,
    lockReason: null,
    prunable: patch.prunable ?? false,
    pruneReason: null,
    detached: false,
    bare: false,
    missing: patch.missing ?? false,
    lastSeenAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}
