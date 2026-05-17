import type { DatabaseService } from "../database-service.js";
import { GitHubApiError, type GitHubClient, type GitHubIssue, type GitHubPullRequest } from "../github-client.js";
import { nowIso } from "../path-utils.js";
import { syncPriority } from "../../../src/shared/sync-policy.js";
import type { SyncJob } from "../../../src/shared/domain/sync.js";

export interface GitHubWorkDetailRefreshContext {
  repo: { id: string };
  path: string;
}

export interface GitHubWorkDetailRefreshDependencies {
  database: DatabaseService;
  github: GitHubClient;
  repoSyncContext(repoId: string): GitHubWorkDetailRefreshContext;
  rateLimitWarning(): string | null;
  rateLimitPatch(): Pick<SyncJob, "githubRateLimitRemaining" | "githubRateLimitResetAt">;
  updateProgress(jobId: string, progressMessage: string): void;
  failSyncJob(jobId: string, error: unknown): void;
  syncPullRequestRelations(repoId: string, apiPath: string, pr: GitHubPullRequest, maxPages: number): Promise<void>;
  syncIssueComments(repoId: string, apiPath: string, issue: GitHubIssue, maxPages: number): Promise<void>;
  ensurePullRequestDiffCached(repoId: string, apiPath: string, pr: GitHubPullRequest): Promise<boolean>;
}

const detailRefreshPages = numberFromEnv("FALLBACK_GITHUB_DETAIL_REFRESH_PAGES", 3);

export class GitHubWorkDetailRefresh {
  constructor(private readonly dependencies: GitHubWorkDetailRefreshDependencies) {}

  async syncPullRequest(repoId: string, number: number): Promise<SyncJob> {
    const { repo, path } = this.dependencies.repoSyncContext(repoId);
    const warningMessage = this.dependencies.rateLimitWarning();
    const job = this.dependencies.database.localCache.syncJobs.createSyncJob(repo.id, "pull_request_detail_sync", {
      priority: syncPriority.manual,
      reason: "manual_refresh",
      dedupeKey: `${repo.id}:pull_request_detail_sync:${number}`
    });
    this.dependencies.database.localCache.syncJobs.updateSyncJob(job.id, {
      status: "running",
      progressMessage: `Manual Refresh: refreshing PR #${number}`,
      startedAt: nowIso(),
      ...this.dependencies.rateLimitPatch()
    });

    try {
      const pr = await this.dependencies.github.get<GitHubPullRequest>(`${path}/pulls/${number}`);
      this.dependencies.updateProgress(job.id, `Caching PR #${number} reviews and checks`);
      await this.dependencies.syncPullRequestRelations(repo.id, path, pr, detailRefreshPages);
      this.dependencies.updateProgress(job.id, `Caching PR #${number} diff`);
      await this.dependencies.ensurePullRequestDiffCached(repo.id, path, pr);
      this.dependencies.database.localCache.searchIndex.rebuildPullRequestSearchIndex(repo.id, number);
      this.dependencies.database.localCache.syncJobs.updateSyncJob(job.id, {
        status: "success",
        progressMessage: "PR sync complete",
        completedAt: nowIso(),
        ...this.dependencies.rateLimitPatch()
      });
    } catch (error) {
      if (error instanceof GitHubApiError && [403, 404].includes(error.status))
        this.dependencies.database.localCache.repos.markPullRequestStale(repo.id, number);
      this.dependencies.failSyncJob(job.id, error);
    }

    return { ...this.dependencies.database.localCache.syncJobs.getSyncJob(job.id)!, warningMessage };
  }

  async syncIssue(repoId: string, number: number): Promise<SyncJob> {
    const { repo, path } = this.dependencies.repoSyncContext(repoId);
    const warningMessage = this.dependencies.rateLimitWarning();
    const job = this.dependencies.database.localCache.syncJobs.createSyncJob(repo.id, "issue_detail_sync", {
      priority: syncPriority.manual,
      reason: "manual_refresh",
      dedupeKey: `${repo.id}:issue_detail_sync:${number}`
    });
    this.dependencies.database.localCache.syncJobs.updateSyncJob(job.id, {
      status: "running",
      progressMessage: `Manual Refresh: refreshing issue #${number}`,
      startedAt: nowIso(),
      ...this.dependencies.rateLimitPatch()
    });

    try {
      const issue = await this.dependencies.github.get<GitHubIssue>(`${path}/issues/${number}`);
      if (issue.pull_request) {
        this.dependencies.updateProgress(job.id, `Caching PR #${number} details`);
        const pr = await this.dependencies.github.get<GitHubPullRequest>(`${path}/pulls/${number}`);
        await this.dependencies.syncPullRequestRelations(repo.id, path, pr, detailRefreshPages);
        this.dependencies.updateProgress(job.id, `Caching PR #${number} diff`);
        await this.dependencies.ensurePullRequestDiffCached(repo.id, path, pr);
        this.dependencies.database.localCache.searchIndex.rebuildPullRequestSearchIndex(repo.id, number);
      } else {
        this.dependencies.updateProgress(job.id, `Caching issue #${number} comments`);
        await this.dependencies.syncIssueComments(repo.id, path, issue, detailRefreshPages);
        this.dependencies.database.localCache.searchIndex.rebuildIssueSearchIndex(repo.id, number);
      }
      this.dependencies.database.localCache.syncJobs.updateSyncJob(job.id, {
        status: "success",
        progressMessage: "Issue sync complete",
        completedAt: nowIso(),
        ...this.dependencies.rateLimitPatch()
      });
    } catch (error) {
      if (error instanceof GitHubApiError && [403, 404].includes(error.status))
        this.dependencies.database.localCache.repos.markIssueStale(repo.id, number);
      this.dependencies.failSyncJob(job.id, error);
    }

    return { ...this.dependencies.database.localCache.syncJobs.getSyncJob(job.id)!, warningMessage };
  }
}

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
