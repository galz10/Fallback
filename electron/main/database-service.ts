import Database from "better-sqlite3";
import { type LocalCacheStores, createLocalCacheStores } from "./local-cache/index.js";
import { LocalCacheSchemaManager } from "./local-cache/schema-manager.js";
import type { AccountStore } from "./local-cache/account-store.js";
import type { AppMetadataStore } from "./local-cache/app-metadata-store.js";
import type { AttentionStore } from "./local-cache/attention-store.js";
import type { BranchIntegrityStore } from "./local-cache/branch-integrity-store.js";
import type { CacheSummaryStore } from "./local-cache/cache-summary-store.js";
import type { DiagnosticEventStore } from "./local-cache/diagnostic-event-store.js";
import type { GitHubWorkStore } from "./local-cache/github-work-store.js";
import type { HealthStore } from "./local-cache/health-store.js";
import type { NotificationStore } from "./local-cache/notification-store.js";
import type { OfflineActionStore } from "./local-cache/offline-action-store.js";
import type { OperationRecordStore } from "./local-cache/operation-record-store.js";
import type { RepoAccountStore } from "./local-cache/repo-account-store.js";
import type { RepoGroupStore } from "./local-cache/repo-group-store.js";
import type { RepoIdentityStore } from "./local-cache/repo-identity-store.js";
import type { RepoMetadataStore } from "./local-cache/repo-metadata-store.js";
import type { RepoStore } from "./local-cache/repo-store.js";
import type { RepoWorkspaceStore } from "./local-cache/repo-workspace-store.js";
import type { ReviewDraftStore } from "./local-cache/review-draft-store.js";
import type { SearchIndexStore } from "./local-cache/search-index-store.js";
import type { SyncJobStore } from "./local-cache/sync-job-store.js";

export type { PullRequestDiffCacheTarget } from "./local-cache/store-helpers.js";

type SqliteDatabase = ReturnType<typeof Database>;

export class DatabaseService {
  readonly db: SqliteDatabase;
  readonly localCache: LocalCacheStores;
  readonly operationRecords: OperationRecordStore;
  readonly accounts: AccountStore;
  readonly appMetadata: AppMetadataStore;
  readonly attention: AttentionStore;
  readonly branchIntegrity: BranchIntegrityStore;
  readonly cacheSummaries: CacheSummaryStore;
  readonly diagnostics: DiagnosticEventStore;
  readonly githubWork: GitHubWorkStore;
  readonly health: HealthStore;
  readonly notifications: NotificationStore;
  readonly offlineActions: OfflineActionStore;
  readonly repoAccounts: RepoAccountStore;
  readonly repoGroups: RepoGroupStore;
  readonly repoIdentities: RepoIdentityStore;
  readonly repoMetadata: RepoMetadataStore;
  readonly repos: RepoStore;
  readonly repoWorkspaces: RepoWorkspaceStore;
  readonly reviewDrafts: ReviewDraftStore;
  readonly searchIndex: SearchIndexStore;
  readonly syncJobs: SyncJobStore;

  constructor(private readonly databasePath: string) {
    const startedAt = performance.now();
    this.db = new Database(databasePath);
    const openedAt = performance.now();
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    const pragmasAppliedAt = performance.now();
    this.localCache = createLocalCacheStores(this.db);
    this.operationRecords = this.localCache.operationRecords;
    this.accounts = this.localCache.accounts;
    this.appMetadata = this.localCache.appMetadata;
    this.attention = this.localCache.attention;
    this.branchIntegrity = this.localCache.branchIntegrity;
    this.cacheSummaries = this.localCache.cacheSummary;
    this.diagnostics = this.localCache.diagnostics;
    this.githubWork = this.localCache.githubWork;
    this.health = this.localCache.health;
    this.notifications = this.localCache.notifications;
    this.offlineActions = this.localCache.offlineActions;
    this.repoAccounts = this.localCache.repoAccounts;
    this.repoGroups = this.localCache.repoGroups;
    this.repoIdentities = this.localCache.repoIdentities;
    this.repoMetadata = this.localCache.repoMetadata;
    this.repos = this.localCache.repos;
    this.repoWorkspaces = this.localCache.repoWorkspaces;
    this.reviewDrafts = this.localCache.reviewDrafts;
    this.searchIndex = this.localCache.searchIndex;
    this.syncJobs = this.localCache.syncJobs;
    const schema = new LocalCacheSchemaManager(this.databasePath, this.db, this.localCache);
    const schemaWasReady = schema.schemaReadyForStartup();
    if (!schemaWasReady) schema.migrateWithBackup();
    const migratedAt = performance.now();
    const readyAt = performance.now();
    this.logOpenTiming(startedAt, openedAt, pragmasAppliedAt, migratedAt, readyAt, schemaWasReady);
  }

  close(): void {
    this.db.close();
  }

  private logOpenTiming(
    startedAt: number,
    openedAt: number,
    pragmasAppliedAt: number,
    migratedAt: number,
    readyAt: number,
    schemaWasReady: boolean
  ): void {
    const totalMs = readyAt - startedAt;
    if (totalMs < 50 && process.env.FALLBACK_PERF_SMOKE !== "1") return;
    const parts = [
      `open=${Math.round(openedAt - startedAt)}ms`,
      `pragmas=${Math.round(pragmasAppliedAt - openedAt)}ms`,
      `${schemaWasReady ? "ready-check" : "migrate"}=${Math.round(migratedAt - pragmasAppliedAt)}ms`,
      `operation-store=${Math.round(readyAt - migratedAt)}ms`,
      `total=${Math.round(totalMs)}ms`,
      `schemaReady=${schemaWasReady ? "yes" : "no"}`
    ];
    console.warn(`[perf] database open phases ${parts.join(" ")}`);
  }
}
