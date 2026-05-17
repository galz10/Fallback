import assert from "node:assert/strict";
import { errorCode, isGitSigningError } from "../electron/main/error-classification.js";
import { operationNextStep } from "../src/renderer/components/OperationStatusPanel.js";
import type { OperationRecord } from "../src/shared/domain/operation.js";

const gpgFailure = new Error("error: gpg failed to sign the data\nfatal: failed to write commit object");
assert.equal(isGitSigningError(gpgFailure), true);
assert.equal(errorCode(gpgFailure, "commit_failed"), "git_signing_failed");

const sshFailure = new Error("error: Couldn't load public key /Users/example/.ssh/missing.pub: No such file or directory");
assert.equal(isGitSigningError(sshFailure), true);
assert.equal(errorCode(sshFailure, "commit_failed"), "git_signing_failed");

assert.equal(errorCode(new Error("commit rejected by hook"), "commit_failed"), "commit_failed");

const signingOperation: OperationRecord = {
  id: "op-signing",
  repoId: "octo-repo",
  repoFullName: "octo/repo",
  kind: "commit",
  status: "failed",
  riskLevel: "normal",
  commandSummary: "Commit: Update docs",
  redactedCommand: "git commit -m <summary>",
  recoveryHeadSha: null,
  recoveryBranch: null,
  recoveryIsDirty: null,
  recoveryFileCount: null,
  recoveryStashRefs: [],
  recoveryHint: null,
  recoveryReflogHint: null,
  recoveryRef: null,
  resultSummary: null,
  resultStashRefs: [],
  startedAt: "2026-01-01T00:00:00.000Z",
  completedAt: "2026-01-01T00:00:01.000Z",
  durationMs: 1000,
  errorCode: "git_signing_failed",
  errorMessage: gpgFailure.message,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:01.000Z"
};

assert.match(operationNextStep(signingOperation), /Commit signing failed/);
assert.match(operationNextStep(signingOperation), /user\.signingkey/);

console.log("Commit signing failure tests ok");
