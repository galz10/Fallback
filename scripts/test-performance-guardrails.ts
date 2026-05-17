import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const mainSource = read("src/renderer/main.tsx");
const rendererShellSource = [
  read("src/renderer/shell/AppShell.tsx"),
  read("src/renderer/shell/auth-storage.ts"),
  read("src/renderer/shell/useStartupHydration.ts"),
  read("src/renderer/shell/useRendererEvents.ts"),
  read("src/renderer/shell/useBackgroundPrefetch.ts"),
  read("src/renderer/shell/useActiveSyncContext.ts"),
  read("src/renderer/shell/useWindowContext.ts"),
  read("src/renderer/shell/ViewRouter.tsx"),
  read("src/renderer/shell/ShellChrome.tsx")
].join("\n");
const preloadSource = read("electron/preload/index.ts");
const registerIpcSource = read("electron/main/ipc/register-ipc.ts");
const lifecycleSource = read("electron/main/app/lifecycle.ts");
const ipcPerfSource = read("electron/main/ipc/performance.ts");
const databaseSource = [
  read("electron/main/database-service.ts"),
  ...fs
    .readdirSync(path.join(root, "electron/main/local-cache"))
    .filter((file) => file.endsWith(".ts"))
    .map((file) => read(path.join("electron/main/local-cache", file)))
].join("\n");
const cacheSource = read("electron/main/cache-service.ts");
const attentionSource = read("electron/main/attention-service.ts");
const localGitSource = [
  read("electron/main/local-git-service.ts"),
  ...fs
    .readdirSync(path.join(root, "electron/main/local-git"))
    .filter((file) => file.endsWith(".ts"))
    .map((file) => read(path.join("electron/main/local-git", file)))
].join("\n");
const syncSource = [
  read("electron/main/sync-service.ts"),
  read("electron/main/sync/sync-service-runtime.ts"),
  read("electron/main/sync/user-work-sync.ts"),
  read("electron/main/github-work/detail-refresh.ts"),
  read("electron/main/repo-code/repo-code-summary-reader.ts"),
  read("electron/main/repo-code/repo-content-reader.ts"),
  read("electron/main/repo-code/repo-reference-reader.ts"),
  read("electron/main/repo-cache/repo-metadata-cache.ts")
].join("\n");
const pullRequestDiffWarmerSource = read("electron/main/sync/pull-request-diff-warmer.ts");
const githubWorkHandlersSource = read("electron/main/ipc/github-work.handlers.ts");
const watchedReposHandlersSource = read("electron/main/ipc/watched-repos.handlers.ts");
const appServicesSource = read("electron/main/app-services.ts");
const windowManagerSource = read("electron/main/window-manager.ts");
const startupHandlersSource = read("electron/main/ipc/startup.handlers.ts");
const settingsSource = read("electron/main/settings-service.ts");
const homeViewSource = read("src/renderer/features/home/HomeView.tsx");
const diffsShellSource = read("src/renderer/diffs/DiffShell.tsx");
const lazyDiffsSource = read("src/renderer/diffs/lazy-diffs.tsx");
const diffsOptionsSource = read("src/renderer/diffs/options.ts");
const viteSource = read("vite.config.ts");
const packageJson = read("package.json");

for (const forbidden of [
  "./features/home/HomeView",
  "./features/command-palette/CommandPalette",
  "./components/NotificationInboxButton",
  "./components/AccountIdentityButton",
  "./components/ConfirmDialog",
  "./components/CredentialDiagnosticsDialog",
  "./features/repo-code/BranchSelector",
  "./features/repo-code/RepoCodeView",
  "./features/repo-identity/RepoIdentityControl",
  "./features/github-work/GitHubWorkViews"
]) {
  assert.doesNotMatch(mainSource, new RegExp(`^import (?!type).*${escapeRegExp(forbidden)}`, "m"), `${forbidden} must stay lazy-loaded`);
}

assert.match(rendererShellSource, /window\.fallback\.startup\.snapshot/, "renderer shell must hydrate from the startup snapshot");
assert.match(rendererShellSource, /startupSnapshotEnabled/);
assert.match(preloadSource, /startup:\s*{\s*snapshot:\s*\(\) => invoke\("startupSnapshot"\)/s);
assert.match(preloadSource, /summaryDetailed:\s*\(\) => invoke\("cacheSummaryDetailed"\)/);
assert.match(preloadSource, /ipcChannelMetadata/);
assert.match(registerIpcSource, /registerStartupHandlers\(services,\s*adapters\.windowManager\)/);

assert.match(
  lifecycleSource,
  /logStartupBudget\([\s\S]*"process to first usable"[\s\S]*app\.isPackaged \|\| process\.env\.FALLBACK_LOAD_PRODUCTION === "1" \? 250 : 400/
);
assert.match(lifecycleSource, /logStartupBudget\("window created to first usable"[\s\S]*200/);
assert.match(ipcPerfSource, /startup IPC budget miss/);
assert.match(ipcPerfSource, /post-usable slow IPC/);
assert.match(ipcPerfSource, /handler=/, "slow IPC logs must include handler timing so serialization/event-loop delay is visible");
assert.match(ipcPerfSource, /resultBytes=/, "slow IPC logs must include result payload size");

assert.match(databaseSource, /startup sync filesystem walk budget miss/);
assert.doesNotMatch(
  listWatchedReposBody(databaseSource),
  /\(SELECT COUNT\(\*\) FROM pull_requests[\s\S]*WHERE p\.repo_id = r\.id/,
  "listWatchedRepos must not regress to correlated PR count subqueries"
);
assert.match(databaseSource, /cacheSummaryCountersFast/);
assert.match(databaseSource, /includeLocalBytes/);
assert.match(databaseSource, /cache_summary_snapshots/);
assert.match(databaseSource, /attention_summary_snapshots/);
assert.match(databaseSource, /health_history_snapshots/);
assert.match(databaseSource, /performanceIndexSetVersion/);
assert.match(databaseSource, /schemaReadyForStartup/);
assert.match(databaseSource, /database open phases/);
assert.match(databaseSource, /listStartupRepoShellsForActiveAccount/);
assert.match(databaseSource, /repos:startup-shells/);
assert.match(databaseSource, /prs:list/);
assert.match(databaseSource, /prs:list-mine/);
assert.match(databaseSource, /issues:count/);
assert.match(databaseSource, /actions:checks/);
assert.match(databaseSource, /WITH pr_heads AS/);
assert.doesNotMatch(databaseSource, /SELECT MIN\(number\)[\s\S]{0,160}WHERE repo_id = cr\.repo_id/);
assert.doesNotMatch(databaseSource, /SELECT MIN\(number\)[\s\S]{0,160}WHERE repo_id = cs\.repo_id/);
assert.match(databaseSource, /actions:workflow-runs/);
assert.match(databaseSource, /cache:summary/);
assert.match(cacheSource, /logCacheTiming/);
assert.match(cacheSource, /summaryDetailed/);
assert.match(cacheSource, /exportDiagnostics/);
assert.match(cacheSource, /logCacheTiming\("summaryDetailed"/);
assert.match(cacheSource, /logCacheTiming\("exportDiagnostics"/);
assert.match(databaseSource, /user_issues/);
assert.match(databaseSource, /listIssues\(repoId: string, options: IssueListInput = \{\}\)/);
assert.match(databaseSource, /LIMIT \? OFFSET \?/);
assert.match(databaseSource, /attentionSummarySnapshot/);
assert.match(databaseSource, /idx_issues_user_author_updated/);
assert.match(databaseSource, /idx_user_issues_login_relation/);
assert.match(databaseSource, /idx_issues_repo_ispr_state_updated/);
assert.match(databaseSource, /idx_health_probes_checked_surface/);
assert.match(databaseSource, /idx_repos_watch_priority_name/);
assert.match(databaseSource, /idx_sync_jobs_status_repo_created/);
assert.match(databaseSource, /idx_repo_group_memberships_repo_group/);
assert.match(databaseSource, /idx_comments_repo_updated_created/);
assert.match(databaseSource, /idx_workflow_runs_repo_started_updated/);
assert.match(databaseSource, /idx_check_runs_repo_pr_commit/);
assert.match(databaseSource, /idx_commit_statuses_repo_commit_updated/);
assert.match(attentionSource, /scheduleSummarySnapshotRefresh/);
assert.match(githubWorkHandlersSource, /normalizeIssueListInput/);
assert.match(githubWorkHandlersSource, /issues-count:/);
assert.match(syncSource, /prs:get-diff phases/);
assert.match(syncSource, /memory-cache/);
assert.match(syncSource, /disk-cache/);
assert.match(syncSource, /schedule-diff-refresh/);
assert.match(syncSource, /localPullRequestPatch/);
assert.match(syncSource, /pullRequestDiffRefreshCooldownMs/);
assert.match(pullRequestDiffWarmerSource, /pullRequestDiffBackfillLimit/);
assert.match(pullRequestDiffWarmerSource, /Backfilling cached PR diffs/);
assert.match(syncSource, /refreshPullRequestDiffInBackground/);
assert.match(databaseSource, /listPullRequestsMissingDiffCache/);
assert.match(watchedReposHandlersSource, /repos:get-identity caller=/);
assert.match(appServicesSource, /workspace:migration:user-issues/);
assert.match(appServicesSource, /}, 8_000\)/);
assert.match(windowManagerSource, /deferredWindowRestoreDelayMs/);
assert.match(windowManagerSource, /writeFileIfChanged/);
assert.match(windowManagerSource, /\.\.\.remainingContexts/);
assert.match(startupHandlersSource, /cache\.summarySnapshot\(\)/);
assert.doesNotMatch(startupHandlersSource, /cache\.summary\(\)/);
assert.match(startupHandlersSource, /startupProfile/);
assert.match(startupHandlersSource, /avatarCachedUrl:\s*null/);
assert.doesNotMatch(startupHandlersSource, /avatarCachedUrl:\s*account\.avatarCachedUrl/);
assert.match(startupHandlersSource, /startup snapshot phases/);
assert.match(startupHandlersSource, /listStartupRepoShellsForActiveAccount/);
assert.match(settingsSource, /writeFileIfChanged/);
assert.match(settingsSource, /fileMatches/);
assert.match(localGitSource, /refreshing/);
assert.match(localGitSource, /onBackgroundRefresh/);
assert.match(localGitSource, /logLocalGitTiming/);
assert.match(localGitSource, /untrackedLineCountMaxFiles/);
assert.match(localGitSource, /untrackedPatchMaxBytes/);
assert.match(localGitSource, /local-file-history/);
assert.match(localGitSource, /local-file-blame/);
assert.match(localGitSource, /gitNetworkPreflightCacheMs/);
assert.match(localGitSource, /conflictPreflightCacheMs/);
assert.match(rendererShellSource, /STORED_AUTH_STATE_KEY/);
assert.match(rendererShellSource, /readStoredAuthState/);
assert.match(rendererShellSource, /trimStoredAuthState/);
assert.match(rendererShellSource, /avatarCachedUrl:\s*null/);
assert.match(rendererShellSource, /BACKGROUND_PREFETCH_CONCURRENCY/);
assert.match(rendererShellSource, /BACKGROUND_PREFETCH_REPO_LIMIT/);
assert.match(rendererShellSource, /runBackgroundPrefetchTasks/);
assert.match(rendererShellSource, /background prefetch/);
assert.doesNotMatch(mainSource, /DotmCircular4/, "renderer entry must not statically import non-critical dot-matrix loaders");
assert.match(localGitSource, /new Worker\(new URL\("\.\.\/workers\/local-git-parser\.worker\.js"/);
assert.match(lifecycleSource, /services\.localGit\.dispose\(\)/);
assert.match(packageJson, /"perf:packaged":/);
assert.match(
  packageJson,
  /"perf:packaged":\s*"pnpm rebuild:electron/,
  "perf:packaged keeps the explicit native rebuild for smoke reliability"
);
assert.match(packageJson, /"perf:packaged:run":/);
assert.match(packageJson, /"perf:production":/);
assert.ok(fs.existsSync(path.join(root, "scripts/perf-production-run.ts")), "production renderer perf smoke must exist");
assert.match(mainSource, /entryImports:\s*RENDERER_ENTRY_IMPORTS/);
assert.match(mainSource, /shellPaintMs/);
assert.match(mainSource, /rendererReadySentMs/);
assert.match(mainSource, /rendererReadyEpochMs/);
assert.match(lifecycleSource, /renderer ready IPC received/);
assert.match(lifecycleSource, /renderer-ready-transit/);
assert.match(lifecycleSource, /postUsableBackgroundStartDelayMs\s*=\s*350/);
assert.doesNotMatch(mainSource, /from "@primer\/octicons-react"/, "renderer entry must not statically import Primer icons");
assert.doesNotMatch(mainSource, /from "lucide-react"/, "renderer entry must not statically import Lucide icons");
assert.doesNotMatch(mainSource, /from "\.\/components\/ui\/(dropdown-menu|tabs|tooltip|sonner)"/, "rich chrome UI must stay lazy-loaded");
assert.doesNotMatch(mainSource, /diffs\/(DiffShell|lazy-diffs)/, "diff renderer must stay out of the startup chunk");
for (const forbidden of [
  "../../components/ConfirmDialog",
  "../../components/RepoPicker",
  "../../components/StorageUsageBar",
  "../repo-identity/RepoIdentityControl"
]) {
  assert.doesNotMatch(homeViewSource, new RegExp(`^import .*${escapeRegExp(forbidden)}`, "m"), `${forbidden} must stay lazy in HomeView`);
}
assert.match(homeViewSource, /React\.lazy\(\(\) => import\("\.\.\/\.\.\/components\/RepoPicker"\)/);
assert.match(homeViewSource, /React\.lazy\(\(\) =>\s*\n\s*import\("\.\.\/repo-identity\/RepoIdentityControl"\)/);
assert.match(lazyDiffsSource, /React\.lazy\(\(\) => import\("@pierre\/diffs\/react"\)/, "diff components must stay lazy-loaded");
assert.match(diffsShellSource, /WorkerPoolContextProvider/, "diff highlighting must stay worker-backed");
assert.match(diffsOptionsSource, /langs:\s*\[/, "diff highlighter language set must remain explicit");
assert.ok(
  highlighterLanguageCount(diffsOptionsSource) <= 16,
  "diff highlighter language set should stay bounded; add languages deliberately"
);

assert.match(viteSource, /include:\s*\/\\\.\(jsx\|tsx\)\$\//);
assert.match(viteSource, /exclude:\s*\[\/node_modules\//);
assert.match(viteSource, /base:\s*"\.\/"/, "packaged file:// builds must use relative asset URLs");
assert.match(viteSource, /chunkSizeWarningLimit:\s*800/, "large lazy grammar chunks are expected, but the threshold must stay explicit");

const entryChunk = largestEntryChunk();
if (entryChunk) {
  const budgetBytes = 350 * 1024;
  assert.ok(entryChunk.bytes <= budgetBytes, `initial renderer entry chunk is ${entryChunk.bytes} bytes; budget is ${budgetBytes} bytes`);
}

console.log("Performance guardrails ok");

function read(filePath: string): string {
  return fs.readFileSync(path.join(root, filePath), "utf8");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function listWatchedReposBody(source: string): string {
  const start = source.indexOf("listWatchedRepos(): WatchedRepo[]");
  const end = source.indexOf("getRepo(repoId: string)", start);
  assert.ok(start >= 0 && end > start, "could not locate listWatchedRepos body");
  return source.slice(start, end);
}

function largestEntryChunk(): { filePath: string; bytes: number } | null {
  const assetsDir = path.join(root, "dist", "assets");
  if (!fs.existsSync(assetsDir)) return null;
  const candidates = fs
    .readdirSync(assetsDir)
    .filter((file) => /^index-.*\.js$/.test(file))
    .map((file) => {
      const filePath = path.join(assetsDir, file);
      return { filePath, bytes: fs.statSync(filePath).size };
    });
  return candidates.sort((a, b) => b.bytes - a.bytes)[0] ?? null;
}

function highlighterLanguageCount(source: string): number {
  const match = source.match(/langs:\s*\[([\s\S]*?)\]/);
  assert.ok(match, "could not locate diff highlighter language list");
  return (match[1] ?? "").split(",").filter((item) => item.trim()).length;
}
