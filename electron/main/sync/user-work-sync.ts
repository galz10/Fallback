import type { DatabaseService } from "../database-service.js";
import type { GitHubClient, GitHubIssue, GitHubPullRequest, GitHubRepo, GitHubUser } from "../github-client.js";
import type { WorkspaceService } from "../workspace-service.js";
import { normalizeRepoFullName, nowIso, repoIdFromFullName } from "../path-utils.js";
import { syncPriority, syncReasonLabel } from "../../../src/shared/sync-policy.js";
import type { SyncJob } from "../../../src/shared/domain/sync.js";
import { persistUserPullRequestToCache, type GitHubWorkUserPullRequestPersistencePort } from "./github-work-cache-persistence.js";
import type { EnqueueSyncOptions } from "./sync-job-policy.js";
import { authStatusSyncMessage, blockingSyncAuthStatus, syncAccountStatus } from "./sync-job-policy.js";

interface GitHubIssueSearchResponse {
  total_count: number;
  items: GitHubIssueSearchItem[];
}

interface GitHubIssueSearchItem extends GitHubIssue {
  repository_url?: string;
  pull_request?: {
    url?: string | null;
    html_url?: string | null;
  };
}

export interface UserWorkSyncDependencies {
  database: DatabaseService;
  workspace: WorkspaceService;
  github: GitHubClient;
  rateLimitWarning(): string | null;
  rateLimitPatch(): Pick<SyncJob, "githubRateLimitRemaining" | "githubRateLimitResetAt">;
  rateLimitBlocked(): boolean;
  updateProgress(jobId: string, progressMessage: string): void;
  failSyncJob(jobId: string, error: unknown): void;
  upsertRepo(repo: GitHubRepo, localPath: string, syncStatus: "fresh", syncError: null, isWatched: false, shouldClone: false): void;
  associateCurrentAccount(repo: GitHubRepo): void;
  githubWorkCachePersistencePort(): GitHubWorkUserPullRequestPersistencePort;
  syncPullRequestRelations(repoId: string, apiPath: string, pr: GitHubPullRequest, maxPages: number): Promise<void>;
  ensurePullRequestDiffCached(repoId: string, apiPath: string, pr: GitHubPullRequest): Promise<boolean>;
  isExpectedPullRequestDiffCacheMiss(error: unknown): boolean;
  logOptionalGitHubWarning(message: string, error: unknown): void;
}

const userPullRequestDiffWarmLimit = numberFromEnv("FALLBACK_GITHUB_USER_PR_DIFF_WARM_LIMIT", 200);
const myPullRequestSyncPages = numberFromEnv("FALLBACK_GITHUB_MY_PR_SYNC_PAGES", 2);
const myPullRequestDetailLimit = numberFromEnv("FALLBACK_GITHUB_MY_PR_DETAIL_LIMIT", 40);
const myPullRequestHydrationLimit = numberFromEnv("FALLBACK_GITHUB_MY_PR_HYDRATION_LIMIT", 10);

export class UserWorkSync {
  constructor(private readonly dependencies: UserWorkSyncDependencies) {}

  async syncUserPullRequests(options: EnqueueSyncOptions = {}): Promise<SyncJob> {
    const warningMessage = this.dependencies.rateLimitWarning();
    const reason = options.reason ?? "my_work";
    const priority = options.priority ?? syncPriority.myWork;
    const dedupeKey = options.dedupeKey ?? "user_pull_requests_sync";
    const activeJob = this.dependencies.database.localCache.syncJobs.activeSyncJobByDedupeKey(dedupeKey);
    if (activeJob) {
      if (priority > activeJob.priority || reason !== activeJob.reason) {
        this.dependencies.database.localCache.syncJobs.updateSyncJob(activeJob.id, {
          priority: Math.max(priority, activeJob.priority),
          reason,
          progressMessage: activeJob.status === "queued" ? `${syncReasonLabel(reason)}: waiting to sync` : activeJob.progressMessage
        });
      }
      return { ...(this.dependencies.database.localCache.syncJobs.getSyncJob(activeJob.id) ?? activeJob), warningMessage };
    }

    const blockingAuthStatus = blockingSyncAuthStatus(syncAccountStatus(this.dependencies.database.localCache.accounts.getGitHubAccount()));
    if (blockingAuthStatus) {
      const job = this.dependencies.database.localCache.syncJobs.createSyncJob(null, "user_pull_requests_sync", {
        priority,
        reason,
        dedupeKey
      });
      const message = authStatusSyncMessage(blockingAuthStatus);
      this.dependencies.database.localCache.syncJobs.updateSyncJob(job.id, {
        status: "failed",
        errorCode: `github_auth_${blockingAuthStatus}`,
        lastErrorCode: `github_auth_${blockingAuthStatus}`,
        errorMessage: message,
        progressMessage: `${syncReasonLabel(reason)}: sync paused`,
        completedAt: nowIso(),
        ...this.dependencies.rateLimitPatch()
      });
      return { ...this.dependencies.database.localCache.syncJobs.getSyncJob(job.id)!, warningMessage };
    }

    const job = this.dependencies.database.localCache.syncJobs.createSyncJob(null, "user_pull_requests_sync", {
      priority,
      reason,
      dedupeKey
    });
    this.dependencies.database.localCache.syncJobs.updateSyncJob(job.id, {
      status: "running",
      progressMessage: `${syncReasonLabel(reason)}: finding your GitHub account`,
      startedAt: nowIso(),
      ...this.dependencies.rateLimitPatch()
    });

    try {
      this.dependencies.database.localCache.appMetadata.setAppMetadata("user_pull_requests_last_attempted_at", nowIso());
      const viewer = await this.dependencies.github.get<GitHubUser>("/user");
      this.dependencies.database.localCache.accounts.upsertGitHubAccount({
        id: viewer.id,
        login: viewer.login,
        endpoint: "https://api.github.com",
        htmlUrl: viewer.html_url ?? null,
        avatarUrl: viewer.avatar_url,
        name: viewer.name ?? null,
        accountType: viewer.type === "Organization" ? "Organization" : "User",
        authStatus: "connected",
        lastValidatedAt: nowIso()
      });
      this.dependencies.updateProgress(job.id, "Searching your pull requests");
      const issueRows = await this.searchUserPullRequestIssues(viewer.login);
      const detailRows = issueRows.slice(0, myPullRequestDetailLimit);
      const touchedRepoIds = new Set<string>();
      const repoByPath = new Map<string, GitHubRepo>();
      const syncedPrs: Array<{ repoId: string; path: string; pr: GitHubPullRequest }> = [];
      const discoveredPrs: Array<{ repoId: string; path: string; pr: GitHubPullRequest }> = [];

      for (const [index, issue] of detailRows.entries()) {
        const repoPath = repoPathFromSearchIssue(issue);
        if (!repoPath) continue;
        this.dependencies.updateProgress(job.id, `Caching your PRs ${index + 1}/${detailRows.length}`);
        let repo = repoByPath.get(repoPath);
        if (!repo) {
          repo = await this.dependencies.github.get<GitHubRepo>(repoPath);
          repoByPath.set(repoPath, repo);
        }
        const { owner, name } = normalizeRepoFullName(repo.full_name);
        const localPath = this.dependencies.workspace.ensureRepoFolder(owner, name, "metadata-only");
        this.dependencies.upsertRepo(repo, localPath, "fresh", null, false, false);
        this.dependencies.associateCurrentAccount(repo);

        const repoId = repoIdFromFullName(repo.full_name);
        const pr = await this.dependencies.github.get<GitHubPullRequest>(`${repoPath}/pulls/${issue.number}`);
        const needsCacheRefresh = persistUserPullRequestToCache(this.dependencies.githubWorkCachePersistencePort(), {
          repoId,
          login: viewer.login,
          pullRequest: pr,
          relation: userPrRelation(viewer.login, pr)
        });
        touchedRepoIds.add(repoId);
        discoveredPrs.push({ repoId, path: repoPath, pr });
        if (needsCacheRefresh) syncedPrs.push({ repoId, path: repoPath, pr });
      }

      const relationTargets = syncedPrs.slice(0, myPullRequestHydrationLimit);
      for (const [index, target] of relationTargets.entries()) {
        this.dependencies.updateProgress(job.id, `Caching your PR comments ${index + 1}/${relationTargets.length}`);
        await this.dependencies.syncPullRequestRelations(target.repoId, target.path, target.pr, 1);
      }
      const diffTargets = discoveredPrs.slice(0, userPullRequestDiffWarmLimit);
      for (const [index, target] of diffTargets.entries()) {
        this.dependencies.updateProgress(job.id, `Caching your PR diffs ${index + 1}/${diffTargets.length}`);
        await this.dependencies.ensurePullRequestDiffCached(target.repoId, target.path, target.pr).catch((error: unknown) => {
          if (!this.dependencies.isExpectedPullRequestDiffCacheMiss(error)) {
            this.dependencies.logOptionalGitHubWarning(`Failed to cache PR diff ${target.repoId}#${target.pr.number}.`, error);
          }
        });
        if (this.dependencies.rateLimitBlocked()) break;
      }

      this.dependencies.updateProgress(job.id, "Updating My PRs search index");
      for (const repoId of touchedRepoIds) this.dependencies.database.localCache.searchIndex.rebuildSearchIndex(repoId);
      this.dependencies.database.localCache.appMetadata.setAppMetadata("user_pull_requests_last_synced_at", nowIso());
      this.dependencies.database.localCache.syncJobs.updateSyncJob(job.id, {
        status: "success",
        progressMessage: "My PRs sync complete",
        completedAt: nowIso(),
        ...this.dependencies.rateLimitPatch()
      });
    } catch (error) {
      this.dependencies.failSyncJob(job.id, error);
    }

    return { ...this.dependencies.database.localCache.syncJobs.getSyncJob(job.id)!, warningMessage };
  }

  private async searchUserPullRequestIssues(login: string): Promise<GitHubIssueSearchItem[]> {
    const results: GitHubIssueSearchItem[] = [];
    for (let page = 1; page <= myPullRequestSyncPages; page += 1) {
      const response = await this.dependencies.github.get<GitHubIssueSearchResponse>("/search/issues", {
        q: `is:pr archived:false involves:${login}`,
        sort: "updated",
        order: "desc",
        per_page: 100,
        page
      });
      results.push(...response.items);
      if (response.items.length < 100 || results.length >= response.total_count) break;
    }
    return uniqueSearchIssuesByRepoAndNumber(results.filter((issue) => issue.pull_request));
  }
}

function uniqueSearchIssuesByRepoAndNumber(issues: GitHubIssueSearchItem[]): GitHubIssueSearchItem[] {
  const seen = new Set<string>();
  const unique: GitHubIssueSearchItem[] = [];
  for (const issue of issues) {
    const key = `${issue.repository_url ?? ""}:${issue.number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(issue);
  }
  return unique;
}

function repoPathFromSearchIssue(issue: GitHubIssueSearchItem): string | null {
  if (issue.repository_url) {
    const url = new URL(issue.repository_url);
    return url.pathname;
  }
  const pullRequestUrl = issue.pull_request?.url;
  if (!pullRequestUrl) return null;
  const url = new URL(pullRequestUrl);
  return url.pathname.replace(/\/pulls\/\d+$/, "");
}

function userPrRelation(login: string, pr: GitHubPullRequest): string {
  if (sameLogin(pr.user?.login, login)) return "author";
  if ((pr.assignees ?? []).some((user) => sameLogin(user.login, login))) return "assignee";
  if ((pr.requested_reviewers ?? []).some((user) => sameLogin(user.login, login))) return "reviewer";
  return "involved";
}

function sameLogin(value: string | null | undefined, login: string | null | undefined): boolean {
  return Boolean(value && login && value.toLowerCase() === login.toLowerCase());
}

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
