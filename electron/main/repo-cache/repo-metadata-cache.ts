import type { DatabaseService } from "../database-service.js";
import { nowIso } from "../path-utils.js";

interface RuntimeCacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface RepoMetadataCacheResult<T> {
  value: T;
  cachedAt: string | null;
  fromCache: boolean;
}

export interface RepoMetadataCacheDependencies {
  database: DatabaseService;
  responseCache: Map<string, RuntimeCacheEntry<unknown>>;
  inFlight: Map<string, Promise<unknown>>;
  rateLimitBlocked(): boolean;
  isRateLimitError(error: unknown): boolean;
}

export class RepoMetadataCache {
  constructor(private readonly dependencies: RepoMetadataCacheDependencies) {}

  async cachedRepo<T>(
    repoId: string,
    cacheKey: string,
    ttlMs: number,
    load: () => Promise<T>,
    fallback?: () => T
  ): Promise<RepoMetadataCacheResult<T>> {
    const key = `repo:${repoId}:${cacheKey}`;
    const now = Date.now();
    const cached = this.dependencies.responseCache.get(key) as RuntimeCacheEntry<RepoMetadataCacheResult<T>> | undefined;
    if (cached && cached.expiresAt > now) return cached.value;

    const diskValue = this.dependencies.database.localCache.repoMetadata.getRepoMetadataCache<T>(repoId, cacheKey);
    const existing = this.dependencies.inFlight.get(key) as Promise<RepoMetadataCacheResult<T>> | undefined;
    if (diskValue) {
      const result = { value: diskValue.payload, cachedAt: diskValue.updatedAt, fromCache: true };
      this.dependencies.responseCache.set(key, { value: result, expiresAt: Date.now() + Math.min(ttlMs, 30_000) });
      if (!existing && !this.dependencies.rateLimitBlocked()) {
        void this.refreshRepoCache(key, repoId, cacheKey, ttlMs, load).catch(() => undefined);
      }
      return result;
    }

    if (existing) return existing;

    const staleFallback = (): RepoMetadataCacheResult<T> => {
      if (cached) return { ...cached.value, fromCache: true };
      return { value: fallback?.() ?? ([] as T), cachedAt: null, fromCache: true };
    };

    if (this.dependencies.rateLimitBlocked()) {
      return staleFallback();
    }

    return this.refreshRepoCache(key, repoId, cacheKey, ttlMs, load).catch((error: unknown) => {
      if (this.dependencies.isRateLimitError(error)) {
        return staleFallback();
      }
      throw error;
    });
  }

  refreshRepoCache<T>(
    key: string,
    repoId: string,
    cacheKey: string,
    ttlMs: number,
    load: () => Promise<T>
  ): Promise<RepoMetadataCacheResult<T>> {
    const existing = this.dependencies.inFlight.get(key) as Promise<RepoMetadataCacheResult<T>> | undefined;
    if (existing) return existing;

    const promise = load()
      .then((value) => {
        const cachedAt = nowIso();
        this.dependencies.database.localCache.repoMetadata.setRepoMetadataCache(repoId, cacheKey, value, cachedAt);
        const result = { value, cachedAt, fromCache: false };
        this.dependencies.responseCache.set(key, { value: result, expiresAt: Date.now() + ttlMs });
        return result;
      })
      .finally(() => this.dependencies.inFlight.delete(key));

    this.dependencies.inFlight.set(key, promise);
    return promise;
  }
}
