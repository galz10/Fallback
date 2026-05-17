import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const repoCodeRenderer = await readFile("src/renderer/features/repo-code/RepoCodeView.tsx", "utf8");
const commitHistoryWorkflow = await readFile("src/renderer/features/repo-code/CommitHistoryWorkflow.tsx", "utf8");
const commitGraphPanel = await readFile("src/renderer/features/repo-code/CommitGraphPanel.tsx", "utf8");
const repoCodeTypes = await readFile("src/shared/domain/repo-code.ts", "utf8");
const fallbackApi = await readFile("src/shared/contracts/fallback-api.ts", "utf8");
const ipcChannels = await readFile("src/shared/contracts/ipc-channels.ts", "utf8");
const preload = await readFile("electron/preload/index.ts", "utf8");
const localGitHandlers = await readFile("electron/main/ipc/local-git.handlers.ts", "utf8");
const graphService = await readFile("electron/main/commit-graph-service.ts", "utf8");

assert.match(repoCodeRenderer, /CommitHistoryWorkflow/);
assert.match(commitHistoryWorkflow, /useState<"graph" \| "list">\("list"\)/);
assert.match(commitHistoryWorkflow, /setHistoryMode\("graph"\)/);
assert.match(commitHistoryWorkflow, /CommitGraphPanel/);
assert.match(commitHistoryWorkflow, /navigator\.clipboard\.writeText\(sha\)/);
assert.match(commitGraphPanel, /Loading commit graph/);
assert.match(commitGraphPanel, /No graph available/);
assert.match(commitGraphPanel, /No commits matched/);
assert.match(commitGraphPanel, /ArrowDown/);
assert.match(commitGraphPanel, /ArrowUp/);
assert.match(commitGraphPanel, /grid-cols-\[112px_72px_minmax\(0,1fr\)_180px_132px\]/);
assert.match(
  commitGraphPanel,
  /<span title="Stations are commits\. Colored rails follow parent history\. Curves show branch or merge movement\.">/
);
assert.match(commitGraphPanel, /const width = 112/);
assert.match(commitGraphPanel, /const maxVisibleLane = 5/);
assert.match(commitGraphPanel, /node\.parentShas\.length > 1/);
assert.match(commitGraphPanel, /const isMerge = node\.parentShas\.length > 1/);
assert.match(commitGraphPanel, /const commitGraphLanePalette =/);
assert.match(commitGraphPanel, /commitGraphLaneColor\(node\.lane\)/);
assert.match(commitGraphPanel, /<path/);
assert.match(commitGraphPanel, /graph\.status === "ok" \|\| graph\.status === "capped" \|\| graph\.status === "stale"/);

assert.match(repoCodeTypes, /export interface CommitGraphViewModel/);
assert.match(repoCodeTypes, /export interface CommitGraphPatch/);
assert.match(fallbackApi, /commitGraph\(repoId: string, options\?: CommitGraphOptions\): Promise<CommitGraphViewModel>/);
assert.match(fallbackApi, /commitGraphPatch\(repoId: string, sha: string\): Promise<CommitGraphPatch>/);
assert.match(ipcChannels, /reposCommitGraph:\s*{[\s\S]*channel: "repos:commit-graph"/);
assert.match(ipcChannels, /reposCommitGraphPatch:\s*{[\s\S]*channel: "repos:commit-graph-patch"/);
assert.match(preload, /commitGraphPatch: \(repoId: string, sha: string\) => invoke\("reposCommitGraphPatch", repoId, sha\)/);
assert.match(localGitHandlers, /ipc\.handle\("reposCommitGraphPatch"/);
assert.match(graphService, /gitRaw\(repo\.localPath, \["diff", "--patch", "--find-renames", parentSha, commitSha\]/);
assert.match(graphService, /staleGraph/);

console.log("Commit graph UI wiring tests ok");
