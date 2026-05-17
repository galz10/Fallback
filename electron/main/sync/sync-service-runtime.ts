import { DatabaseService } from "../database-service.js";
import type { SettingsService } from "../settings-service.js";
import fs from "node:fs";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import {
  GitHubApiError,
  GitHubClient,
  githubNextLink,
  type GitHubBranch,
  type GitHubCheckRunsResponse,
  type GitHubComment,
  type GitHubCommitStatus,
  type GitHubCompareResponse,
  type GitHubCommit,
  type GitHubContributor,
  type GitHubIssue,
  type GitHubIssueField,
  type GitHubIssueType,
  type GitHubLabel,
  type GitHubNamedRef,
  type GitHubPullRequest,
  type GitHubPullRequestCommit,
  type GitHubRelease,
  type GitHubRepo,
  type GitHubReview,
  type GitHubUser,
  type GitHubWorkflowRun,
  type GitHubWorkflowRunsResponse
} from "../github-client.js";
import type { GitHubRepoSummary } from "../../../src/shared/domain/watched-repo.js";
import type {
  RepoBranchSummary,
  RepoBranchSwitchResult,
  RepoCodeSummary,
  RepoCommitSummary,
  RepoContributorSummary,
  RepoReleaseSummary,
  RepoFileContent,
  RepoFileEntry,
  RepoTagSummary
} from "../../../src/shared/domain/repo-code.js";
import type { PullRequestDiff, SubmitPullRequestReviewInput } from "../../../src/shared/domain/github-work.js";
import type { SyncJob } from "../../../src/shared/domain/sync.js";
import { classifyAuthFailure, errorCode as classifyErrorCode, errorMessage } from "../error-classification.js";
import { normalizeRepoFullName, nowIso, repoIdFromFullName } from "../path-utils.js";
import { WorkspaceService } from "../workspace-service.js";
import type { BranchIntegrityService } from "../branch-integrity-service.js";
import type { AttentionService } from "../attention-service.js";
import type { TokenService } from "../token-service.js";
import { inspectRepoPath } from "../repo-path-safety.js";
import { recordBranchIntegrityAfterSync } from "./branch-integrity-sync-follow-up.js";
import { syncFailureStatus, syncHealthProbe, syncHealthStatus } from "./sync-health-recording.js";
import {
  persistGitHubWorkToCache,
  persistIssueRelationsToCache,
  persistPullRequestRelationsToCache
} from "./github-work-cache-persistence.js";
import { RepoSyncPipeline } from "./repo-sync-pipeline.js";
import { createRepoSyncPipelineDelegate } from "./repo-sync-stages.js";
import type { PullRequestDiffWarmTarget, PullRequestPatchRef, RepoSyncContext } from "./repo-sync-context.js";
import { pullRequestDiffWarmTarget, uniqueIssuesByNumber } from "./repo-sync-utils.js";
import { SyncQueue } from "./sync-queue.js";
import { SyncJobRecorder } from "./sync-job-recorder.js";
import type { EnqueueSyncOptions } from "./sync-job-policy.js";
import { lowRateLimitRemaining } from "./sync-job-policy.js";
import { GitHubWorkWriteback } from "../github-work/writeback.js";
import { GitHubWorkDetailRefresh } from "../github-work/detail-refresh.js";
import { RepoMetadataCache } from "../repo-cache/repo-metadata-cache.js";
import { RepoContentReader } from "../repo-code/repo-content-reader.js";
import { RepoCodeSummaryReader } from "../repo-code/repo-code-summary-reader.js";
import { RepoReferenceReader } from "../repo-code/repo-reference-reader.js";
import { UserWorkSync } from "./user-work-sync.js";
export { branchIntegritySyncDecision } from "./branch-integrity-sync-follow-up.js";
export type { BranchIntegritySyncDecision, BranchIntegritySyncDecisionInput } from "./branch-integrity-sync-follow-up.js";
export type { EnqueueSyncOptions } from "./sync-job-policy.js";

const execFileAsync = promisify(execFile);

const repoContentsCacheMs = 5 * 60_000;
const localRepoCodeSummaryCacheMs = 15_000;
const availableReposCacheMs = 10 * 60_000;
const pullRequestDiffRefreshCooldownMs = 60_000;
const availableReposPages = numberFromEnv("FALLBACK_GITHUB_AVAILABLE_REPOS_PAGES", 3);
const userPullRequestSyncPages = numberFromEnv("FALLBACK_GITHUB_USER_PR_SYNC_PAGES", 5);
const issueBackfillPageBudget = numberFromEnv("FALLBACK_GITHUB_ISSUE_BACKFILL_PAGE_BUDGET", 25);
const workflowRunSyncPages = numberFromEnv("FALLBACK_GITHUB_WORKFLOW_RUN_PAGES", 1);
const localFilePreviewMaxBytes = 2 * 1024 * 1024;

interface RuntimeCacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface CacheResult<T> {
  value: T;
  cachedAt: string | null;
  fromCache: boolean;
}

export interface SyncServiceCallbacks {
  onPullRequestDiffRefreshed?: (repoId: string, number: number) => void;
  onSyncChanged?: (repoId: string | null) => void;
  onBranchIntegrityChanged?: (repoId: string) => void;
}

export class SyncServiceRuntime {
  private readonly responseCache = new Map<string, RuntimeCacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly pullRequestDiffRefreshAttemptedAt = new Map<string, number>();
  private readonly repoMetadataCache: RepoMetadataCache;
  private readonly syncJobRecorder: SyncJobRecorder;
  private readonly syncQueue: SyncQueue;
  private readonly repoCodeSummaryReader: RepoCodeSummaryReader;
  private readonly repoContentReader: RepoContentReader;
  private readonly repoReferenceReader: RepoReferenceReader;
  private readonly githubWorkWriteback: GitHubWorkWriteback;
  private readonly githubWorkDetailRefresh: GitHubWorkDetailRefresh;
  private readonly userWorkSync: UserWorkSync;

  constructor(
    private readonly database: DatabaseService,
    private readonly workspace: WorkspaceService,
    private readonly github: GitHubClient,
    private readonly settings?: SettingsService,
    private readonly branchIntegrity?: BranchIntegrityService,
    private readonly attention?: AttentionService,
    private readonly callbacks: SyncServiceCallbacks = {},
    private readonly token?: TokenService
  ) {
    this.repoMetadataCache = new RepoMetadataCache({
      database,
      responseCache: this.responseCache,
      inFlight: this.inFlight,
      rateLimitBlocked: () => this.rateLimitBlocked(),
      isRateLimitError
    });
    this.syncJobRecorder = new SyncJobRecorder({
      database,
      rateLimitPatch: () => this.rateLimitPatch(),
      updateAccountAuthFailure: (error) => this.updateAccountAuthFailure(error),
      notifySyncChanged: (repoId) => this.notifySyncChanged(repoId)
    });
    this.syncQueue = new SyncQueue(
      database,
      github,
      {
        isRateLimited: () => this.isRateLimited(),
        rateLimitWarning: () => this.rateLimitWarning(),
        rateLimitPatch: () => this.rateLimitPatch(),
        syncRepo: (repoId, jobId) => this.syncRepo(repoId, jobId)
      },
      callbacks,
      token
    );
    this.repoContentReader = new RepoContentReader({
      github,
      repoSyncContext: (repoId) => this.repoSyncContext(repoId),
      cachedRepo: (repoId, cacheKey, ttlMs, load, fallback) => this.cachedRepo(repoId, cacheKey, ttlMs, load, fallback),
      localRepoFiles: (repo, dirPath) => this.localRepoFiles(repo, dirPath),
      localRepoFileContent: (repo, filePath) => this.localRepoFileContent(repo, filePath)
    });
    this.repoCodeSummaryReader = new RepoCodeSummaryReader({
      getRepoMetadataCache: (repoId, cacheKey) => this.database.localCache.repoMetadata.getRepoMetadataCache(repoId, cacheKey),
      repoSyncContext: (repoId) => this.repoSyncContext(repoId),
      cachedRepo: (repoId, cacheKey, ttlMs, load, fallback) => this.cachedRepo(repoId, cacheKey, ttlMs, load, fallback),
      cachedLocalRepoCodeSummary: (repoId, repo, diskValue) => this.cachedLocalRepoCodeSummary(repoId, repo, diskValue),
      remoteRepoCodeSummary: (repo, apiPath) => this.remoteRepoCodeSummary(repo, apiPath),
      withRepoStorage: (repoId, summary, fastStoredBytes) => this.withRepoStorage(repoId, summary, fastStoredBytes)
    });
    this.repoReferenceReader = new RepoReferenceReader({
      database,
      workspace,
      github,
      repoSyncContext: (repoId) => this.repoSyncContext(repoId),
      cachedRepo: (repoId, cacheKey, ttlMs, load) => this.cachedRepo(repoId, cacheKey, ttlMs, load),
      onBranchSwitched: (result) => this.recordBranchSwitchResult(result)
    });
    this.githubWorkWriteback = new GitHubWorkWriteback({
      github,
      repoSyncContext: (repoId) => this.repoSyncContext(repoId),
      upsertComment: (repoId, kind, number, comment) => this.upsertComment(repoId, kind, number, comment),
      upsertReview: (repoId, prNumber, review) => this.upsertReview(repoId, prNumber, review)
    });
    this.githubWorkDetailRefresh = new GitHubWorkDetailRefresh({
      database,
      github,
      repoSyncContext: (repoId) => this.repoSyncContext(repoId),
      rateLimitWarning: () => this.rateLimitWarning(),
      rateLimitPatch: () => this.rateLimitPatch(),
      updateProgress: (jobId, progressMessage) => this.updateProgress(jobId, progressMessage),
      failSyncJob: (jobId, error) => this.failSyncJob(jobId, error),
      syncPullRequestRelations: (repoId, apiPath, pr, maxPages) => this.syncPullRequestRelations(repoId, apiPath, pr, maxPages),
      syncIssueComments: (repoId, apiPath, issue, maxPages) => this.syncIssueComments(repoId, apiPath, issue, maxPages),
      ensurePullRequestDiffCached: (repoId, apiPath, pr) => this.ensurePullRequestDiffCached(repoId, apiPath, pullRequestDiffWarmTarget(pr))
    });
    this.userWorkSync = new UserWorkSync({
      database,
      workspace,
      github,
      rateLimitWarning: () => this.rateLimitWarning(),
      rateLimitPatch: () => this.rateLimitPatch(),
      rateLimitBlocked: () => this.rateLimitBlocked(),
      updateProgress: (jobId, progressMessage) => this.updateProgress(jobId, progressMessage),
      failSyncJob: (jobId, error) => this.failSyncJob(jobId, error),
      upsertRepo: (repo, localPath, syncStatus, syncError, isWatched, shouldClone) =>
        this.upsertRepo(repo, localPath, syncStatus, syncError, isWatched, shouldClone),
      associateCurrentAccount: (repo) => this.associateCurrentAccount(repo),
      githubWorkCachePersistencePort: () => this.githubWorkCachePersistencePort(),
      syncPullRequestRelations: (repoId, apiPath, pr, maxPages) => this.syncPullRequestRelations(repoId, apiPath, pr, maxPages),
      ensurePullRequestDiffCached: (repoId, apiPath, pr) =>
        this.ensurePullRequestDiffCached(repoId, apiPath, pullRequestDiffWarmTarget(pr)),
      isExpectedPullRequestDiffCacheMiss,
      logOptionalGitHubWarning
    });
  }

  async watchRepo(fullNameInput: string) {
    const account = this.database.localCache.accounts.getGitHubAccount();
    if (!account) throw new Error("Connect a GitHub profile before watching repositories.");
    const { owner, name, fullName } = normalizeRepoFullName(fullNameInput);
    const repo = await this.github.get<GitHubRepo>(`/repos/${owner}/${name}`);
    const shouldClone = this.settings?.get().cloneReposByDefault ?? true;
    const localPath = this.workspace.ensureRepoFolder(owner, name, shouldClone ? "cloned" : "metadata-only");
    this.upsertRepo(repo, localPath, "never_synced", null, true, shouldClone);
    this.associateCurrentAccount(repo, true);
    const watchedRepo = this.database.localCache.repos.getRepo(repoIdFromFullName(fullName));
    if (watchedRepo) void this.enqueueRepoSync(watchedRepo.id, "initial_repo_sync");
    return this.database.localCache.repos.getRepo(repoIdFromFullName(fullName));
  }

  async listAvailableRepos(): Promise<GitHubRepoSummary[]> {
    const account = this.database.localCache.accounts.getGitHubAccount();
    return this.cached(
      `available-repos:${account?.id ?? "anonymous"}`,
      availableReposCacheMs,
      async () => {
        const [accessibleRepos, starredRepos] = await Promise.all([
          this.github.paginate<GitHubRepo>(
            "/user/repos",
            { affiliation: "owner,collaborator,organization_member", sort: "updated", direction: "desc" },
            availableReposPages
          ),
          this.optionalGithub(
            () => this.github.paginate<GitHubRepo>("/user/starred", { sort: "updated", direction: "desc" }, availableReposPages),
            []
          )
        ]);

        return mergeGitHubRepos(accessibleRepos, starredRepos).map(githubRepoSummary);
      },
      () => this.database.localCache.repos.listWatchedReposForActiveAccount().map(watchedRepoSummary)
    );
  }

  async repoCodeSummary(repoId: string): Promise<RepoCodeSummary> {
    return this.repoCodeSummaryReader.repoCodeSummary(repoId);
  }

  async listRepoFiles(repoId: string, dirPath = ""): Promise<RepoFileEntry[]> {
    return this.repoContentReader.listRepoFiles(repoId, dirPath);
  }

  async readRepoFile(repoId: string, filePath: string): Promise<RepoFileContent> {
    return this.repoContentReader.readRepoFile(repoId, filePath);
  }

  async pullRequestDiff(repoId: string, number: number): Promise<PullRequestDiff> {
    const phases: Array<{ name: string; ms: number }> = [];
    const totalStartedAt = performance.now();
    const phaseSync = <T>(name: string, load: () => T): T => {
      const startedAt = performance.now();
      try {
        return load();
      } finally {
        phases.push({ name, ms: performance.now() - startedAt });
      }
    };

    const { repo, path } = phaseSync("context", () => this.repoSyncContext(repoId));
    const pr = phaseSync("db-pr", () => this.database.localCache.githubWork.getPullRequest(repoId, number));
    if (!pr) throw new Error(`Pull request #${number} is not cached.`);

    const cacheKey = pullRequestDiffCacheKey(number, pr.headSha);
    const memoryKey = `repo:${repoId}:${cacheKey}`;
    const memoryValue = phaseSync(
      "memory-cache",
      () => this.responseCache.get(memoryKey) as RuntimeCacheEntry<CacheResult<string>> | undefined
    );
    if (memoryValue?.value.value.trim()) {
      logPullRequestDiffTiming(repoId, number, totalStartedAt, phases, "cache-memory");
      return {
        repoId,
        number,
        patch: memoryValue.value.value,
        source: "cache",
        cachedAt: memoryValue.value.cachedAt,
        fromCache: true
      };
    }

    const diskValue = phaseSync("disk-cache", () => this.database.localCache.repoMetadata.getRepoMetadataCache<string>(repoId, cacheKey));
    if (diskValue?.payload.trim()) {
      const result = { value: diskValue.payload, cachedAt: diskValue.updatedAt, fromCache: true };
      this.responseCache.set(memoryKey, { value: result, expiresAt: Date.now() + 30_000 });
      logPullRequestDiffTiming(repoId, number, totalStartedAt, phases, "cache-disk");
      return {
        repoId,
        number,
        patch: diskValue.payload,
        source: "cache",
        cachedAt: diskValue.updatedAt,
        fromCache: true
      };
    }

    phaseSync("schedule-diff-refresh", () => this.refreshPullRequestDiffInBackground(repoId, number, repo, pr, path, memoryKey, cacheKey));
    logPullRequestDiffTiming(repoId, number, totalStartedAt, phases, "empty");
    return {
      repoId,
      number,
      patch: "",
      source: "cache",
      cachedAt: null,
      fromCache: true
    };
  }

  async addIssueComment(repoId: string, number: number, body: string): Promise<void> {
    return this.githubWorkWriteback.addIssueComment(repoId, number, body);
  }

  async addPullRequestComment(repoId: string, number: number, body: string): Promise<void> {
    return this.githubWorkWriteback.addPullRequestComment(repoId, number, body);
  }

  async submitPullRequestReview(repoId: string, number: number, input: SubmitPullRequestReviewInput): Promise<void> {
    return this.githubWorkWriteback.submitPullRequestReview(repoId, number, input);
  }

  async listRepoBranches(repoId: string): Promise<RepoBranchSummary[]> {
    return this.repoReferenceReader.listRepoBranches(repoId);
  }

  async switchRepoBranch(repoId: string, branch: string, options: { signal?: AbortSignal } = {}): Promise<RepoBranchSwitchResult> {
    return this.repoReferenceReader.switchRepoBranch(repoId, branch, options);
  }

  async listRepoTags(repoId: string): Promise<RepoTagSummary[]> {
    return this.repoReferenceReader.listRepoTags(repoId);
  }

  async listRepoReleases(repoId: string): Promise<RepoReleaseSummary[]> {
    return this.repoReferenceReader.listRepoReleases(repoId);
  }

  async listRepoContributors(repoId: string): Promise<RepoContributorSummary[]> {
    return this.repoReferenceReader.listRepoContributors(repoId);
  }

  enqueueRepoSync(repoId: string, jobType = "repo_sync", options: EnqueueSyncOptions = {}): Promise<SyncJob> {
    return this.syncQueue.enqueueRepoSync(repoId, jobType, options);
  }

  async enqueueWatchedRepos(jobType = "background_repo_sync"): Promise<SyncJob[]> {
    return this.syncQueue.enqueueWatchedRepos(jobType);
  }

  isRateLimited(): boolean {
    const rateLimit = this.github.getRateLimit();
    if (!rateLimit?.resetAt || rateLimit.remaining !== 0) return false;
    return Date.parse(rateLimit.resetAt) > Date.now();
  }

  isRateLimitLow(): boolean {
    const rateLimit = this.github.getRateLimit();
    return rateLimit?.remaining != null && rateLimit.remaining <= lowRateLimitRemaining;
  }

  async syncRepo(repoIdOrFullName: string, jobId?: string) {
    const knownRepo = this.database.localCache.repos.getRepo(repoIdOrFullName);
    const fullName = knownRepo?.fullName ?? normalizeRepoFullName(repoIdOrFullName).fullName;
    const { owner, name } = normalizeRepoFullName(fullName);
    const repoId = repoIdFromFullName(fullName);
    const job = jobId
      ? this.database.localCache.syncJobs.getSyncJob(jobId)
      : this.database.localCache.syncJobs.createSyncJob(repoId, "repo_sync");
    if (!job) throw new Error(`Missing sync job ${jobId}`);
    return this.createRepoSyncPipeline().run({
      job,
      repoId,
      fullName,
      owner,
      name,
      apiPath: `/repos/${owner}/${name}`,
      knownRepo,
      startedAt: nowIso()
    });
  }

  async syncPullRequest(repoId: string, number: number): Promise<SyncJob> {
    return this.githubWorkDetailRefresh.syncPullRequest(repoId, number);
  }

  async syncIssue(repoId: string, number: number): Promise<SyncJob> {
    return this.githubWorkDetailRefresh.syncIssue(repoId, number);
  }

  async syncUserPullRequests(options: EnqueueSyncOptions = {}): Promise<SyncJob> {
    return this.userWorkSync.syncUserPullRequests(options);
  }

  private createRepoSyncPipeline(): RepoSyncPipeline {
    return new RepoSyncPipeline(
      createRepoSyncPipelineDelegate({
        latestSyncJob: (jobId) => this.database.localCache.syncJobs.getSyncJob(jobId)!,
        progress: (context, message) => this.updateProgress(context.job.id, message),
        rateLimitPatch: () => this.rateLimitPatch(),
        setRepoSyncState: (repoId, status, error, successfulSyncAt) =>
          this.database.localCache.repos.setRepoSyncState(repoId, status, error, successfulSyncAt),
        setRepoAccountSyncState: (repoId, accountId, status, error, successfulSyncAt) =>
          this.database.localCache.repoAccounts.setRepoAccountSyncState(repoId, accountId, status, error, successfulSyncAt),
        updateSyncJob: (jobId, patch) => {
          this.database.localCache.syncJobs.updateSyncJob(jobId, patch);
        },
        refreshRepoRemoteState: async (localPath, defaultBranch) => {
          if (!fs.existsSync(pathJoin(localPath, ".git"))) return;
          await this.workspace.refreshRepoRemoteState(localPath, defaultBranch).catch((error) => {
            console.warn(`Failed to refresh ${localPath} remote branch before sync.`, error);
          });
        },
        fetchRepo: (apiPath) => this.github.get<GitHubRepo>(apiPath),
        shouldCloneRepo: (watchMode) => this.shouldCloneRepo(watchMode),
        ensureRepoFolder: (owner, name, mode) => this.workspace.ensureRepoFolder(owner, name, mode),
        upsertRepo: (repo, localPath, syncStatus, syncError, watchEnabled, cloneEnabled) =>
          this.upsertRepo(repo, localPath, syncStatus, syncError, watchEnabled, cloneEnabled),
        associateCurrentAccount: (repo, watchEnabled) => this.associateCurrentAccount(repo, watchEnabled),
        cloneOrFetchRepo: (repoId, owner, name, cloneUrl, defaultBranch) =>
          this.cloneOrFetchRepo(repoId, owner, name, cloneUrl, defaultBranch),
        optionalGithub: (load, fallback) => this.optionalGithub(load, fallback),
        fetchViewer: () => this.github.get<GitHubUser>("/user"),
        warmCodeCaches: (repoId, jobId) => this.warmCodeCaches(repoId, jobId),
        paginatePullRequests: (apiPath, state, pages) =>
          this.github.paginate<GitHubPullRequest>(`${apiPath}/pulls`, { state, sort: "updated", direction: "desc" }, pages),
        paginateIssues: (apiPath, state, since, pages) =>
          this.github.paginate<GitHubIssue>(
            `${apiPath}/issues`,
            { state, sort: "updated", direction: "desc", ...(since ? { since } : {}) },
            pages
          ),
        paginateLabels: (apiPath, pages) => this.github.paginate<GitHubLabel>(`${apiPath}/labels`, {}, pages),
        fetchIssueTypes: (owner) =>
          this.optionalIssueMetadata(() => this.github.paginate<GitHubIssueType>(`/orgs/${owner}/issue-types`, {}, 2)),
        fetchIssueFields: (owner) =>
          this.optionalIssueMetadata(() => this.github.paginate<GitHubIssueField>(`/orgs/${owner}/issue-fields`, {}, 2)),
        userPullRequestIssues: (apiPath) => this.userPullRequestIssues(apiPath),
        fetchPullRequest: (apiPath, number) => this.github.get<GitHubPullRequest>(`${apiPath}/pulls/${number}`),
        pullRequestNeedsCacheRefresh: (repoId, pr) => this.pullRequestNeedsCacheRefresh(repoId, pr),
        issueNeedsCacheRefresh: (repoId, issue) => this.issueNeedsCacheRefresh(repoId, issue),
        transaction: (work) => this.transaction(work),
        upsertLabel: (repoId, label) => this.upsertLabel(repoId, label),
        upsertPullRequest: (repoId, pr) => this.upsertPullRequest(repoId, pr),
        upsertIssue: (repoId, issue) => this.upsertIssue(repoId, issue),
        upsertEntityLabels: (repoId, entityType, entityNumber, labels) => this.upsertEntityLabels(repoId, entityType, entityNumber, labels),
        recordUserPullRequest: (login, repoId, prNumber, relation) =>
          this.database.localCache.githubWork.recordUserPullRequest(login, repoId, prNumber, relation),
        replaceIssueTypes: (repoId, issueTypes) => this.replaceIssueTypes(repoId, issueTypes),
        replaceIssueFieldOptions: (repoId, fields) => this.replaceIssueFieldOptions(repoId, fields),
        upsertComment: (repoId, entityType, entityNumber, comment) => this.upsertComment(repoId, entityType, entityNumber, comment),
        upsertReview: (repoId, prNumber, review) => this.upsertReview(repoId, prNumber, review),
        upsertCheckRun: (repoId, prNumber, commitSha, checkRun) => this.upsertCheckRun(repoId, prNumber, commitSha, checkRun),
        upsertCommitStatus: (repoId, commitSha, status) => this.upsertCommitStatus(repoId, commitSha, status),
        upsertPullRequestCommit: (repoId, prNumber, commit) => this.upsertPullRequestCommit(repoId, prNumber, commit),
        upsertCompareCache: (repoId, baseSha, headSha, compare) => this.upsertCompareCache(repoId, baseSha, headSha, compare),
        backfillIssueList: (repoId, apiPath, jobId) => this.backfillIssueList(repoId, apiPath, jobId),
        syncIssueComments: (repoId, apiPath, issue, maxPages) => this.syncIssueComments(repoId, apiPath, issue, maxPages),
        syncPullRequestRelations: (repoId, apiPath, pr, maxPages) => this.syncPullRequestRelations(repoId, apiPath, pr, maxPages),
        warmPullRequestDiffs: (repoId, apiPath, pullRequests, jobId, progressPrefix) =>
          this.warmPullRequestDiffs(repoId, apiPath, pullRequests, jobId, progressPrefix),
        listPullRequestsMissingDiffCache: (repoId, limit) =>
          this.database.localCache.githubWork.listPullRequestsMissingDiffCache(repoId, limit),
        syncWorkflowRuns: (repoId, apiPath) => this.syncWorkflowRuns(repoId, apiPath),
        pruneClosedIssueCache: (repoId) => this.pruneClosedIssueCache(repoId),
        rebuildSearchIndex: (repoId) => this.database.localCache.searchIndex.rebuildSearchIndex(repoId),
        deriveAttentionForRepo: (repoId) => {
          this.attention?.deriveForRepo(repoId);
        },
        recordBranchIntegrityAfterSync: (context) =>
          recordBranchIntegrityAfterSync({
            database: this.database,
            settings: this.settings,
            branchIntegrity: this.branchIntegrity,
            repoId: context.repoId,
            fullName: context.fullName,
            progress: (message) => this.updateProgress(context.job.id, message),
            onChanged: (repoId) => this.callbacks.onBranchIntegrityChanged?.(repoId)
          }),
        updateRepoMarker: (owner, name, marker) => this.workspace.updateRepoMarker(owner, name, marker),
        recordOperationalHealthProbe: (repoId, fullName, at, durationMs) => {
          this.database.localCache.health.recordHealthProbes([syncHealthProbe(repoId, fullName, "operational", at, durationMs)]);
        },
        recordFailedHealthProbe: (repoId, fullName, accountId, error, at) => {
          const message = errorMessage(error);
          const status = syncFailureStatus(error);
          const code = classifyErrorCode(error, "sync_failed");
          this.database.localCache.repos.setRepoSyncState(repoId, status, message);
          this.database.localCache.repoAccounts.setRepoAccountSyncState(repoId, accountId, status, message);
          this.database.localCache.health.recordHealthProbes([
            syncHealthProbe(repoId, fullName, syncHealthStatus(status), at, null, {
              httpStatus: error instanceof GitHubApiError ? error.status : null,
              errorCode: code,
              errorMessage: message
            })
          ]);
        },
        updateAccountAuthFailure: (error) => this.updateAccountAuthFailure(error),
        failSyncJob: (jobId, error, message) => this.failSyncJob(jobId, error, message),
        notifySyncChanged: (repoId) => this.notifySyncChanged(repoId),
        recordOptionalStageFailure: (context, stage, error) => this.recordOptionalRepoSyncStageFailure(context, stage, error)
      })
    );
  }

  private githubWorkCachePersistencePort() {
    return {
      pullRequestNeedsCacheRefresh: (repoId: string, pr: GitHubPullRequest) => this.pullRequestNeedsCacheRefresh(repoId, pr),
      issueNeedsCacheRefresh: (repoId: string, issue: GitHubIssue) => this.issueNeedsCacheRefresh(repoId, issue),
      transaction: (work: () => void) => this.transaction(work),
      upsertLabel: (repoId: string, label: GitHubLabel) => this.upsertLabel(repoId, label),
      upsertPullRequest: (repoId: string, pr: GitHubPullRequest) => this.upsertPullRequest(repoId, pr),
      upsertIssue: (repoId: string, issue: GitHubIssue) => this.upsertIssue(repoId, issue),
      upsertEntityLabels: (repoId: string, entityType: "issue" | "pull_request", entityNumber: number, labels: GitHubLabel[]) =>
        this.upsertEntityLabels(repoId, entityType, entityNumber, labels),
      recordUserPullRequest: (login: string, repoId: string, prNumber: number, relation: string) =>
        this.database.localCache.githubWork.recordUserPullRequest(login, repoId, prNumber, relation),
      upsertComment: (
        repoId: string,
        entityType: "issue" | "pull_request" | "review_comment",
        entityNumber: number,
        comment: GitHubComment
      ) => this.upsertComment(repoId, entityType, entityNumber, comment),
      upsertReview: (repoId: string, prNumber: number, review: GitHubReview) => this.upsertReview(repoId, prNumber, review),
      upsertCheckRun: (repoId: string, prNumber: number, commitSha: string, checkRun: GitHubCheckRunsResponse["check_runs"][number]) =>
        this.upsertCheckRun(repoId, prNumber, commitSha, checkRun),
      upsertCommitStatus: (repoId: string, commitSha: string, status: GitHubCommitStatus) =>
        this.upsertCommitStatus(repoId, commitSha, status),
      upsertPullRequestCommit: (repoId: string, prNumber: number, commit: GitHubPullRequestCommit) =>
        this.upsertPullRequestCommit(repoId, prNumber, commit),
      upsertCompareCache: (repoId: string, baseSha: string, headSha: string, compare: GitHubCompareResponse) =>
        this.upsertCompareCache(repoId, baseSha, headSha, compare)
    };
  }

  private recordOptionalRepoSyncStageFailure(context: RepoSyncContext, stage: string, error: unknown): void {
    const message = errorMessage(error);
    console.warn(`Optional repo sync stage ${stage} failed for ${context.fullName}.`, error);
    this.database.localCache.diagnostics.recordDiagnosticEvent({
      source: "sync",
      level: "warn",
      code: "repo_sync_optional_stage_failed",
      message: `${stage} for ${context.fullName}: ${message}`
    });
  }

  private notifySyncChanged(repoId: string | null): void {
    this.callbacks.onSyncChanged?.(repoId);
  }

  private rateLimitPatch(): Pick<SyncJob, "githubRateLimitRemaining" | "githubRateLimitResetAt"> {
    const rateLimit = this.github.getRateLimit();
    return {
      githubRateLimitRemaining: rateLimit?.remaining ?? null,
      githubRateLimitResetAt: rateLimit?.resetAt ?? null
    };
  }

  private updateProgress(jobId: string, progressMessage: string): void {
    this.syncJobRecorder.updateProgress(jobId, progressMessage);
  }

  private failSyncJob(jobId: string, error: unknown, message = errorMessage(error)): void {
    this.syncJobRecorder.failSyncJob(jobId, error, message);
  }

  private updateAccountAuthFailure(error: unknown): void {
    const failure = classifyAuthFailure(error);
    if (!failure) return;
    this.database.localCache.accounts.setCurrentGitHubAccountAuthState({
      authStatus: failure.status,
      lastValidatedAt: nowIso()
    });
  }

  private rateLimitWarning(): string | null {
    const rateLimit = this.github.getRateLimit();
    if (rateLimit?.remaining == null || rateLimit.remaining > lowRateLimitRemaining) return null;
    if (!rateLimit.resetAt) return "GitHub API rate limit is low. Manual refresh may be delayed.";
    return `GitHub API rate limit is low. Fallback paused background sync until ${new Date(rateLimit.resetAt).toLocaleTimeString()}. Cached data is still available.`;
  }

  private repoSyncContext(repoId: string) {
    const repo = this.database.localCache.repos.getRepo(repoId);
    if (!repo) throw new Error(`Unknown watched repo ${repoId}`);
    return { repo, path: `/repos/${repo.owner}/${repo.name}` };
  }

  private associateCurrentAccount(repo: GitHubRepo, watchEnabled = false): void {
    const account = this.database.localCache.accounts.getGitHubAccount();
    if (!account) return;
    this.database.localCache.repoAccounts.associateRepoAccount(repoIdFromFullName(repo.full_name), account, repo.permissions, {
      watchEnabled
    });
  }

  private async cached<T>(cacheKey: string, ttlMs: number, load: () => Promise<T>, fallback?: () => T): Promise<T> {
    const key = `global:${cacheKey}`;
    const now = Date.now();
    const cached = this.responseCache.get(key) as RuntimeCacheEntry<T> | undefined;
    if (cached && cached.expiresAt > now) return cached.value;

    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    if (this.rateLimitBlocked()) {
      if (cached) return cached.value;
      if (fallback) return fallback();
    }

    const promise = load()
      .then((value) => {
        this.responseCache.set(key, { value, expiresAt: Date.now() + ttlMs });
        return value;
      })
      .catch((error: unknown) => {
        if (isRateLimitError(error)) {
          if (cached) return cached.value;
          if (fallback) return fallback();
        }
        throw error;
      })
      .finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, promise);
    return promise;
  }

  private async cachedRepo<T>(
    repoId: string,
    cacheKey: string,
    ttlMs: number,
    load: () => Promise<T>,
    fallback?: () => T
  ): Promise<CacheResult<T>> {
    return this.repoMetadataCache.cachedRepo(repoId, cacheKey, ttlMs, load, fallback);
  }

  private refreshPullRequestDiffInBackground(
    repoId: string,
    number: number,
    repo: { localPath: string | null },
    pr: PullRequestPatchRef,
    path: string,
    memoryKey: string,
    cacheKey: string
  ): void {
    if (this.inFlight.has(memoryKey) || this.rateLimitBlocked()) return;
    const now = Date.now();
    const lastAttemptedAt = this.pullRequestDiffRefreshAttemptedAt.get(memoryKey) ?? 0;
    if (now - lastAttemptedAt < pullRequestDiffRefreshCooldownMs) return;
    this.pullRequestDiffRefreshAttemptedAt.set(memoryKey, now);
    void this.refreshRepoCache(memoryKey, repoId, cacheKey, repoContentsCacheMs, () => this.loadPullRequestPatch(repo, pr, path, number))
      .then((result) => {
        if (typeof result.value === "string" && result.value.trim()) this.callbacks.onPullRequestDiffRefreshed?.(repoId, number);
      })
      .catch((error) => {
        if (!isExpectedPullRequestDiffCacheMiss(error)) {
          logOptionalGitHubWarning(`[perf] prs:get-diff background refresh failed repo=${repoId} pr=${number}.`, error);
        }
      });
  }

  private async loadPullRequestPatch(
    repo: { localPath: string | null },
    pr: PullRequestPatchRef,
    apiPath: string,
    number: number
  ): Promise<string> {
    const localPatch = await this.localPullRequestPatch(repo, pr).catch(() => null);
    if (localPatch?.trim()) return localPatch;
    return this.github.getText(`${apiPath}/pulls/${number}`, "application/vnd.github.v3.diff");
  }

  private refreshRepoCache<T>(
    key: string,
    repoId: string,
    cacheKey: string,
    ttlMs: number,
    load: () => Promise<T>
  ): Promise<CacheResult<T>> {
    return this.repoMetadataCache.refreshRepoCache(key, repoId, cacheKey, ttlMs, load);
  }

  private async optionalGithub<T>(load: () => Promise<T>, fallback: T): Promise<T> {
    if (this.rateLimitBlocked()) return fallback;
    return load().catch((error: unknown) => {
      if (isRateLimitError(error)) return fallback;
      throw error;
    });
  }

  private async optionalIssueMetadata<T>(load: () => Promise<T[]>): Promise<T[]> {
    if (this.rateLimitBlocked()) return [];
    return load().catch((error: unknown) => {
      if (isExpectedIssueMetadataUnavailable(error)) return [];
      logOptionalGitHubWarning("Optional GitHub issue metadata unavailable; continuing without catalog.", error);
      return [];
    });
  }

  private async cachedLocalRepoCodeSummary(
    repoId: string,
    repo: { localPath: string | null; defaultBranch: string | null; lastSuccessfulSyncAt: string | null },
    diskValue: { payload: RepoCodeSummary; updatedAt: string } | null | undefined
  ): Promise<RepoCodeSummary> {
    const key = `repo:${repoId}:local-code-summary`;
    const now = Date.now();
    const cached = this.responseCache.get(key) as RuntimeCacheEntry<RepoCodeSummary> | undefined;
    if (cached && cached.expiresAt > now) return cached.value;

    const existing = this.inFlight.get(key) as Promise<RepoCodeSummary> | undefined;
    if (existing) return existing;

    const promise = this.localRepoCodeSummary(repo, diskValue?.payload ?? null)
      .then((summary) => {
        const localSummary = summary ?? fallbackRepoCodeSummary(repo);
        this.database.localCache.repoMetadata.setRepoMetadataCache(repoId, "code-summary", localSummary);
        const stamped = stampRepoCodeSummary(this.withRepoStorage(repoId, localSummary), nowIso(), Boolean(diskValue));
        this.responseCache.set(key, { value: stamped, expiresAt: Date.now() + localRepoCodeSummaryCacheMs });
        return stamped;
      })
      .finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, promise);
    return promise;
  }

  private clearLocalRepoCodeSummaryCache(repoId: string): void {
    this.responseCache.delete(`repo:${repoId}:local-code-summary`);
  }

  private recordBranchSwitchResult(result: RepoBranchSwitchResult): void {
    this.clearLocalRepoCodeSummaryCache(result.repoId);
    const cached = this.database.localCache.repoMetadata.getRepoMetadataCache<RepoCodeSummary>(result.repoId, "code-summary");
    const repo = this.database.localCache.repos.getRepo(result.repoId);
    const summary = cached?.payload ?? fallbackRepoCodeSummary({ defaultBranch: repo?.defaultBranch ?? result.branch });
    this.database.localCache.repoMetadata.setRepoMetadataCache(result.repoId, "code-summary", {
      ...summary,
      defaultBranch: result.branch
    });
  }

  private async remoteRepoCodeSummary(repo: { defaultBranch: string | null }, apiPath: string): Promise<RepoCodeSummary> {
    const ref = repo.defaultBranch ?? undefined;
    const [metadata, commits, branches, tags, releases, contributors] = await Promise.all([
      this.github.get<GitHubRepo>(apiPath),
      this.optionalGithub(() => this.github.paginate<GitHubCommit>(`${apiPath}/commits`, { sha: ref }, 1), []),
      this.optionalGithub(() => this.github.paginate<GitHubBranch>(`${apiPath}/branches`, {}, 1), []),
      this.optionalGithub(() => this.github.paginate<GitHubNamedRef>(`${apiPath}/tags`, {}, 1), []),
      this.optionalGithub(() => this.github.paginate<GitHubRelease>(`${apiPath}/releases`, {}, 1), []),
      this.optionalGithub(() => this.github.paginate<GitHubContributor>(`${apiPath}/contributors`, {}, 1), [])
    ]);
    const mappedCommits = commits.map(mapCommit);

    return {
      defaultBranch: metadata.default_branch ?? repo.defaultBranch,
      latestCommit: mappedCommits[0] ?? null,
      commits: mappedCommits,
      branchCount: branches.length,
      tagCount: tags.length,
      releaseCount: releases.length,
      contributorCount: contributors.length,
      starCount: metadata.stargazers_count ?? 0,
      forkCount: metadata.forks_count ?? 0,
      watcherCount: metadata.subscribers_count ?? 0,
      sizeKb: metadata.size ?? null,
      cachedBytes: 0,
      totalStoredBytes: null,
      licenseName: metadata.license?.spdx_id || metadata.license?.name || null,
      latestReleaseName: releases[0]?.name || releases[0]?.tag_name || null
    };
  }

  private async warmCodeCaches(repoId: string, jobId: string): Promise<void> {
    const { repo, path } = this.repoSyncContext(repoId);
    this.updateProgress(jobId, "Caching code summary");
    const codeSummary = await this.remoteRepoCodeSummary(repo, path);
    this.database.localCache.repoMetadata.setRepoMetadataCache(repoId, "code-summary", codeSummary);
    if (repo.localPath && fs.existsSync(pathJoin(repo.localPath, ".git"))) {
      const rootFiles = this.localRepoFiles(repo, "");
      if (rootFiles) this.database.localCache.repoMetadata.setRepoMetadataCache(repoId, "files:", rootFiles);
      return;
    }
    this.updateProgress(jobId, "Caching root files");
    await this.listRepoFiles(repoId, "").catch((error: unknown) => {
      if (error instanceof GitHubApiError && [403, 404].includes(error.status)) return [];
      throw error;
    });
  }

  private async warmPullRequestDiffs(
    repoId: string,
    apiPath: string,
    pullRequests: PullRequestDiffWarmTarget[],
    jobId: string,
    progressPrefix: string
  ): Promise<void> {
    if (pullRequests.length === 0) return;
    for (const [index, pr] of pullRequests.entries()) {
      this.updateProgress(jobId, `${progressPrefix} ${index + 1}/${pullRequests.length}`);
      await this.ensurePullRequestDiffCached(repoId, apiPath, pr).catch((error: unknown) => {
        if (!isExpectedPullRequestDiffCacheMiss(error)) logOptionalGitHubWarning(`Failed to cache PR diff ${repoId}#${pr.number}.`, error);
      });
      if (this.rateLimitBlocked()) break;
    }
  }

  private async ensurePullRequestDiffCached(repoId: string, apiPath: string, pr: PullRequestDiffWarmTarget): Promise<boolean> {
    const cacheKey = pullRequestDiffCacheKey(pr.number, pr.headSha);
    const cached = this.database.localCache.repoMetadata.getRepoMetadataCache<string>(repoId, cacheKey);
    if (cached?.payload.trim()) return false;

    const repo = this.database.localCache.repos.getRepo(repoId);
    if (!repo) return false;
    const memoryKey = `repo:${repoId}:${cacheKey}`;
    const result = await this.refreshRepoCache(memoryKey, repoId, cacheKey, repoContentsCacheMs, () =>
      this.loadPullRequestPatch(repo, pr, apiPath, pr.number)
    ).catch((error: unknown) => {
      if (isPullRequestDiffTooLargeError(error)) return null;
      throw error;
    });
    if (!result) return false;
    return result.value.trim().length > 0;
  }

  private shouldCloneRepo(_watchMode?: string | null): boolean {
    return true;
  }

  private async cloneOrFetchRepo(
    repoId: string,
    owner: string,
    name: string,
    cloneUrl: string | null | undefined,
    defaultBranch: string | null | undefined
  ): Promise<void> {
    this.database.localCache.repos.setRepoCloneState(repoId, "syncing", this.workspace.repoPath(owner, name));
    try {
      const localPath = await this.workspace.ensureRepoClone(owner, name, cloneUrl, defaultBranch);
      this.database.localCache.repos.setRepoCloneState(repoId, "cloned", localPath);
    } catch (error) {
      this.database.localCache.repos.setRepoCloneState(repoId, "failed", this.workspace.repoPath(owner, name));
      console.warn(`Failed to clone ${owner}/${name}; continuing with API cache.`, error);
    }
  }

  private async localRepoCodeSummary(
    repo: { localPath: string | null; defaultBranch: string | null },
    cached: RepoCodeSummary | null
  ): Promise<RepoCodeSummary | null> {
    if (!repo.localPath || !fs.existsSync(pathJoin(repo.localPath, ".git"))) return null;

    const currentBranch = await gitText(repo.localPath, ["branch", "--show-current"]).catch(() => "");
    const summaryBranch = currentBranch || repo.defaultBranch || cached?.defaultBranch || null;
    const remoteCommitRef = summaryBranch ? await this.remoteTrackingRef(repo.localPath, summaryBranch) : null;
    const commitRef = remoteCommitRef ?? "HEAD";

    const [branchRows, tagRows, commitRows] = await Promise.all([
      gitText(repo.localPath, ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"]).catch(() => ""),
      gitText(repo.localPath, ["tag", "--list"]).catch(() => ""),
      gitText(repo.localPath, ["log", "-n", "100", "--pretty=format:%H%x1f%an%x1f%aI%x1f%s", commitRef]).catch(() => "")
    ]);
    const commits = commitRows
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, authorName, committedAt, message] = line.split("\x1f");
        return {
          sha,
          message: message || sha,
          authorLogin: null,
          authorName: authorName || null,
          committedAt: committedAt || null,
          htmlUrl: null,
          verified: false
        };
      });
    const branches = branchRows.split("\n").filter((branch) => branch && !branch.includes("HEAD")).length;
    const tags = tagRows.split("\n").filter(Boolean).length;

    return {
      defaultBranch: summaryBranch,
      latestCommit: commits[0] ?? cached?.latestCommit ?? null,
      commits: commits.length > 0 ? commits : (cached?.commits ?? []),
      branchCount: branches || cached?.branchCount || 0,
      tagCount: tags || cached?.tagCount || 0,
      releaseCount: cached?.releaseCount ?? 0,
      contributorCount: cached?.contributorCount ?? 0,
      starCount: cached?.starCount ?? 0,
      forkCount: cached?.forkCount ?? 0,
      watcherCount: cached?.watcherCount ?? 0,
      sizeKb: cached?.sizeKb ?? null,
      cachedBytes: cached?.cachedBytes ?? 0,
      totalStoredBytes: cached?.totalStoredBytes ?? null,
      licenseName: cached?.licenseName ?? null,
      latestReleaseName: cached?.latestReleaseName ?? null
    };
  }

  private localRepoFiles(repo: { localPath: string | null; htmlUrl: string | null }, dirPath: string): RepoFileEntry[] | null {
    if (!repo.localPath || !fs.existsSync(pathJoin(repo.localPath, ".git"))) return null;
    const inspectedDir = inspectRepoPath(repo.localPath, dirPath);
    if (inspectedDir.kind !== "directory") return [];

    const entries = fs
      .readdirSync(inspectedDir.absolutePath, { withFileTypes: true })
      .filter((entry) => entry.name !== ".git" && entry.name !== ".fallback");
    const ignoredPaths = ignoredLocalRepoPaths(
      repo.localPath,
      entries.map((entry) => normalizeContentPath(path.posix.join(dirPath, entry.name)))
    );

    return entries
      .filter((entry) => !ignoredPaths.has(normalizeContentPath(path.posix.join(dirPath, entry.name))))
      .map((entry) => {
        const relativePath = normalizeContentPath(path.posix.join(dirPath, entry.name));
        const inspectedPath = inspectRepoPath(repo.localPath!, relativePath);
        const type: RepoFileEntry["type"] =
          inspectedPath.kind === "directory" ? "dir" : inspectedPath.kind === "symlink" ? "symlink" : "file";
        return {
          name: entry.name,
          path: relativePath,
          type,
          size: inspectedPath.kind === "file" ? inspectedPath.stat.size : null,
          sha: null,
          htmlUrl: repo.htmlUrl ? `${repo.htmlUrl}/blob/HEAD/${encodeGitHubPath(relativePath)}` : null,
          downloadUrl: null
        };
      })
      .sort(sortLocalFiles);
  }

  private async remoteTrackingRef(localPath: string, branch: string): Promise<string | null> {
    const upstream = await gitText(localPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).catch(() => "");
    if (upstream) return upstream;

    const originBranch = `origin/${branch}`;
    const hasOriginBranch = await gitRaw(localPath, ["rev-parse", "--verify", "--quiet", originBranch])
      .then(() => true)
      .catch(() => false);
    return hasOriginBranch ? originBranch : null;
  }

  private localRepoFileContent(repo: { localPath: string | null; htmlUrl: string | null }, filePath: string): RepoFileContent | null {
    if (!repo.localPath || !fs.existsSync(pathJoin(repo.localPath, ".git"))) return null;
    const cleanPath = normalizeContentPath(filePath);
    if (ignoredLocalRepoPaths(repo.localPath, [cleanPath]).has(cleanPath)) return null;
    const inspectedPath = inspectRepoPath(repo.localPath, cleanPath);
    if (inspectedPath.kind !== "file") return null;

    if (inspectedPath.stat.size > localFilePreviewMaxBytes) {
      return {
        name: path.basename(cleanPath),
        path: cleanPath,
        contents: null,
        size: inspectedPath.stat.size,
        sha: null,
        htmlUrl: repo.htmlUrl ? `${repo.htmlUrl}/blob/HEAD/${encodeGitHubPath(cleanPath)}` : null,
        isBinary: true,
        isTooLarge: true
      };
    }

    const bytes = fs.readFileSync(inspectedPath.absolutePath);
    const isBinary = hasBinaryBytes(bytes);
    return {
      name: path.basename(cleanPath),
      path: cleanPath,
      contents: isBinary ? null : bytes.toString("utf8"),
      size: bytes.byteLength,
      sha: null,
      htmlUrl: repo.htmlUrl ? `${repo.htmlUrl}/blob/HEAD/${encodeGitHubPath(cleanPath)}` : null,
      isBinary
    };
  }

  private async localPullRequestPatch(repo: { localPath: string | null }, pr: PullRequestPatchRef): Promise<string | null> {
    if (!repo.localPath || !fs.existsSync(pathJoin(repo.localPath, ".git"))) return null;

    if (
      pr.baseSha &&
      pr.headSha &&
      (await this.gitCommitExists(repo.localPath, pr.baseSha, 1_000)) &&
      (await this.gitCommitExists(repo.localPath, pr.headSha, 1_000))
    ) {
      return gitRaw(repo.localPath, ["diff", "--patch", "--find-renames", `${pr.baseSha}...${pr.headSha}`], 2_000).catch(() => null);
    }

    const baseRef = pr.baseBranch ? `origin/${pr.baseBranch}` : null;
    const headRef = pr.headBranch ? `origin/${pr.headBranch}` : null;
    if (
      baseRef &&
      headRef &&
      (await this.gitCommitExists(repo.localPath, baseRef, 1_000)) &&
      (await this.gitCommitExists(repo.localPath, headRef, 1_000))
    ) {
      return gitRaw(repo.localPath, ["diff", "--patch", "--find-renames", `${baseRef}...${headRef}`], 2_000).catch(() => null);
    }

    return null;
  }

  private async gitCommitExists(cwd: string, ref: string, timeoutMs = 2_000): Promise<boolean> {
    return gitRaw(cwd, ["cat-file", "-e", `${ref}^{commit}`], timeoutMs)
      .then(() => true)
      .catch(() => false);
  }

  private async userPullRequestIssues(path: string): Promise<GitHubIssue[]> {
    const filters = ["created", "assigned", "mentioned"] as const;
    const groups = await Promise.all(
      filters.map((filter) =>
        this.optionalGithub(
          () =>
            this.github.paginate<GitHubIssue>(
              `${path}/issues`,
              { filter, state: "all", sort: "updated", direction: "desc" },
              userPullRequestSyncPages
            ),
          []
        )
      )
    );
    return uniqueIssuesByNumber(groups.flat().filter((issue) => issue.pull_request));
  }

  private rateLimitBlocked(): boolean {
    const rateLimit = this.github.getRateLimit();
    return Boolean(rateLimit?.remaining === 0 && rateLimit.resetAt && Date.parse(rateLimit.resetAt) > Date.now());
  }

  private withRepoStorage(repoId: string, summary: RepoCodeSummary, fastStoredBytes = false): RepoCodeSummary {
    const cachedBytes = fastStoredBytes
      ? summary.cachedBytes
      : this.settings
        ? this.database.localCache.cacheSummary.estimatedRepoCacheBytes(repoId, this.settings.databasePath())
        : 0;
    const repoBytes = summary.sizeKb == null ? null : summary.sizeKb * 1024;
    return {
      ...summary,
      cachedBytes,
      totalStoredBytes: repoBytes == null ? null : repoBytes + cachedBytes
    };
  }

  private async backfillIssueList(repoId: string, path: string, jobId: string): Promise<void> {
    let remainingPages = issueBackfillPageBudget;
    for (const state of ["open", "closed"] as const) {
      while (remainingPages > 0) {
        const cursor = this.database.localCache.repoMetadata.getIssueBackfillCursor(repoId, state);
        const page = cursor.nextPage || 1;
        this.updateProgress(jobId, `Backfilling ${state} issues page ${page}`);
        const { pageSize, hasNextPage } = await this.backfillIssuePage(repoId, path, state, page);
        remainingPages -= 1;

        if (pageSize < 100 || !hasNextPage) {
          this.database.localCache.repoMetadata.setIssueBackfillCursor(repoId, state, 1, nowIso());
          break;
        }

        this.database.localCache.repoMetadata.setIssueBackfillCursor(repoId, state, page + 1, null);
      }
      if (remainingPages <= 0) break;
    }
  }

  private pruneClosedIssueCache(repoId: string): void {
    this.database.localCache.cacheSummary.pruneClosedIssuesOlderThanAge(this.settings?.get().closedIssueRetentionDays ?? 365, { repoId });
  }

  private async backfillIssuePage(
    repoId: string,
    path: string,
    state: "open" | "closed",
    page: number
  ): Promise<{ pageSize: number; hasNextPage: boolean }> {
    const cacheKey = `issues:${state}:page:${page}`;
    const nextCursorKey = `issues:${state}:cursor:${page + 1}`;
    const pageUrl =
      page === 1
        ? `${path}/issues`
        : this.database.localCache.repoMetadata.getGitHubPageCache<string>(repoId, `issues:${state}:cursor:${page}`)?.payload;
    if (!pageUrl) return { pageSize: 0, hasNextPage: false };

    const cached = this.database.localCache.repoMetadata.getGitHubPageCache<GitHubIssue[]>(repoId, cacheKey);
    const cachedNextPageUrl = this.database.localCache.repoMetadata.getGitHubPageCache<string>(repoId, nextCursorKey)?.payload ?? null;
    const response = await this.github.getConditional<GitHubIssue[]>(
      pageUrl,
      page === 1 ? { state, sort: "updated", direction: "desc", per_page: 100 } : undefined,
      { etag: cached?.etag, lastModified: cached?.lastModified }
    );
    const nextPageUrl = githubNextLink(response.headers) ?? (response.status === 304 ? cachedNextPageUrl : null);
    this.database.localCache.repoMetadata.setGitHubPageCache(repoId, nextCursorKey, { payload: nextPageUrl });

    if (response.status === 304) {
      this.database.localCache.repoMetadata.setGitHubPageCache(repoId, cacheKey, {
        etag: response.etag,
        lastModified: response.lastModified
      });
      return { pageSize: cached?.payload?.length ?? 100, hasNextPage: Boolean(nextPageUrl) };
    }

    const issues = response.data ?? [];
    persistGitHubWorkToCache(this.githubWorkCachePersistencePort(), { repoId, issues, pullRequests: [], labels: [] });
    this.database.localCache.repoMetadata.setGitHubPageCache(repoId, cacheKey, {
      etag: response.etag,
      lastModified: response.lastModified,
      payload: issues
    });
    return { pageSize: issues.length, hasNextPage: Boolean(nextPageUrl) };
  }

  private async syncIssueComments(repoId: string, path: string, issue: GitHubIssue, maxPages = Number.POSITIVE_INFINITY): Promise<void> {
    const comments = await this.github.paginate<GitHubComment>(`${path}/issues/${issue.number}/comments`, {}, maxPages);
    persistIssueRelationsToCache(this.githubWorkCachePersistencePort(), { repoId, issue, comments });
  }

  private async syncPullRequestRelations(
    repoId: string,
    path: string,
    pr: GitHubPullRequest,
    maxPages = Number.POSITIVE_INFINITY
  ): Promise<void> {
    const [issueComments, reviews, reviewComments, checkRunsResponse, statuses, commits, compare] = await Promise.all([
      this.github.paginate<GitHubComment>(`${path}/issues/${pr.number}/comments`, {}, maxPages),
      this.github.paginate<GitHubReview>(`${path}/pulls/${pr.number}/reviews`, {}, maxPages),
      this.github.paginate<GitHubComment>(`${path}/pulls/${pr.number}/comments`, {}, maxPages),
      this.optionalCheckRuns(`${path}/commits/${pr.head.sha}/check-runs`),
      this.optionalStatuses(`${path}/commits/${pr.head.sha}/statuses`),
      this.optionalPullRequestCommits(`${path}/pulls/${pr.number}/commits`, maxPages),
      this.optionalCompare(path, pr.base.sha, pr.head.sha)
    ]);
    const accountLogin = this.database.localCache.accounts.getGitHubAccount()?.login ?? null;

    persistPullRequestRelationsToCache(this.githubWorkCachePersistencePort(), {
      repoId,
      pullRequest: pr,
      issueComments,
      reviews,
      reviewComments,
      checkRuns: checkRunsResponse.check_runs,
      statuses,
      commits,
      compare,
      accountLogin
    });
  }

  private async optionalPullRequestCommits(path: string, maxPages: number): Promise<GitHubPullRequestCommit[]> {
    return this.github.paginate<GitHubPullRequestCommit>(path, {}, maxPages).catch((error) => {
      logOptionalGitHubWarning("Failed to sync pull request commits.", error);
      return [];
    });
  }

  private async optionalCompare(path: string, baseSha: string | null, headSha: string | null): Promise<GitHubCompareResponse | null> {
    if (!baseSha || !headSha) return null;
    return this.github.get<GitHubCompareResponse>(`${path}/compare/${baseSha}...${headSha}`).catch((error) => {
      if (error instanceof GitHubApiError && error.status === 404) return null;
      logOptionalGitHubWarning("Failed to sync compare result.", error);
      return null;
    });
  }

  private async syncWorkflowRuns(repoId: string, path: string): Promise<void> {
    const runs = await this.optionalWorkflowRuns(path, workflowRunSyncPages);
    if (runs.length === 0) return;
    this.transaction(() => {
      for (const run of runs) this.upsertWorkflowRun(repoId, run);
    });
  }

  private pullRequestNeedsCacheRefresh(repoId: string, pr: GitHubPullRequest): boolean {
    const row = this.database.db
      .prepare(
        `SELECT updated_at, head_sha, state, comments_count, review_comments_count
         FROM pull_requests
         WHERE repo_id = ? AND number = ?`
      )
      .get(repoId, pr.number) as
      | {
          updated_at: string | null;
          head_sha: string | null;
          state: string | null;
          comments_count: number | null;
          review_comments_count: number | null;
        }
      | undefined;
    if (!row) return true;
    return (
      row.updated_at !== pr.updated_at ||
      row.head_sha !== pr.head.sha ||
      row.state !== pr.state ||
      nullableNumberValue(row.comments_count) !== nullableNumberValue(pr.comments) ||
      nullableNumberValue(row.review_comments_count) !== nullableNumberValue(pr.review_comments)
    );
  }

  private issueNeedsCacheRefresh(repoId: string, issue: GitHubIssue): boolean {
    const nextIssueTypeName = issueTypeName(issue);
    const row = this.database.db
      .prepare(
        `SELECT updated_at, state, comments_count, is_pull_request, issue_type_name
         FROM issues
         WHERE repo_id = ? AND number = ?`
      )
      .get(repoId, issue.number) as
      | {
          updated_at: string | null;
          state: string | null;
          comments_count: number | null;
          is_pull_request: number | null;
          issue_type_name: string | null;
        }
      | undefined;
    if (!row) return true;
    return (
      row.updated_at !== issue.updated_at ||
      row.state !== issue.state ||
      nullableNumberValue(row.comments_count) !== nullableNumberValue(issue.comments) ||
      Number(row.is_pull_request ?? 0) !== (issue.pull_request ? 1 : 0) ||
      row.issue_type_name !== nextIssueTypeName
    );
  }

  private transaction(work: () => void): void {
    this.database.db.transaction(work)();
  }

  private optionalCheckRuns(path: string): Promise<GitHubCheckRunsResponse> {
    return this.github.get<GitHubCheckRunsResponse>(path).catch((error) => {
      if (error instanceof GitHubApiError && [403, 404].includes(error.status)) return { total_count: 0, check_runs: [] };
      throw error;
    });
  }

  private optionalStatuses(path: string): Promise<GitHubCommitStatus[]> {
    return this.github.paginate<GitHubCommitStatus>(path, {}, 1).catch((error) => {
      if (error instanceof GitHubApiError && [403, 404].includes(error.status)) return [];
      throw error;
    });
  }

  private async optionalWorkflowRuns(path: string, maxPages: number): Promise<GitHubWorkflowRun[]> {
    const runs: GitHubWorkflowRun[] = [];
    for (let page = 1; page <= maxPages; page += 1) {
      try {
        const response = await this.github.get<GitHubWorkflowRunsResponse>(`${path}/actions/runs`, { per_page: 30, page });
        runs.push(...response.workflow_runs);
        if (response.workflow_runs.length < 30) break;
      } catch (error) {
        if (error instanceof GitHubApiError && [403, 404].includes(error.status)) return runs;
        throw error;
      }
    }
    return runs;
  }

  private upsertRepo(
    repo: GitHubRepo,
    localPath: string,
    syncStatus: string,
    syncError: string | null,
    watchEnabled = true,
    cloneEnabled = true
  ): void {
    const repoId = repoIdFromFullName(repo.full_name);
    const timestamp = nowIso();
    const watchMode = cloneEnabled ? "cloned" : "metadata-only";
    const cloneStatus = cloneEnabled ? "pending" : "not_cloned";
    const workspacePath = this.settings?.get().workspacePath ?? path.dirname(path.dirname(localPath));
    this.database.db
      .prepare(
        `INSERT INTO repos (
           id, github_repo_id, provider, owner, name, full_name, description, is_private, is_fork,
           archived, has_issues, is_template, language, permission_admin, permission_push, permission_pull,
           owner_avatar_url, default_branch, html_url, clone_url, ssh_url, visibility, pushed_at, github_updated_at,
           workspace_path, local_path, watch_mode, clone_enabled, clone_status, watch_enabled,
           sync_status, sync_error, created_at, updated_at
         )
         VALUES (?, ?, 'github.com', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           github_repo_id = excluded.github_repo_id,
           owner = excluded.owner,
           name = excluded.name,
           full_name = excluded.full_name,
           description = excluded.description,
           owner_avatar_url = excluded.owner_avatar_url,
           is_private = excluded.is_private,
           is_fork = excluded.is_fork,
           archived = excluded.archived,
           has_issues = excluded.has_issues,
           is_template = excluded.is_template,
           language = excluded.language,
           permission_admin = excluded.permission_admin,
           permission_push = excluded.permission_push,
           permission_pull = excluded.permission_pull,
           default_branch = excluded.default_branch,
           html_url = excluded.html_url,
           clone_url = excluded.clone_url,
           ssh_url = excluded.ssh_url,
           visibility = excluded.visibility,
           pushed_at = excluded.pushed_at,
           github_updated_at = excluded.github_updated_at,
           local_path = excluded.local_path,
           workspace_path = excluded.workspace_path,
           watch_mode = excluded.watch_mode,
           clone_enabled = excluded.clone_enabled,
           clone_status = CASE
             WHEN excluded.clone_enabled = 1 AND repos.clone_status = 'cloned' THEN 'cloned'
             ELSE excluded.clone_status
           END,
           watch_enabled = CASE WHEN excluded.watch_enabled = 1 THEN 1 ELSE repos.watch_enabled END,
           sync_status = CASE WHEN excluded.watch_enabled = 1 OR repos.watch_enabled = 0 THEN excluded.sync_status ELSE repos.sync_status END,
           sync_error = CASE WHEN excluded.watch_enabled = 1 OR repos.watch_enabled = 0 THEN excluded.sync_error ELSE repos.sync_error END,
           updated_at = excluded.updated_at`
      )
      .run(
        repoId,
        repo.id,
        repo.owner.login,
        repo.name,
        repo.full_name,
        repo.description,
        repo.private ? 1 : 0,
        repo.fork ? 1 : 0,
        repo.archived ? 1 : 0,
        repo.has_issues === false ? 0 : 1,
        repo.is_template ? 1 : 0,
        repo.language ?? null,
        nullableBooleanNumber(repo.permissions?.admin),
        nullableBooleanNumber(repo.permissions?.push),
        nullableBooleanNumber(repo.permissions?.pull),
        repo.owner.avatar_url ?? null,
        repo.default_branch,
        repo.html_url,
        repo.clone_url,
        repo.ssh_url,
        repo.visibility,
        repo.pushed_at,
        repo.updated_at,
        workspacePath,
        localPath,
        watchMode,
        cloneEnabled ? 1 : 0,
        cloneStatus,
        watchEnabled ? 1 : 0,
        syncStatus,
        syncError,
        timestamp,
        timestamp
      );
  }

  private upsertPullRequest(repoId: string, pr: GitHubPullRequest): void {
    this.database.db
      .prepare(
        `INSERT INTO pull_requests (
           id, repo_id, github_pr_id, number, title, body, author_login, assignee_logins, requested_reviewer_logins,
           state, is_draft, locked,
           merged, mergeable, mergeable_state, base_branch, head_branch, base_sha, head_sha,
           additions, deletions, changed_files, comments_count, review_comments_count, review_state, commits_count,
           html_url, diff_url, patch_url, created_at, updated_at, closed_at, merged_at, last_synced_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(repo_id, number) DO UPDATE SET
           title = excluded.title,
           body = excluded.body,
           author_login = excluded.author_login,
           assignee_logins = excluded.assignee_logins,
           requested_reviewer_logins = excluded.requested_reviewer_logins,
           state = excluded.state,
           is_draft = excluded.is_draft,
           locked = excluded.locked,
           merged = excluded.merged,
           mergeable = excluded.mergeable,
           mergeable_state = excluded.mergeable_state,
           base_branch = excluded.base_branch,
           head_branch = excluded.head_branch,
           base_sha = excluded.base_sha,
           head_sha = excluded.head_sha,
           additions = excluded.additions,
           deletions = excluded.deletions,
           changed_files = excluded.changed_files,
           comments_count = excluded.comments_count,
           review_comments_count = excluded.review_comments_count,
           review_state = excluded.review_state,
           commits_count = excluded.commits_count,
           html_url = excluded.html_url,
           diff_url = excluded.diff_url,
           patch_url = excluded.patch_url,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           closed_at = excluded.closed_at,
           merged_at = excluded.merged_at,
           last_synced_at = excluded.last_synced_at`
      )
      .run(
        `${repoId}/pull/${pr.number}`,
        repoId,
        pr.id,
        pr.number,
        pr.title,
        pr.body,
        pr.user?.login ?? null,
        loginList(pr.assignees),
        loginList(pr.requested_reviewers),
        pr.state,
        pr.draft ? 1 : 0,
        pr.locked ? 1 : 0,
        pr.merged ? 1 : 0,
        boolToNullableInt(pr.mergeable),
        pr.mergeable_state ?? null,
        pr.base.ref,
        pr.head.ref,
        pr.base.sha,
        pr.head.sha,
        pr.additions ?? null,
        pr.deletions ?? null,
        pr.changed_files ?? null,
        pr.comments ?? null,
        pr.review_comments ?? null,
        null,
        pr.commits ?? null,
        pr.html_url,
        pr.diff_url,
        pr.patch_url,
        pr.created_at,
        pr.updated_at,
        pr.closed_at,
        pr.merged_at,
        nowIso()
      );
  }

  private upsertIssue(repoId: string, issue: GitHubIssue): void {
    this.database.db
      .prepare(
        `INSERT INTO issues (
           id, repo_id, github_issue_id, number, title, body, author_login, assignee_logins, state, locked,
           issue_type_name, comments_count, html_url, created_at, updated_at, closed_at, last_synced_at, is_pull_request
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(repo_id, number) DO UPDATE SET
           title = excluded.title,
           body = excluded.body,
           author_login = excluded.author_login,
           assignee_logins = excluded.assignee_logins,
           state = excluded.state,
           issue_type_name = excluded.issue_type_name,
           locked = excluded.locked,
           comments_count = excluded.comments_count,
           html_url = excluded.html_url,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           closed_at = excluded.closed_at,
           last_synced_at = excluded.last_synced_at,
           is_pull_request = excluded.is_pull_request`
      )
      .run(
        `${repoId}/issue/${issue.number}`,
        repoId,
        issue.id,
        issue.number,
        issue.title,
        issue.body,
        issue.user?.login ?? null,
        loginList(issue.assignees),
        issue.state,
        issue.locked ? 1 : 0,
        issueTypeName(issue),
        issue.comments ?? null,
        issue.html_url,
        issue.created_at,
        issue.updated_at,
        issue.closed_at,
        nowIso(),
        issue.pull_request ? 1 : 0
      );
    const accountLogin = this.database.localCache.accounts.getGitHubAccount()?.login;
    if (accountLogin && !issue.pull_request) {
      this.database.localCache.githubWork.recordUserIssue(accountLogin, repoId, issue.number, issueRelationForLogin(issue, accountLogin));
    }
  }

  private upsertComment(
    repoId: string,
    entityType: "issue" | "pull_request" | "review_comment",
    entityNumber: number,
    comment: GitHubComment
  ): void {
    this.database.db
      .prepare(
        `INSERT INTO comments (
           id, repo_id, entity_type, entity_number, github_comment_id, author_login, body, html_url,
           path, position, original_position, commit_id, original_commit_id, diff_hunk,
           created_at, updated_at, last_synced_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(repo_id, entity_type, github_comment_id) DO UPDATE SET
           body = excluded.body,
           updated_at = excluded.updated_at,
           last_synced_at = excluded.last_synced_at`
      )
      .run(
        `${repoId}/${entityType}/${comment.id}`,
        repoId,
        entityType,
        entityNumber,
        comment.id,
        comment.user?.login ?? null,
        comment.body,
        comment.html_url,
        comment.path ?? null,
        comment.position ?? null,
        comment.original_position ?? null,
        comment.commit_id ?? null,
        comment.original_commit_id ?? null,
        comment.diff_hunk ?? null,
        comment.created_at,
        comment.updated_at,
        nowIso()
      );
  }

  private upsertReview(repoId: string, prNumber: number, review: GitHubReview): void {
    this.database.db
      .prepare(
        `INSERT INTO reviews (
           id, repo_id, pr_number, github_review_id, author_login, state, body, html_url,
           commit_id, submitted_at, last_synced_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(repo_id, github_review_id) DO UPDATE SET
           state = excluded.state,
           body = excluded.body,
           submitted_at = excluded.submitted_at,
           last_synced_at = excluded.last_synced_at`
      )
      .run(
        `${repoId}/review/${review.id}`,
        repoId,
        prNumber,
        review.id,
        review.user?.login ?? null,
        review.state,
        review.body,
        review.html_url,
        review.commit_id,
        review.submitted_at,
        nowIso()
      );
  }

  private upsertLabel(repoId: string, label: GitHubLabel): void {
    this.database.db
      .prepare(
        `INSERT INTO labels (id, repo_id, github_label_id, name, color, description)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(repo_id, name) DO UPDATE SET
           color = excluded.color,
           description = excluded.description`
      )
      .run(`${repoId}/label/${label.name}`, repoId, label.id, label.name, label.color, label.description);
  }

  private replaceIssueTypes(repoId: string, issueTypes: GitHubIssueType[]): void {
    const timestamp = nowIso();
    const uniqueTypes = uniqueIssueTypes(issueTypes);
    this.transaction(() => {
      this.database.db.prepare("DELETE FROM issue_types WHERE repo_id = ?").run(repoId);
      const insert = this.database.db.prepare(
        `INSERT INTO issue_types (id, repo_id, github_issue_type_id, name, description, created_at, updated_at, last_synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(repo_id, name) DO UPDATE SET
           github_issue_type_id = excluded.github_issue_type_id,
           description = excluded.description,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           last_synced_at = excluded.last_synced_at`
      );
      for (const issueType of uniqueTypes) {
        insert.run(
          `${repoId}/issue-type/${issueType.name}`,
          repoId,
          Number.isFinite(issueType.id) ? issueType.id : null,
          issueType.name,
          issueType.description ?? null,
          issueType.created_at ?? null,
          issueType.updated_at ?? null,
          timestamp
        );
      }
    });
  }

  private replaceIssueFieldOptions(repoId: string, fields: GitHubIssueField[]): void {
    const timestamp = nowIso();
    const relevantFields = fields.filter((field) => issueFieldKey(field.name));
    this.transaction(() => {
      this.database.db
        .prepare("DELETE FROM issue_field_options WHERE repo_id = ? AND lower(field_name) IN ('priority', 'effort')")
        .run(repoId);
      const insert = this.database.db.prepare(
        `INSERT INTO issue_field_options (id, repo_id, field_name, option_id, option_name, color, description, last_synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(repo_id, field_name, option_name) DO UPDATE SET
           option_id = excluded.option_id,
           color = excluded.color,
           description = excluded.description,
           last_synced_at = excluded.last_synced_at`
      );
      for (const field of relevantFields) {
        const fieldName = issueFieldKey(field.name);
        if (!fieldName) continue;
        for (const option of uniqueIssueFieldOptions(field.options ?? [])) {
          insert.run(
            `${repoId}/issue-field/${fieldName}/${option.name}`,
            repoId,
            fieldName,
            typeof option.id === "number" && Number.isFinite(option.id) ? option.id : null,
            option.name,
            option.color ?? null,
            option.description ?? null,
            timestamp
          );
        }
      }
    });
  }

  private upsertEntityLabels(repoId: string, entityType: "issue" | "pull_request", entityNumber: number, labels: GitHubLabel[]): void {
    this.database.db
      .prepare("DELETE FROM entity_labels WHERE repo_id = ? AND entity_type = ? AND entity_number = ?")
      .run(repoId, entityType, entityNumber);

    for (const label of labels) {
      this.upsertLabel(repoId, label);
      this.database.db
        .prepare(
          `INSERT INTO entity_labels (id, repo_id, entity_type, entity_number, label_id)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(repo_id, entity_type, entity_number, label_id) DO NOTHING`
        )
        .run(
          `${repoId}/${entityType}/${entityNumber}/label/${label.name}`,
          repoId,
          entityType,
          entityNumber,
          `${repoId}/label/${label.name}`
        );
    }
  }

  private upsertCheckRun(
    repoId: string,
    prNumber: number,
    commitSha: string,
    checkRun: GitHubCheckRunsResponse["check_runs"][number]
  ): void {
    this.database.db
      .prepare(
        `INSERT INTO check_runs (
           id, repo_id, pr_number, commit_sha, github_check_run_id, name, status, conclusion,
           started_at, completed_at, html_url, details_url, last_synced_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(repo_id, github_check_run_id) DO UPDATE SET
           status = excluded.status,
           conclusion = excluded.conclusion,
           completed_at = excluded.completed_at,
           last_synced_at = excluded.last_synced_at`
      )
      .run(
        `${repoId}/check/${checkRun.id}`,
        repoId,
        prNumber,
        commitSha,
        checkRun.id,
        checkRun.name,
        checkRun.status,
        checkRun.conclusion,
        checkRun.started_at,
        checkRun.completed_at,
        checkRun.html_url,
        checkRun.details_url,
        nowIso()
      );
  }

  private upsertCommitStatus(repoId: string, commitSha: string, status: GitHubCommitStatus): void {
    this.database.db
      .prepare(
        `INSERT INTO commit_statuses (
           id, repo_id, commit_sha, context, state, description, target_url, created_at, updated_at, last_synced_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(repo_id, commit_sha, context) DO UPDATE SET
           state = excluded.state,
           description = excluded.description,
           target_url = excluded.target_url,
           updated_at = excluded.updated_at,
           last_synced_at = excluded.last_synced_at`
      )
      .run(
        `${repoId}/status/${commitSha}/${status.context}`,
        repoId,
        commitSha,
        status.context,
        status.state,
        status.description,
        status.target_url,
        status.created_at,
        status.updated_at,
        nowIso()
      );
  }

  private upsertWorkflowRun(repoId: string, run: GitHubWorkflowRun): void {
    this.database.db
      .prepare(
        `INSERT INTO workflow_runs (
           id, repo_id, github_workflow_run_id, workflow_name, display_title, run_number, event,
           run_attempt, status, conclusion, head_branch, head_sha, html_url, actor_login, workflow_path,
           run_started_at, created_at, updated_at, last_synced_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(repo_id, github_workflow_run_id) DO UPDATE SET
           workflow_name = excluded.workflow_name,
           display_title = excluded.display_title,
           run_number = excluded.run_number,
           event = excluded.event,
           run_attempt = excluded.run_attempt,
           status = excluded.status,
           conclusion = excluded.conclusion,
           head_branch = excluded.head_branch,
           head_sha = excluded.head_sha,
           html_url = excluded.html_url,
           actor_login = excluded.actor_login,
           workflow_path = excluded.workflow_path,
           run_started_at = excluded.run_started_at,
           updated_at = excluded.updated_at,
           last_synced_at = excluded.last_synced_at`
      )
      .run(
        `${repoId}/workflow-run/${run.id}`,
        repoId,
        run.id,
        run.name,
        run.display_title ?? null,
        run.run_number ?? null,
        run.event ?? null,
        run.run_attempt ?? null,
        run.status,
        run.conclusion,
        run.head_branch,
        run.head_sha,
        run.html_url,
        run.actor?.login ?? null,
        run.path ?? null,
        run.run_started_at ?? null,
        run.created_at,
        run.updated_at,
        nowIso()
      );
  }

  private upsertPullRequestCommit(repoId: string, prNumber: number, commit: GitHubPullRequestCommit): void {
    this.database.localCache.branchIntegrity.upsertPullRequestCommit({
      repoId,
      prNumber,
      sha: commit.sha,
      treeSha: commit.commit?.tree?.sha ?? null,
      message: commit.commit?.message ?? null,
      authoredAt: commit.commit?.author?.date ?? null,
      committedAt: commit.commit?.committer?.date ?? null,
      lastSyncedAt: nowIso()
    });
  }

  private upsertCompareCache(repoId: string, baseSha: string, headSha: string, compare: GitHubCompareResponse): void {
    const totals = (compare.files ?? []).reduce<{ additions: number; deletions: number; changedFiles: number }>(
      (sum, file) => ({
        additions: sum.additions + (file.additions ?? 0),
        deletions: sum.deletions + (file.deletions ?? 0),
        changedFiles: sum.changedFiles + 1
      }),
      { additions: 0, deletions: 0, changedFiles: 0 }
    );
    this.database.localCache.branchIntegrity.upsertCompareCache({
      repoId,
      baseSha,
      headSha,
      status: compare.status ?? null,
      aheadBy: compare.ahead_by ?? null,
      behindBy: compare.behind_by ?? null,
      totalCommits: compare.total_commits ?? null,
      additions: compare.files ? totals.additions : null,
      deletions: compare.files ? totals.deletions : null,
      changedFiles: compare.files ? totals.changedFiles : null,
      payload: compare as unknown as Record<string, unknown>,
      lastSyncedAt: nowIso()
    });
  }
}

function normalizeContentPath(value: string): string {
  return value
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function ignoredLocalRepoPaths(localPath: string, relativePaths: string[]): Set<string> {
  const paths = [...new Set(relativePaths.map(normalizeContentPath).filter(Boolean))];
  if (paths.length === 0) return new Set();

  try {
    const stdout = execFileSync("git", ["-C", localPath, "check-ignore", "--stdin", "-z"], {
      encoding: "utf8",
      input: `${paths.join("\0")}\0`,
      maxBuffer: 1024 * 1024
    });
    return new Set(stdout.split("\0").map(normalizeContentPath).filter(Boolean));
  } catch (error) {
    if (gitExitCode(error) === 1) return new Set();
    return new Set();
  }
}

function encodeGitHubPath(value: string): string {
  return normalizeContentPath(value)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function mapCommit(commit: GitHubCommit): RepoCommitSummary {
  return {
    sha: commit.sha,
    message: commit.commit.message.split("\n")[0] || commit.sha,
    authorLogin: commit.author?.login ?? null,
    authorName: commit.commit.author?.name ?? commit.commit.committer?.name ?? null,
    committedAt: commit.commit.committer?.date ?? commit.commit.author?.date ?? null,
    htmlUrl: commit.html_url,
    verified: Boolean(commit.commit.verification?.verified)
  };
}

function stampRepoCodeSummary(summary: RepoCodeSummary, cachedAt: string | null, fromCache: boolean): RepoCodeSummary {
  return { ...summary, cachedAt, fromCache };
}

function pullRequestDiffCacheKey(number: number, headSha?: string | null): string {
  return headSha ? `pull:${number}:diff:${headSha}` : `pull:${number}:diff`;
}

function sameLogin(value: string | null | undefined, login: string | null | undefined): boolean {
  return Boolean(value && login && value.toLowerCase() === login.toLowerCase());
}

function watchedRepoSummary(repo: {
  githubRepoId: number;
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  ownerAvatarUrl: string | null;
  isPrivate: boolean;
  visibility: string | null;
  isFork: boolean;
  archived: boolean;
  hasIssues: boolean;
  isTemplate: boolean;
  language: string | null;
  permissions: GitHubRepoSummary["permissions"];
  defaultBranch: string | null;
  htmlUrl: string | null;
  pushedAt: string | null;
  githubUpdatedAt: string | null;
  cloneStatus: string | null;
}): GitHubRepoSummary {
  return {
    id: repo.githubRepoId,
    owner: repo.owner,
    name: repo.name,
    fullName: repo.fullName,
    description: repo.description,
    ownerAvatarUrl: repo.ownerAvatarUrl,
    isPrivate: repo.isPrivate,
    visibility: repo.visibility,
    isFork: repo.isFork,
    archived: repo.archived,
    hasIssues: repo.hasIssues,
    isTemplate: repo.isTemplate,
    language: repo.language,
    permissions: repo.permissions,
    defaultBranch: repo.defaultBranch,
    htmlUrl: repo.htmlUrl,
    pushedAt: repo.pushedAt,
    githubUpdatedAt: repo.githubUpdatedAt,
    cloneStatus: repo.cloneStatus
  };
}

function mergeGitHubRepos(primary: GitHubRepo[], secondary: GitHubRepo[]): GitHubRepo[] {
  const repos = new Map<string, GitHubRepo>();
  for (const repo of [...secondary, ...primary]) {
    repos.set(repo.full_name.toLowerCase(), repo);
  }
  return [...repos.values()].sort((a, b) => {
    const aUpdated = Date.parse(a.updated_at ?? a.pushed_at ?? "") || 0;
    const bUpdated = Date.parse(b.updated_at ?? b.pushed_at ?? "") || 0;
    if (aUpdated !== bUpdated) return bUpdated - aUpdated;
    return a.full_name.localeCompare(b.full_name);
  });
}

function githubRepoSummary(repo: GitHubRepo): GitHubRepoSummary {
  return {
    id: repo.id,
    owner: repo.owner.login,
    name: repo.name,
    fullName: repo.full_name,
    description: repo.description,
    ownerAvatarUrl: repo.owner.avatar_url ?? null,
    isPrivate: repo.private,
    visibility: repo.visibility,
    isFork: repo.fork,
    archived: Boolean(repo.archived),
    hasIssues: repo.has_issues !== false,
    isTemplate: Boolean(repo.is_template),
    language: repo.language ?? null,
    permissions: repo.permissions ?? null,
    defaultBranch: repo.default_branch,
    htmlUrl: repo.html_url,
    pushedAt: repo.pushed_at,
    githubUpdatedAt: repo.updated_at
  };
}

function nullableBooleanNumber(value: boolean | null | undefined): number | null {
  return value == null ? null : value ? 1 : 0;
}

function fallbackRepoCodeSummary(repo: { defaultBranch: string | null }): RepoCodeSummary {
  return {
    defaultBranch: repo.defaultBranch,
    latestCommit: null,
    commits: [],
    branchCount: repo.defaultBranch ? 1 : 0,
    tagCount: 0,
    releaseCount: 0,
    contributorCount: 0,
    starCount: 0,
    forkCount: 0,
    watcherCount: 0,
    sizeKb: null,
    cachedBytes: 0,
    totalStoredBytes: null,
    licenseName: null,
    latestReleaseName: null
  };
}

function isRateLimitError(error: unknown): boolean {
  return error instanceof GitHubApiError && (error.status === 429 || error.rateLimit?.remaining === 0 || /rate limit/i.test(error.body));
}

function isExpectedPullRequestDiffCacheMiss(error: unknown): boolean {
  return isRateLimitError(error) || isPullRequestDiffTooLargeError(error);
}

function isPullRequestDiffTooLargeError(error: unknown): boolean {
  return (
    error instanceof GitHubApiError &&
    error.status === 406 &&
    (/diff exceeded/i.test(error.body) || /maximum number of files/i.test(error.body) || /"code"\s*:\s*"too_large"/i.test(error.body))
  );
}

function logOptionalGitHubWarning(message: string, error: unknown): void {
  if (error instanceof GitHubApiError) {
    console.warn(`${message} ${gitHubApiErrorSummary(error)}`);
    return;
  }
  console.warn(message, error);
}

function isExpectedIssueMetadataUnavailable(error: unknown): boolean {
  if (isRateLimitError(error)) return true;
  if (!(error instanceof GitHubApiError)) return false;
  return error.status === 403 || error.status === 404;
}

function gitHubApiErrorSummary(error: GitHubApiError): string {
  const body = gitHubErrorBodySummary(error.body);
  const suffix = body ? `: ${body}` : "";
  const truncated = error.bodyTruncated ? " (body truncated)" : "";
  return `GitHub API ${error.status} ${error.statusText}${suffix}${truncated}`;
}

function gitHubErrorBodySummary(body: string): string {
  const trimmed = body.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message.trim().slice(0, 240);
  } catch {
    // Fall through to a plain-text preview.
  }
  if (trimmed.startsWith("<")) return "";
  return trimmed.slice(0, 240);
}

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function loginList(users: Array<{ login: string }> | undefined): string | null {
  return users?.map((user) => user.login).join(",") || null;
}

function issueTypeName(issue: GitHubIssue): string | null {
  const name = issue.type?.name?.trim();
  return name || null;
}

function uniqueIssueTypes(issueTypes: GitHubIssueType[]): GitHubIssueType[] {
  const seen = new Set<string>();
  const unique: GitHubIssueType[] = [];
  for (const issueType of issueTypes) {
    const name = issueType.name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...issueType, name });
  }
  return unique;
}

function uniqueIssueFieldOptions(
  options: Array<{ id?: number; name: string; color?: string | null; description?: string | null }>
): Array<{ id?: number; name: string; color?: string | null; description?: string | null }> {
  const seen = new Set<string>();
  const unique: Array<{ id?: number; name: string; color?: string | null; description?: string | null }> = [];
  for (const option of options) {
    const name = option.name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...option, name });
  }
  return unique;
}

function issueFieldKey(name: string | null | undefined): "priority" | "effort" | null {
  const normalized = name?.trim().toLowerCase();
  if (normalized === "priority") return "priority";
  if (normalized === "effort") return "effort";
  return null;
}

function logPullRequestDiffTiming(
  repoId: string,
  number: number,
  startedAt: number,
  phases: Array<{ name: string; ms: number }>,
  source: string
): void {
  const totalMs = performance.now() - startedAt;
  if (totalMs < 50) return;
  const phaseText = phases.map((phase) => `${phase.name}=${Math.round(phase.ms)}ms`).join(" ");
  console.warn(`[perf] prs:get-diff phases repo=${repoId} pr=${number} source=${source} total=${Math.round(totalMs)}ms ${phaseText}`);
}

function issueRelationForLogin(issue: GitHubIssue, login: string): string | null {
  if (sameLogin(issue.user?.login, login)) return "author";
  if (issue.assignees?.some((assignee) => sameLogin(assignee.login, login))) return "assignee";
  if (mentionsLogin(issue.body, login)) return "mention";
  return null;
}

function mentionsLogin(body: string | null | undefined, login: string): boolean {
  return Boolean(body && new RegExp(`(^|[^\\w-])@${escapeRegExp(login)}($|[^\\w-])`, "i").test(body));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function boolToNullableInt(value: boolean | null | undefined): number | null {
  return value == null ? null : Number(value);
}

function nullableNumberValue(value: number | null | undefined): number | null {
  return value == null ? null : Number(value);
}

async function gitRaw(cwd: string, args: string[], timeout = 30_000, allowExitCodes = [0], signal?: AbortSignal): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], { timeout, signal });
    return stdout;
  } catch (error) {
    if (allowExitCodes.includes(gitExitCode(error))) return "";
    throw error;
  }
}

function gitExitCode(error: unknown): number {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "number" ? error.code : -1;
}

async function gitText(cwd: string, args: string[]): Promise<string> {
  const stdout = await gitRaw(cwd, args);
  return stdout.trim();
}

function pathJoin(...parts: string[]): string {
  return path.join(...parts);
}

function hasBinaryBytes(buffer: Buffer): boolean {
  const length = Math.min(buffer.length, 8000);
  for (let index = 0; index < length; index += 1) {
    if (buffer[index] === 0) return true;
  }
  return false;
}

function sortLocalFiles(a: RepoFileEntry, b: RepoFileEntry): number {
  if (a.type === "dir" && b.type !== "dir") return -1;
  if (a.type !== "dir" && b.type === "dir") return 1;
  return a.name.localeCompare(b.name);
}
