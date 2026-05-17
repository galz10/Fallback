import type { WatchedRepo } from "../../../src/shared/domain/watched-repo.js";
import type { LocalChangesState, LocalChangesSummary } from "../../../src/shared/domain/local-git.js";
import { gitRaw, gitText } from "../git-command.js";
import { localChangesOverviewCacheMs, localChangesSummaryCacheMs } from "./git-command-cache.js";
import type { TimedPromiseCacheEntry } from "./git-command-cache.js";
import { LocalGitWorkflowBase, type LocalGitWorkflowDependencies } from "./workflow-base.js";
import {
  emptyLocalChangesState,
  errorMessage,
  gitNumstat,
  gitStashes,
  gitStatus,
  isClonedLocalRepo,
  logLocalGitTiming,
  mergeStats,
  untrackedFilePatches,
  untrackedLineCounts
} from "./git-workflow-helpers.js";
import type { LocalChangesSummaryOptions } from "./git-workflow-helpers.js";

export class LocalChangesReader extends LocalGitWorkflowBase {
  private readonly changesOverviewCache = new Map<string, TimedPromiseCacheEntry<LocalChangesState>>();
  private readonly changesSummaryCache = new Map<string, TimedPromiseCacheEntry<LocalChangesSummary[]>>();

  constructor(deps: LocalGitWorkflowDependencies) {
    super(deps);
  }

  invalidate(repoId: string): void {
    this.changesOverviewCache.delete(repoId);
    this.changesSummaryCache.clear();
  }

  async changes(repoId: string): Promise<LocalChangesState> {
    const startedAt = performance.now();
    const repo = this.requireLocalRepo(repoId);
    try {
      const [branch, statusEntries, stagedPatch, unstagedPatch, stagedStats, unstagedStats, stashes] = await Promise.all([
        gitText(repo.localPath!, ["branch", "--show-current"]).catch(() => repo.defaultBranch ?? "HEAD"),
        gitStatus(repo.localPath!),
        gitRaw(repo.localPath!, ["diff", "--cached", "--patch", "--find-renames"], 60_000),
        gitRaw(repo.localPath!, ["diff", "--patch", "--find-renames"], 60_000),
        gitNumstat(repo.localPath!, ["diff", "--cached", "--numstat"]),
        gitNumstat(repo.localPath!, ["diff", "--numstat"]),
        gitStashes(repo.localPath!)
      ]);
      const untrackedPatches = await untrackedFilePatches(repo.localPath!, statusEntries);
      const stats = mergeStats(stagedStats, unstagedStats);
      for (const [filePath, additions] of untrackedLineCounts(repo.localPath!, statusEntries)) {
        if (!stats.has(filePath)) stats.set(filePath, { additions, deletions: 0 });
      }
      const files = statusEntries.map((entry) => {
        const totals = stats.get(entry.path) ?? { additions: 0, deletions: 0 };
        return {
          path: entry.path,
          previousPath: entry.previousPath,
          status: entry.status,
          staged: entry.staged,
          unstaged: entry.unstaged,
          additions: totals.additions,
          deletions: totals.deletions
        };
      });
      const additions = [...stats.values()].reduce((sum, value) => sum + value.additions, 0);
      const deletions = [...stats.values()].reduce((sum, value) => sum + value.deletions, 0);
      const patch = [stagedPatch, unstagedPatch, ...untrackedPatches].filter((part) => part.trim()).join("\n");

      return {
        repoId,
        branch: branch || repo.defaultBranch || "HEAD",
        isDirty: files.length > 0,
        files,
        additions,
        deletions,
        patch,
        stashes
      };
    } finally {
      logLocalGitTiming("local-changes", startedAt, { repoId });
    }
  }

  async changesOverview(repoId: string): Promise<LocalChangesState> {
    return this.cachedLocalGitRead(this.changesOverviewCache, repoId, localChangesOverviewCacheMs, () => this.loadChangesOverview(repoId), {
      onRefresh: () => this.onBackgroundRefresh?.(repoId)
    });
  }

  private async loadChangesOverview(repoId: string): Promise<LocalChangesState> {
    const startedAt = performance.now();
    const repo = this.database.localCache.repos.getRepo(repoId);
    try {
      if (!repo) throw new Error("Repository is not watched.");
      if (!isClonedLocalRepo(repo)) return emptyLocalChangesState(repo);
      const [branch, statusEntries, stagedStats, unstagedStats, stashes] = await Promise.all([
        gitText(repo.localPath, ["branch", "--show-current"]).catch(() => repo.defaultBranch ?? "HEAD"),
        gitStatus(repo.localPath),
        gitNumstat(repo.localPath, ["diff", "--cached", "--numstat"]),
        gitNumstat(repo.localPath, ["diff", "--numstat"]),
        gitStashes(repo.localPath)
      ]);
      const stats = mergeStats(stagedStats, unstagedStats);
      const files = statusEntries.map((entry) => {
        const totals = stats.get(entry.path) ?? { additions: 0, deletions: 0 };
        return {
          path: entry.path,
          previousPath: entry.previousPath,
          status: entry.status,
          staged: entry.staged,
          unstaged: entry.unstaged,
          additions: totals.additions,
          deletions: totals.deletions
        };
      });
      const additions = [...stats.values()].reduce((sum, value) => sum + value.additions, 0);
      const deletions = [...stats.values()].reduce((sum, value) => sum + value.deletions, 0);

      return {
        repoId,
        branch: branch || repo.defaultBranch || "HEAD",
        isDirty: files.length > 0,
        files,
        additions,
        deletions,
        patch: "",
        stashes
      };
    } finally {
      logLocalGitTiming("local-changes-overview", startedAt, { repoId });
    }
  }

  async changesSummary(repoIds?: string[], options: LocalChangesSummaryOptions = {}): Promise<LocalChangesSummary[]> {
    const includeStats = options.includeStats !== false;
    const cacheKey = `${includeStats ? "stats" : "status"}:${repoIds ? [...repoIds].sort().join("|") : "*"}`;
    return this.cachedLocalGitRead(
      this.changesSummaryCache,
      cacheKey,
      localChangesSummaryCacheMs,
      () => this.loadChangesSummary(repoIds, { includeStats }),
      {
        onRefresh: () => {
          if (!repoIds || repoIds.length === 0) {
            this.onBackgroundRefresh?.(null);
            return;
          }
          for (const repoId of repoIds) this.onBackgroundRefresh?.(repoId);
        }
      }
    );
  }

  private async loadChangesSummary(
    repoIds: string[] | undefined,
    options: Required<LocalChangesSummaryOptions>
  ): Promise<LocalChangesSummary[]> {
    const allowedRepoIds = repoIds ? new Set(repoIds) : null;
    const repos = this.database.localCache.repos
      .listWatchedReposForActiveAccount()
      .filter((repo) => repo.localPath && (allowedRepoIds == null || allowedRepoIds.has(repo.id)));
    return Promise.all(repos.map((repo) => this.changeSummary(repo.id, options)));
  }

  private async changeSummary(repoId: string, options: Required<LocalChangesSummaryOptions>): Promise<LocalChangesSummary> {
    let repo: WatchedRepo & { localPath: string };
    try {
      repo = this.requireLocalRepo(repoId);
    } catch (error) {
      return {
        repoId,
        branch: null,
        isDirty: false,
        fileCount: 0,
        additions: 0,
        deletions: 0,
        error: errorMessage(error)
      };
    }

    try {
      const [branch, statusEntries] = await Promise.all([
        gitText(repo.localPath, ["branch", "--show-current"]).catch(() => repo.defaultBranch ?? "HEAD"),
        gitStatus(repo.localPath)
      ]);
      if (!options.includeStats) {
        return {
          repoId,
          branch: branch || repo.defaultBranch || "HEAD",
          isDirty: statusEntries.length > 0,
          fileCount: statusEntries.length,
          additions: 0,
          deletions: 0,
          error: null
        };
      }
      const [stagedStats, unstagedStats] = await Promise.all([
        gitNumstat(repo.localPath, ["diff", "--cached", "--numstat"]),
        gitNumstat(repo.localPath, ["diff", "--numstat"])
      ]);
      const stats = mergeStats(stagedStats, unstagedStats);
      for (const [filePath, additions] of untrackedLineCounts(repo.localPath, statusEntries)) {
        if (!stats.has(filePath)) stats.set(filePath, { additions, deletions: 0 });
      }
      const totals = [...stats.values()].reduce(
        (sum, entry) => ({
          additions: sum.additions + entry.additions,
          deletions: sum.deletions + entry.deletions
        }),
        { additions: 0, deletions: 0 }
      );
      return {
        repoId,
        branch: branch || repo.defaultBranch || "HEAD",
        isDirty: statusEntries.length > 0,
        fileCount: statusEntries.length,
        additions: totals.additions,
        deletions: totals.deletions,
        error: null
      };
    } catch (error) {
      return {
        repoId,
        branch: repo.defaultBranch,
        isDirty: false,
        fileCount: 0,
        additions: 0,
        deletions: 0,
        error: errorMessage(error)
      };
    }
  }
}
