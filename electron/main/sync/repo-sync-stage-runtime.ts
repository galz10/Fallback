import type {
  GitHubCheckRunsResponse,
  GitHubComment,
  GitHubCommitStatus,
  GitHubCompareResponse,
  GitHubIssueField,
  GitHubIssue,
  GitHubIssueType,
  GitHubLabel,
  GitHubPullRequest,
  GitHubPullRequestCommit,
  GitHubRepo,
  GitHubReview,
  GitHubUser
} from "../github-client.js";
import type { RepoSyncContext, PullRequestDiffWarmTarget } from "./repo-sync-context.js";
import type { SyncJob, SyncStatus } from "../../../src/shared/domain/sync.js";
import type {
  GitHubWorkCachePersistencePort,
  GitHubWorkIssueRelationPersistencePort,
  GitHubWorkPullRequestRelationPersistencePort
} from "./github-work-cache-persistence.js";

export interface RepoSyncProgressRuntime {
  progress(context: RepoSyncContext, message: string): void;
}

export interface RepoSyncJobRecordingRuntime extends RepoSyncProgressRuntime {
  latestSyncJob(jobId: string): SyncJob;
  rateLimitPatch(): Pick<SyncJob, "githubRateLimitRemaining" | "githubRateLimitResetAt">;
  setRepoSyncState(repoId: string, status: SyncStatus, error: string | null, successfulSyncAt?: string): void;
  setRepoAccountSyncState(
    repoId: string,
    accountId: string | null,
    status: SyncStatus,
    error: string | null,
    successfulSyncAt?: string
  ): void;
  updateSyncJob(jobId: string, patch: Partial<SyncJob>): void;
  updateRepoMarker(owner: string, name: string, marker: { lastSyncedAt: string }): void;
  recordOperationalHealthProbe(repoId: string, fullName: string, at: string, durationMs: number): void;
  recordFailedHealthProbe(repoId: string, fullName: string, accountId: string | null, error: unknown, at: string): void;
  updateAccountAuthFailure(error: unknown): void;
  failSyncJob(jobId: string, error: unknown, message?: string): void;
  notifySyncChanged(repoId: string | null): void;
  recordOptionalStageFailure(context: RepoSyncContext, stage: string, error: unknown): void;
}

export interface RepoSyncMetadataRuntime extends RepoSyncProgressRuntime {
  refreshRepoRemoteState(localPath: string, defaultBranch: string): Promise<void>;
  fetchRepo(apiPath: string): Promise<GitHubRepo>;
  shouldCloneRepo(watchMode?: string | null): boolean;
  ensureRepoFolder(owner: string, name: string, mode: "cloned" | "metadata-only"): string;
  upsertRepo(
    repo: GitHubRepo,
    localPath: string,
    syncStatus: string,
    syncError: string | null,
    watchEnabled?: boolean,
    cloneEnabled?: boolean
  ): void;
  associateCurrentAccount(repo: GitHubRepo, watchEnabled?: boolean): void;
  cloneOrFetchRepo(
    repoId: string,
    owner: string,
    name: string,
    cloneUrl: string | null | undefined,
    defaultBranch: string | null | undefined
  ): Promise<void>;
  optionalGithub<T>(load: () => Promise<T>, fallback: T): Promise<T>;
  fetchViewer(): Promise<GitHubUser>;
}

export interface RepoCodeCacheWarmRuntime {
  warmCodeCaches(repoId: string, jobId: string): Promise<void>;
}

export interface GitHubWorkHydrationRuntime
  extends
    RepoSyncProgressRuntime,
    GitHubWorkCachePersistencePort,
    GitHubWorkIssueRelationPersistencePort,
    GitHubWorkPullRequestRelationPersistencePort {
  paginatePullRequests(apiPath: string, state: "open" | "closed", pages: number): Promise<GitHubPullRequest[]>;
  paginateIssues(apiPath: string, state: "open" | "closed", since: string | undefined, pages: number): Promise<GitHubIssue[]>;
  paginateLabels(apiPath: string, pages: number): Promise<GitHubLabel[]>;
  fetchIssueTypes(owner: string): Promise<GitHubIssueType[]>;
  fetchIssueFields(owner: string): Promise<GitHubIssueField[]>;
  userPullRequestIssues(apiPath: string): Promise<GitHubIssue[]>;
  fetchPullRequest(apiPath: string, number: number): Promise<GitHubPullRequest>;
  backfillIssueList(repoId: string, apiPath: string, jobId: string): Promise<void>;
  syncIssueComments(repoId: string, apiPath: string, issue: GitHubIssue, maxPages: number): Promise<void>;
  syncPullRequestRelations(repoId: string, apiPath: string, pr: GitHubPullRequest, maxPages: number): Promise<void>;
  upsertComment(
    repoId: string,
    entityType: "issue" | "pull_request" | "review_comment",
    entityNumber: number,
    comment: GitHubComment
  ): void;
  upsertReview(repoId: string, prNumber: number, review: GitHubReview): void;
  upsertCheckRun(repoId: string, prNumber: number, commitSha: string, checkRun: GitHubCheckRunsResponse["check_runs"][number]): void;
  upsertCommitStatus(repoId: string, commitSha: string, status: GitHubCommitStatus): void;
  upsertPullRequestCommit(repoId: string, prNumber: number, commit: GitHubPullRequestCommit): void;
  upsertCompareCache(repoId: string, baseSha: string, headSha: string, compare: GitHubCompareResponse): void;
  recordUserPullRequest(login: string, repoId: string, prNumber: number, relation: string): void;
  replaceIssueTypes(repoId: string, issueTypes: GitHubIssueType[]): void;
  replaceIssueFieldOptions(repoId: string, fields: GitHubIssueField[]): void;
}

export interface PullRequestDiffWarmRuntime extends RepoSyncProgressRuntime {
  warmPullRequestDiffs(
    repoId: string,
    apiPath: string,
    pullRequests: PullRequestDiffWarmTarget[],
    jobId: string,
    progressPrefix: string
  ): Promise<void>;
  listPullRequestsMissingDiffCache(repoId: string, limit: number): PullRequestDiffWarmTarget[];
}

export interface WorkflowRunHydrationRuntime extends RepoSyncProgressRuntime {
  syncWorkflowRuns(repoId: string, apiPath: string): Promise<void>;
}

export interface RepoPostSyncRuntime extends RepoSyncProgressRuntime {
  pruneClosedIssueCache(repoId: string): void;
  rebuildSearchIndex(repoId: string): void;
  deriveAttentionForRepo(repoId: string): void;
  recordBranchIntegrityAfterSync(context: RepoSyncContext): Promise<void>;
}

export interface RepoSyncStageRuntime
  extends
    RepoSyncJobRecordingRuntime,
    RepoSyncMetadataRuntime,
    RepoCodeCacheWarmRuntime,
    GitHubWorkHydrationRuntime,
    PullRequestDiffWarmRuntime,
    WorkflowRunHydrationRuntime,
    RepoPostSyncRuntime {}
