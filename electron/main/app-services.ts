import { app } from "electron";
import path from "node:path";
import { AppUpdateService } from "./app-update-service.js";
import { CacheService } from "./cache-service.js";
import { AttentionService } from "./attention-service.js";
import { AuthService } from "./auth-service.js";
import { AvatarCacheService } from "./avatar-cache-service.js";
import { BranchIntegrityService } from "./branch-integrity-service.js";
import { DatabaseService } from "./database-service.js";
import { loadLocalEnv } from "./env-service.js";
import { GitHubClient } from "./github-client.js";
import { HealthService } from "./health-service.js";
import { HistorySearchService } from "./history-search-service.js";
import { CommitGraphService } from "./commit-graph-service.js";
import { CredentialDiagnosticsService } from "./credential-diagnostics-service.js";
import { IdentityService } from "./identity-service.js";
import { OfflineWritebackQueueService } from "./github-work/offline-writeback-queue.js";
import { LocalGitService } from "./local-git-service.js";
import { OperationService } from "./operation-service.js";
import { RepoWorkspaceService } from "./repo-workspace-service.js";
import { SettingsService } from "./settings-service.js";
import { SigningReadinessService } from "./signing-readiness-service.js";
import { SyncService } from "./sync-service.js";
import { TokenService } from "./token-service.js";
import { SyncScheduler } from "./workers/sync-scheduler.js";
import { WorkspaceService } from "./workspace-service.js";
import { logStartupMeasure, markStartup } from "./performance.js";
import { onAppEvent, sendAppEvent } from "./ipc/app-events.js";

export interface AppServices {
  settings: SettingsService;
  database: DatabaseService;
  github: GitHubClient;
  sync: SyncService;
  token: TokenService;
  auth: AuthService;
  health: HealthService;
  identity: IdentityService;
  signingReadiness: SigningReadinessService;
  diagnostics: CredentialDiagnosticsService;
  historySearch: HistorySearchService;
  commitGraph: CommitGraphService;
  repoWorkspaces: RepoWorkspaceService;
  operations: OperationService;
  localGit: LocalGitService;
  branchIntegrity: BranchIntegrityService;
  attention: AttentionService;
  offlineWritebacks: OfflineWritebackQueueService;
  scheduler: SyncScheduler;
  cache: CacheService;
  appUpdate: AppUpdateService;
  runDeferredStartupWork(): void;
}

export function createAppServices(token?: string): AppServices {
  markStartup("services:create:start");
  loadLocalEnv();
  const settings = new SettingsService({ workspacePointerPath: path.join(app.getPath("userData"), "workspace-pointer.json") });
  settings.ensureWorkspace();
  markStartup("database:open:start");
  const database = new DatabaseService(settings.databasePath());
  markStartup("database:open:end");
  database.localCache.syncJobs.failInterruptedSyncJobs();
  const workspace = new WorkspaceService(() => settings.get());
  const tokenService = new TokenService();
  const avatarCache = new AvatarCacheService();
  const activeOrScopedGitHubAccount = () => {
    const scopedAccount = tokenService.contextAccount();
    return scopedAccount === undefined ? database.localCache.accounts.getGitHubAccount() : scopedAccount;
  };
  const github = new GitHubClient(token ?? (() => tokenService.getToken(activeOrScopedGitHubAccount())), {
    apiEndpoint: () => activeOrScopedGitHubAccount()?.endpoint ?? "https://api.github.com",
    minRequestIntervalMs: numberFromEnv("FALLBACK_GITHUB_MIN_REQUEST_INTERVAL_MS", 750),
    hourlyRequestBudget: numberFromEnv("FALLBACK_GITHUB_HOURLY_REQUEST_BUDGET", 3000),
    defaultBlockMs: numberFromEnv("FALLBACK_GITHUB_DEFAULT_BLOCK_MS", 5 * 60_000)
  });
  const auth = new AuthService(tokenService, github, database, avatarCache, workspace);
  const health = new HealthService(database, github);
  const identity = new IdentityService(database);
  const signingReadiness = new SigningReadinessService(database, github, identity);
  const operations = new OperationService({
    records: database.operationRecords,
    repoContext: {
      activeRepoWorkspace: (repoId) => database.localCache.repoWorkspaces.activeRepoWorkspace(repoId),
      requireRepoVisibleToActiveAccount: (repoId) => database.localCache.repos.requireRepoVisibleToActiveAccount(repoId),
      listWatchedReposForActiveAccount: () => database.localCache.repos.listWatchedReposForActiveAccount()
    },
    diagnostics: database.localCache.diagnostics
  });
  const diagnostics = new CredentialDiagnosticsService(database, github, identity);
  const historySearch = new HistorySearchService(database);
  const commitGraph = new CommitGraphService(database);
  const repoWorkspaces = new RepoWorkspaceService(database);
  const localGit = new LocalGitService(database, settings, (repoId) => sendAppEvent("localChanges", repoId ? { repoId } : {}));
  const branchIntegrity = new BranchIntegrityService(database, localGit, github, settings);
  const attention = new AttentionService(database, settings);
  const sync = new SyncService(
    database,
    workspace,
    github,
    settings,
    branchIntegrity,
    attention,
    {
      onPullRequestDiffRefreshed: (repoId) => sendAppEvent("sync", { repoId }),
      onSyncChanged: (repoId) => sendAppEvent("sync", repoId ? { repoId } : {}),
      onBranchIntegrityChanged: (repoId) => sendAppEvent("branchIntegrity", { repoId })
    },
    tokenService
  );
  const offlineWritebacks = new OfflineWritebackQueueService(database, sync, health, {
    onChanged: (repoId) => sendAppEvent("offlineActions", repoId ? { repoId } : {})
  });
  offlineWritebacks.start();
  const scheduler = new SyncScheduler(database, sync, settings);
  const cache = new CacheService(database, settings, workspace);
  const appUpdate = new AppUpdateService(() => sendAppEvent("appUpdate"));
  onAppEvent((name) => {
    if (name === "repos" || name === "sync") cache.invalidateSummary();
  });
  let deferredStartupWorkStarted = false;
  const runDeferredStartupWork = () => {
    if (deferredStartupWorkStarted) return;
    deferredStartupWorkStarted = true;
    setTimeout(() => {
      markStartup("workspace:migration:start");
      runDeferredStartupPhase("workspace:migration:legacy", () => workspace.migrateLegacyRepoMetadataTree());
      setTimeout(() => {
        runDeferredStartupPhase("workspace:migration:watched", () =>
          workspace.migrateWatchedRepoMetadata(database.localCache.repos.listWatchedRepos())
        );
        setTimeout(() => {
          runDeferredStartupPhase("workspace:migration:user-issues", () => {
            const accountLogin = database.localCache.accounts.getGitHubAccount()?.login;
            if (accountLogin && !database.localCache.githubWork.hasUserIssueRelations(accountLogin))
              database.localCache.githubWork.backfillUserIssues(accountLogin);
          });
          runDeferredStartupPhase("cache:closed-issues", () => {
            const result = database.localCache.cacheSummary.pruneClosedIssuesOlderThanAge(settings.get().closedIssueRetentionDays);
            if (result.issues > 0) sendAppEvent("sync", {});
          });
          markStartup("workspace:migration:end");
          logStartupMeasure("post-usable workspace migration duration", "workspace:migration:start", "workspace:migration:end");
        }, 0);
      }, 0);
    }, 8_000);
  };
  markStartup("services:create:end");

  return {
    settings,
    database,
    github,
    sync,
    token: tokenService,
    auth,
    health,
    identity,
    signingReadiness,
    diagnostics,
    historySearch,
    commitGraph,
    repoWorkspaces,
    operations,
    localGit,
    branchIntegrity,
    attention,
    offlineWritebacks,
    scheduler,
    cache,
    appUpdate,
    runDeferredStartupWork
  };
}

function runDeferredStartupPhase(name: string, work: () => void): void {
  const startedAt = performance.now();
  try {
    work();
  } catch (error) {
    console.warn(`[startup] deferred ${name} failed`, error);
  } finally {
    const durationMs = performance.now() - startedAt;
    if (durationMs >= 50) console.warn(`[perf] deferred ${name}: ${Math.round(durationMs)}ms`);
  }
}

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
