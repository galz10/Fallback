import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  OperationStatusPanel,
  operationCanRetry,
  operationNextStep,
  operationReport
} from "../src/renderer/components/OperationStatusPanel.js";
import type { OperationRecord } from "../src/shared/domain/operation.js";

const failedOperation: OperationRecord = {
  id: "op-1",
  repoId: "octo-repo",
  repoFullName: "octo/repo",
  kind: "stage_all",
  status: "failed",
  riskLevel: "low",
  commandSummary: "Stage all local changes",
  redactedCommand: "git add -A",
  recoveryHeadSha: "abc123",
  recoveryBranch: "main",
  recoveryIsDirty: true,
  recoveryFileCount: 2,
  recoveryStashRefs: [],
  recoveryHint: "Keep your current worktree and retry after resolving the index lock.",
  recoveryReflogHint: "Inspect git reflog around abc123.",
  recoveryRef: null,
  resultSummary: null,
  resultStashRefs: [],
  startedAt: "2026-01-01T00:00:00.000Z",
  completedAt: "2026-01-01T00:00:01.500Z",
  durationMs: 1500,
  errorCode: "stage_all_failed",
  errorMessage: "Unable to create .git/index.lock",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:01.500Z"
};

const html = renderToStaticMarkup(
  React.createElement(OperationStatusPanel, {
    operations: [failedOperation],
    onCopyReport: () => undefined,
    onOpenDiagnostics: () => undefined,
    onRetry: () => undefined
  })
);
const dismissHtml = renderToStaticMarkup(
  React.createElement(OperationStatusPanel, {
    operations: [failedOperation],
    onDismiss: () => undefined
  })
);

assert.ok(html.includes("Stage all local changes"));
assert.ok(html.includes("failed"));
assert.ok(html.includes("1.5s"));
assert.ok(html.includes("Unable to create .git/index.lock"));
assert.ok(html.includes("git add -A"));
assert.ok(html.includes("Before this operation, HEAD was abc123 on main."));
assert.ok(html.includes("Copy report"));
assert.ok(html.includes("Diagnostics"));
assert.ok(html.includes("Retry"));
assert.ok(dismissHtml.includes("Dismiss"));
assert.equal(operationCanRetry(failedOperation), true);
assert.match(operationNextStep(failedOperation), /retry after resolving/);

const report = operationReport(failedOperation);
assert.match(report, /Command: git add -A/);
assert.match(report, /Recovery dirty: yes/);
assert.match(report, /Duration: 1.5s/);
assert.ok(!report.includes("index.lock --token"));

console.log("Operation status panel tests ok");
