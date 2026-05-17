import type { WatchedRepo } from "../../../src/shared/domain/watched-repo.js";
import type { LocalChangesState, LocalGitConflictState, LocalGitNetworkPreflight } from "../../../src/shared/domain/local-git.js";
import type { DatabaseService } from "../database-service.js";
import type { SettingsService } from "../settings-service.js";
import { cachedLocalGitRead as readThroughCache } from "./git-command-cache.js";
import type { TimedPromiseCacheEntry } from "./git-command-cache.js";
import { isClonedLocalRepo } from "./git-workflow-helpers.js";

export interface LocalGitWorkflowDependencies {
  database: DatabaseService;
  settings?: SettingsService;
  onBackgroundRefresh?: (repoId?: string | null) => void;
  invalidateLocalChangesCache: (repoId: string) => void;
  invalidatePreflightCache: (repoId: string) => void;
  changesOverview: (repoId: string) => Promise<LocalChangesState>;
  changes: (repoId: string) => Promise<LocalChangesState>;
  gitNetworkPreflight: (repoId: string) => Promise<LocalGitNetworkPreflight>;
  loadGitNetworkPreflight: (repoId: string) => Promise<LocalGitNetworkPreflight>;
  conflictState: (repoId: string) => Promise<LocalGitConflictState>;
}

export abstract class LocalGitWorkflowBase {
  protected constructor(protected readonly deps: LocalGitWorkflowDependencies) {}

  protected get database(): DatabaseService {
    return this.deps.database;
  }
  protected get settings(): SettingsService | undefined {
    return this.deps.settings;
  }
  protected get onBackgroundRefresh(): ((repoId?: string | null) => void) | undefined {
    return this.deps.onBackgroundRefresh;
  }

  protected requireLocalRepo(repoId: string): WatchedRepo & { localPath: string } {
    const repo = this.database.localCache.repos.getRepo(repoId);
    if (!repo) throw new Error("Repository is not watched.");
    if (!isClonedLocalRepo(repo)) throw new Error("Local changes are available for cloned repositories only.");
    return repo as WatchedRepo & { localPath: string };
  }

  protected cachedLocalGitRead<T>(
    cache: Map<string, TimedPromiseCacheEntry<T>>,
    key: string,
    ttlMs: number,
    load: () => Promise<T>,
    options: { onRefresh?: () => void } = {}
  ): Promise<T> {
    return readThroughCache(cache, key, ttlMs, load, options);
  }

  protected invalidateLocalChangesCache(repoId: string): void {
    this.deps.invalidateLocalChangesCache(repoId);
  }
  protected invalidatePreflightCache(repoId: string): void {
    this.deps.invalidatePreflightCache(repoId);
  }
  protected changesOverview(repoId: string): Promise<LocalChangesState> {
    return this.deps.changesOverview(repoId);
  }
  protected changes(repoId: string): Promise<LocalChangesState> {
    return this.deps.changes(repoId);
  }
  protected gitNetworkPreflight(repoId: string): Promise<LocalGitNetworkPreflight> {
    return this.deps.gitNetworkPreflight(repoId);
  }
  protected loadGitNetworkPreflight(repoId: string): Promise<LocalGitNetworkPreflight> {
    return this.deps.loadGitNetworkPreflight(repoId);
  }
  protected conflictState(repoId: string): Promise<LocalGitConflictState> {
    return this.deps.conflictState(repoId);
  }
}
