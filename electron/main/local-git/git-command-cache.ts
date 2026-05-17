export const localChangesOverviewCacheMs = 3_000;
export const localChangesSummaryCacheMs = 15_000;
export const gitNetworkPreflightCacheMs = 5_000;
export const conflictPreflightCacheMs = 5_000;
export const branchIntegrityRemoteFetchCacheMs = 60_000;
export const fallbackSafetyRefsFetchCacheMs = 5 * 60_000;

export interface TimedPromiseCacheEntry<T> {
  promise: Promise<T>;
  expiresAt: number;
  value?: T;
  refreshing?: boolean;
}

export function cachedLocalGitRead<T>(
  cache: Map<string, TimedPromiseCacheEntry<T>>,
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  options: { onRefresh?: () => void } = {}
): Promise<T> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached?.value !== undefined && cached.expiresAt > now) return Promise.resolve(cached.value);
  if (cached?.value !== undefined) {
    if (!cached.refreshing) {
      const staleValue = cached.value;
      const promise = load()
        .then((value) => {
          cache.set(key, { promise: Promise.resolve(value), value, expiresAt: Date.now() + ttlMs });
          options.onRefresh?.();
          return value;
        })
        .catch((error) => {
          cache.set(key, { promise: Promise.resolve(staleValue), value: staleValue, expiresAt: Date.now() + Math.min(ttlMs, 5_000) });
          console.warn(`[perf] stale local git refresh failed key=${key}`, error);
          return staleValue;
        });
      cache.set(key, { ...cached, promise, refreshing: true });
    }
    return Promise.resolve(cached.value);
  }
  if (cached) return cached.promise;

  const promise = load()
    .then((value) => {
      cache.set(key, { promise: Promise.resolve(value), value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .catch((error) => {
      cache.delete(key);
      throw error;
    });
  cache.set(key, { promise, expiresAt: now + ttlMs });
  return promise;
}
