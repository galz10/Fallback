import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspaceSelector = await readFile("src/renderer/features/repo-code/WorkspaceSelector.tsx", "utf8");
assert.match(workspaceSelector, /listWorkspaces\(repo\.id\)/);
assert.match(workspaceSelector, /switchWorkspace\(repo\.id, workspaceId\)/);
assert.match(workspaceSelector, /createWorkspace\(repo\.id/);
assert.match(workspaceSelector, /removeWorkspace\(repo\.id, input\.workspace\.id/);
assert.match(workspaceSelector, /pruneWorkspaces\(repo\.id\)/);
assert.match(workspaceSelector, /openEditorAtLine\(workspace\.localPath, null, workspace\.localPath\)/);
assert.match(workspaceSelector, /openTerminal\(workspace\.localPath\)/);
assert.match(workspaceSelector, /force: Boolean\(workspace\.isDirty \|\| workspace\.locked\)/);
assert.match(workspaceSelector, /fallbackWorkspaceId: fallbackWorkspace\?\.id/);
assert.match(workspaceSelector, /canRemoveWorkspace/);
assert.match(workspaceSelector, /Git will be asked to force remove it/);
assert.match(workspaceSelector, /This removes the registered parallel workspace directory from disk/);
assert.match(workspaceSelector, /invalidateWorkspaceFreshness\(queryClient, repo\.id\)/);
assert.match(workspaceSelector, /lastSeenAt/);
assert.match(workspaceSelector, /formatRelative\(workspace\.lastSeenAt\)/);
assert.match(workspaceSelector, /Prune stale workspaces\?/);
assert.match(workspaceSelector, /cleanupLabel/);
assert.match(workspaceSelector, /font-mono/);

const queryFreshness = await readFile("src/renderer/app/query-freshness.ts", "utf8");
assert.match(queryFreshness, /function repoShapeFreshnessInvalidations/);
assert.match(queryFreshness, /rendererQueryKeys\.commitGraph\(repoId\)/);
assert.match(queryFreshness, /rendererQueryKeys\.branchIntegritySummary\(repoId\)/);

const rendererShell = [
  await readFile("src/renderer/main.tsx", "utf8"),
  await readFile("src/renderer/shell/AppShell.tsx", "utf8"),
  await readFile("src/renderer/shell/useRendererEvents.ts", "utf8")
].join("\n");
assert.match(rendererShell, /WorkspaceSelector/);
assert.match(rendererShell, /rendererFreshnessKeys/);

const palette = await readFile("src/renderer/features/command-palette/CommandPalette.tsx", "utf8");
const paletteCatalog = await readFile("src/renderer/features/command-palette/CommandPalette.action-catalog.ts", "utf8");
assert.match(palette, /buildCurrentRepoActionCatalog/);
assert.match(paletteCatalog, /repo-refresh-workspaces/);
assert.match(paletteCatalog, /repo-prune-workspaces/);
assert.match(paletteCatalog, /refreshWorkspaces\(repo\.id\)/);
assert.match(paletteCatalog, /pruneWorkspaces\(repo\.id\)/);

console.log("Repo workspaces UI wiring tests ok");
