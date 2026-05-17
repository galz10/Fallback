import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const repoCodeRenderer = await readFile("src/renderer/features/repo-code/RepoCodeView.tsx", "utf8");
const repoReferences = await readFile("src/renderer/features/repo-code/RepoReferences.tsx", "utf8");
const repoCodeTypes = await readFile("src/shared/domain/repo-code.ts", "utf8");
const fallbackApi = await readFile("src/shared/contracts/fallback-api.ts", "utf8");
const ipc = await readFile("src/shared/ipc.ts", "utf8");
const ipcChannels = await readFile("src/shared/contracts/ipc-channels.ts", "utf8");
const preload = await readFile("electron/preload/index.ts", "utf8");
const watchedRepoHandlers = await readFile("electron/main/ipc/watched-repos.handlers.ts", "utf8");
const repoReferenceReader = await readFile("electron/main/repo-code/repo-reference-reader.ts", "utf8");

assert.match(repoCodeRenderer, /activeTab === "Releases"[\s\S]*<ReleasesView repo=\{repo\}/);
assert.match(repoReferences, /function ReleasesView\(\{ repo \}: \{ repo: WatchedRepo \}\)/);
assert.match(repoReferences, /window\.fallback\.repos\.listReleases\(repo\.id\)/);
assert.match(repoReferences, /function ReleaseRow\(\{ release \}: \{ release: RepoReleaseSummary \}\)/);

assert.match(repoCodeTypes, /export interface RepoReleaseSummary/);
assert.match(fallbackApi, /listReleases\(repoId: string\): Promise<RepoReleaseSummary\[\]>/);
assert.match(ipc, /contracts\/ipc-channels/);
assert.match(ipcChannels, /reposListReleases:\s*{[\s\S]*channel: "repos:list-releases"/);
assert.match(preload, /listReleases: \(repoId: string\) => invoke\("reposListReleases", repoId\)/);
assert.match(watchedRepoHandlers, /ipc\.handle\("reposListReleases"[\s\S]*services\.sync\.listRepoReleases/);
assert.match(repoReferenceReader, /async listRepoReleases\(repoId: string\): Promise<RepoReleaseSummary\[\]>/);
assert.match(repoReferenceReader, /this\.dependencies\.github\.paginate<GitHubRelease>\(`\$\{apiPath\}\/releases`/);

console.log("Releases tab wiring tests ok");
