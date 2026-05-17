import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { operationReport } from "../src/renderer/components/OperationStatusPanel.js";
import { ActiveConflictPanel, ConflictRiskPanel, conflictReport } from "../src/renderer/features/local-changes/ConflictPanels.js";
import type { LocalGitConflictPreflight, LocalGitConflictState } from "../src/shared/domain/local-git.js";

const risk = conflictRiskFixture();
const riskHtml = renderToStaticMarkup(
  React.createElement(ConflictRiskPanel, {
    risk,
    onOpenLocalChanges: () => undefined,
    onFetch: () => undefined,
    onCopy: () => undefined
  })
);
assert.ok(riskHtml.includes("pull may conflict"));
assert.ok(riskHtml.includes("1 overlap"));
assert.ok(riskHtml.includes("Stash selected files"));
assert.ok(riskHtml.includes("Open diff"));

const state = conflictStateFixture("merge");
const stateHtml = renderToStaticMarkup(
  React.createElement(ActiveConflictPanel, {
    state,
    busy: false,
    onOpenFile: () => undefined,
    onOpenMergeTool: () => undefined,
    onAbort: () => undefined,
    onCopy: () => undefined
  })
);
assert.ok(stateHtml.includes("Merge conflict"));
assert.ok(stateHtml.includes("Abort"));
assert.ok(stateHtml.includes("Open merge tool"));
assert.ok(stateHtml.includes("Binary conflict"));

const resolvedHtml = renderToStaticMarkup(
  React.createElement(ActiveConflictPanel, {
    state: conflictStateFixture("none"),
    busy: false,
    onOpenFile: () => undefined,
    onOpenMergeTool: () => undefined,
    onAbort: () => undefined,
    onCopy: () => undefined
  })
);
assert.equal(resolvedHtml, "");

const stagedResolutionHtml = renderToStaticMarkup(
  React.createElement(ActiveConflictPanel, {
    state: conflictStateFixture("merge", []),
    busy: false,
    onOpenFile: () => undefined,
    onOpenMergeTool: () => undefined,
    onAbort: () => undefined,
    onCopy: () => undefined
  })
);
assert.equal(stagedResolutionHtml, "");

const abortReport = operationReport(operationFixture("abort_conflict", "succeeded", null, null));
assert.match(abortReport, /Abort active Git operation/);
assert.match(abortReport, /Recovery safety ref/);

assert.match(conflictReport(risk), /Conflict risk: high/);
assert.match(conflictReport(state), /Conflict state: merge/);

const localChangesSource = readFileSync(new URL("../src/renderer/features/local-changes/LocalChangesView.tsx", import.meta.url), "utf8");
assert.match(localChangesSource, /operation: action === "pop" \? "stash_pop" : "stash_apply"/);
assert.match(localChangesSource, /if \(!changes\?\.isDirty\)/);
assert.match(localChangesSource, /stashConflictRisk=\{null\}/);
assert.match(localChangesSource, /Drop \$\{ref\}\?/);

const localChangesDataSource = readFileSync(
  new URL("../src/renderer/features/local-changes/useLocalChangesData.ts", import.meta.url),
  "utf8"
);
assert.doesNotMatch(localChangesDataSource, /stash_apply/);
assert.doesNotMatch(localChangesDataSource, /conflictRisk/);

const commandPaletteSource = readFileSync(new URL("../src/renderer/features/command-palette/CommandPalette.tsx", import.meta.url), "utf8");
const commandPaletteCatalogSource = readFileSync(
  new URL("../src/renderer/features/command-palette/CommandPalette.action-catalog.ts", import.meta.url),
  "utf8"
);
assert.match(commandPaletteSource, /buildCurrentRepoActionCatalog/);
assert.match(commandPaletteCatalogSource, /repo-conflict-open-first-file/);
assert.match(commandPaletteCatalogSource, /repo-conflict-open-merge-tool/);

const diffInspectorSource = readFileSync(new URL("../src/renderer/features/local-changes/DiffInspector.tsx", import.meta.url), "utf8");
assert.match(diffInspectorSource, /PierreUnresolvedFile/);
assert.match(diffInspectorSource, /onMergeConflictResolve/);
assert.doesNotMatch(diffInspectorSource, /renderMergeConflictUtility/);
assert.match(diffInspectorSource, /onResolveConflictFile/);

const preloadSource = readFileSync(new URL("../electron/preload/index.ts", import.meta.url), "utf8");
assert.match(preloadSource, /reposResolveConflictFile/);

console.log("Conflict UI tests ok");

function conflictRiskFixture(): LocalGitConflictPreflight {
  return {
    repoId: "octo-repo",
    repoFullName: "octo/repo",
    workspacePath: "/tmp/repo",
    branch: "main",
    operation: "pull",
    targetRef: "origin/main",
    riskLevel: "high",
    summary: "pull may conflict: 1 dirty files overlap origin/main.",
    dirtyFileCount: 2,
    overlappingFileCount: 1,
    targetFileCount: 3,
    binaryFileCount: 0,
    lfsFileCount: 0,
    staleBase: true,
    diverged: false,
    activeConflict: conflictStateFixture("none"),
    files: [
      {
        path: "shared.txt",
        dirty: true,
        touchedByTarget: true,
        isBinary: false,
        isLfsPointer: false,
        cue: null
      }
    ],
    safeAlternatives: ["Stash selected files", "Open diff", "Fetch first", "Abort"],
    generatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function operationFixture(kind: string, status: "succeeded" | "failed", errorCode: string | null, errorMessage: string | null) {
  return {
    id: "op-conflict",
    repoId: "octo-repo",
    repoFullName: "octo/repo",
    workspaceId: "workspace-1",
    workspacePath: "/tmp/repo",
    workspaceBranch: "main",
    kind,
    status,
    riskLevel: "destructive",
    commandSummary: "Abort active Git operation",
    redactedCommand: "git merge/rebase/cherry-pick/revert --abort",
    recoveryHeadSha: "abc123",
    recoveryBranch: "main",
    recoveryIsDirty: true,
    recoveryFileCount: 1,
    recoveryStashRefs: [],
    recoveryHint: "Before this operation, HEAD was abc123 on main.",
    recoveryReflogHint: "Inspect git reflog around abc123.",
    recoveryRef: "refs/fallback/operations/abort_conflict/abc123",
    resultSummary: "Active Git operation aborted.",
    resultStashRefs: [],
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
    errorCode,
    errorMessage,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z"
  } as const;
}

function conflictStateFixture(
  state: LocalGitConflictState["state"],
  files: LocalGitConflictState["files"] = state === "none"
    ? []
    : [
        {
          path: "image.bin",
          previousPath: null,
          status: "both_modified",
          stages: [1, 2, 3],
          isBinary: true,
          isLfsPointer: false,
          cue: "Binary conflict. Do not edit blindly; choose one side or use a binary-aware tool."
        }
      ]
): LocalGitConflictState {
  return {
    repoId: "octo-repo",
    repoFullName: "octo/repo",
    workspacePath: "/tmp/repo",
    branch: "main",
    headSha: "abc123",
    state,
    isActive: files.length > 0,
    operationLabel: state === "merge" ? "Merge" : "No conflict",
    fileCount: files.length,
    binaryCount: files.filter((file) => file.isBinary).length,
    lfsCount: 0,
    recoveryHint:
      files.length === 0 ? null : "Resolve each conflicted file, stage the resolutions, then continue or abort the Git operation.",
    files,
    generatedAt: "2026-01-01T00:00:00.000Z"
  };
}
