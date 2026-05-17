import fs from "node:fs";
import path from "node:path";
import type { RepoCodeSummary } from "../../../src/shared/domain/repo-code.js";

interface CacheResult<T> {
  value: T;
  cachedAt: string | null;
  fromCache: boolean;
}

export interface RepoCodeSummaryReaderRepo {
  id: string;
  localPath: string | null;
  defaultBranch: string | null;
  lastSuccessfulSyncAt: string | null;
}

export interface RepoCodeSummaryReaderContext {
  repo: RepoCodeSummaryReaderRepo;
  path: string;
}

export interface RepoCodeSummaryReaderDependencies {
  getRepoMetadataCache<T>(repoId: string, cacheKey: string): { payload: T; updatedAt: string } | null;
  repoSyncContext(repoId: string): RepoCodeSummaryReaderContext;
  cachedRepo<T>(repoId: string, cacheKey: string, ttlMs: number, load: () => Promise<T>, fallback?: () => T): Promise<CacheResult<T>>;
  cachedLocalRepoCodeSummary(
    repoId: string,
    repo: RepoCodeSummaryReaderRepo,
    diskValue: { payload: RepoCodeSummary; updatedAt: string } | null
  ): Promise<RepoCodeSummary>;
  remoteRepoCodeSummary(repo: RepoCodeSummaryReaderRepo, apiPath: string): Promise<RepoCodeSummary>;
  withRepoStorage(repoId: string, summary: RepoCodeSummary, fastStoredBytes?: boolean): RepoCodeSummary;
}

const repoMetadataCacheMs = 10 * 60_000;

export class RepoCodeSummaryReader {
  constructor(private readonly dependencies: RepoCodeSummaryReaderDependencies) {}

  async repoCodeSummary(repoId: string): Promise<RepoCodeSummary> {
    const { repo, path: apiPath } = this.dependencies.repoSyncContext(repoId);
    const diskValue = this.dependencies.getRepoMetadataCache<RepoCodeSummary>(repoId, "code-summary");
    if (repo.localPath && fs.existsSync(path.join(repo.localPath, ".git"))) {
      return this.dependencies.cachedLocalRepoCodeSummary(repoId, repo, diskValue);
    }

    const result = await this.dependencies.cachedRepo<RepoCodeSummary>(
      repoId,
      "code-summary",
      repoMetadataCacheMs,
      () => this.dependencies.remoteRepoCodeSummary(repo, apiPath),
      () => fallbackRepoCodeSummary(repo)
    );
    return stampRepoCodeSummary(this.dependencies.withRepoStorage(repoId, result.value), result.cachedAt, result.fromCache);
  }
}

function stampRepoCodeSummary(summary: RepoCodeSummary, cachedAt: string | null, fromCache: boolean): RepoCodeSummary {
  return { ...summary, cachedAt, fromCache };
}

function fallbackRepoCodeSummary(repo: { defaultBranch: string | null }): RepoCodeSummary {
  return {
    defaultBranch: repo.defaultBranch,
    latestCommit: null,
    commits: [],
    branchCount: 0,
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
