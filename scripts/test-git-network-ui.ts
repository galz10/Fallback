import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OperationStatusPanel } from "../src/renderer/components/OperationStatusPanel.js";
import { GitNetworkStatusPill, gitNetworkStatusTone } from "../src/renderer/features/repo-code/GitNetworkControls.js";
import type { LocalGitNetworkPreflight } from "../src/shared/domain/local-git.js";
import type { OperationRecord } from "../src/shared/domain/operation.js";

const root = process.cwd();
const controlsSource = readFileSync(path.join(root, "src/renderer/features/repo-code/GitNetworkControls.tsx"), "utf8");
const repoViewSource = readFileSync(path.join(root, "src/renderer/features/repo-code/RepoCodeView.tsx"), "utf8");
const filesWorkflowSource = readFileSync(path.join(root, "src/renderer/features/repo-code/FilesWorkflow.tsx"), "utf8");
const paletteSource = readFileSync(path.join(root, "src/renderer/features/command-palette/CommandPalette.tsx"), "utf8");
const paletteCatalogSource = readFileSync(
  path.join(root, "src/renderer/features/command-palette/CommandPalette.action-catalog.ts"),
  "utf8"
);

assert.match(repoViewSource, /FilesWorkflow/);
assert.match(filesWorkflowSource, /<GitNetworkControls repo=\{repo\} \/>/);
assert.match(controlsSource, /gitNetworkPreflight/);
assert.match(controlsSource, /fetchWorkspace/);
assert.match(controlsSource, /pullWorkspace/);
assert.match(controlsSource, /pushWorkspace/);
assert.match(controlsSource, /publishWorkspace/);
assert.match(controlsSource, /OperationStatusPanel/);
assert.match(controlsSource, /CredentialDiagnosticsDialog/);
assert.match(controlsSource, /Identity/);

for (const label of ["Fetch", "Pull", "Push", "Publish branch"]) {
  assert.ok(controlsSource.includes(label), `missing visible label ${label}`);
}

for (const state of [
  "stale",
  "offline",
  "auth_failed",
  "rejected",
  "protected_branch",
  "non_fast_forward",
  "diverged",
  "conflict",
  "dirty_worktree",
  "no_upstream"
]) {
  assert.ok(controlsSource.includes(state), `missing UI state ${state}`);
}

for (const command of ["repo-git-fetch", "repo-git-pull", "repo-git-push", "repo-git-publish"]) {
  assert.ok(paletteCatalogSource.includes(command), `missing command palette action ${command}`);
}
assert.match(paletteSource, /buildCurrentRepoActionCatalog/);

const loadingHtml = renderToStaticMarkup(React.createElement(GitNetworkStatusPill, { preflight: null, loading: true }));
assert.ok(loadingHtml.includes("Checking"));

const successHtml = renderToStaticMarkup(
  React.createElement(GitNetworkStatusPill, {
    preflight: preflightFixture("up_to_date", "Branch is up to date with its upstream."),
    loading: false
  })
);
assert.ok(successHtml.includes("Branch is up to date"));
assert.ok(successHtml.includes("emerald"));

const rejectedHtml = renderToStaticMarkup(
  React.createElement(GitNetworkStatusPill, { preflight: preflightFixture("rejected", "Remote rejected the push."), loading: false })
);
assert.ok(rejectedHtml.includes("Remote rejected the push"));
assert.ok(rejectedHtml.includes("red"));

const conflictHtml = renderToStaticMarkup(
  React.createElement(GitNetworkStatusPill, {
    preflight: preflightFixture("conflict", "Resolve merge conflicts before continuing."),
    loading: false
  })
);
assert.ok(conflictHtml.includes("Resolve merge conflicts"));
assert.ok(conflictHtml.includes("red"));

const authFailedOperationHtml = renderToStaticMarkup(
  React.createElement(OperationStatusPanel, {
    operations: [operationFixture("push_branch", "failed", "git_network_auth_failed", "Authentication failed.")],
    onOpenDiagnostics: () => undefined,
    onRetry: () => undefined
  })
);
assert.ok(authFailedOperationHtml.includes("Diagnostics"));
assert.ok(authFailedOperationHtml.includes("Retry"));
assert.ok(authFailedOperationHtml.includes("Authentication failed"));

assert.match(gitNetworkStatusTone("stale"), /amber/);
assert.match(gitNetworkStatusTone("offline"), /amber/);
assert.match(gitNetworkStatusTone("non_fast_forward"), /red/);
assert.match(gitNetworkStatusTone("protected_branch"), /red/);

console.log("Git network UI tests ok");

function preflightFixture(status: LocalGitNetworkPreflight["status"], statusMessage: string): LocalGitNetworkPreflight {
  return {
    repoId: "octo-repo",
    repoFullName: "octo/repo",
    workspacePath: "/tmp/repo",
    identityLabel: "Fallback Test <fallback-test@example.com>",
    branch: "main",
    headSha: "abc123",
    upstream: "origin/main",
    upstreamRemote: "origin",
    upstreamBranch: "main",
    remoteUrl: "file:///tmp/remote.git",
    remoteProtocol: "file",
    ahead: 0,
    behind: 0,
    isDirty: false,
    hasUpstream: true,
    pullStrategy: "ff-only",
    credentialStatus: "ok",
    credentialSummary: "Credentials look ready.",
    branchProtectionHint: null,
    signingPolicyHint: null,
    status,
    statusMessage,
    actionLabels: {
      fetch: "Fetch",
      pull: "Pull from origin/main",
      push: "Push 3 commits",
      publish: "Publish branch"
    },
    generatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function operationFixture(
  kind: string,
  status: OperationRecord["status"],
  errorCode: string | null,
  errorMessage: string | null
): OperationRecord {
  return {
    id: "op-network",
    repoId: "octo-repo",
    repoFullName: "octo/repo",
    workspaceId: "workspace-1",
    workspacePath: "/tmp/repo",
    workspaceBranch: "main",
    kind,
    status,
    riskLevel: "normal",
    commandSummary: "Push 3 commits",
    redactedCommand: "git push <remote:origin> HEAD:<branch:main>",
    recoveryHeadSha: "abc123",
    recoveryBranch: "main",
    recoveryIsDirty: false,
    recoveryFileCount: 0,
    recoveryStashRefs: [],
    recoveryHint: null,
    recoveryReflogHint: "Inspect git reflog around abc123.",
    recoveryRef: null,
    resultSummary: null,
    resultStashRefs: [],
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
    errorCode,
    errorMessage,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z"
  };
}
