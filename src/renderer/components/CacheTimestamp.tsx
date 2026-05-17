import { CacheStamp as UiCacheStamp } from "./ui";
import { formatDate, formatRelative } from "../lib/format";

export type CacheStampState = "live" | "cached" | "offline-cached";

export function CacheTimestamp({
  cachedAt,
  fromCache,
  state,
  className = ""
}: {
  cachedAt?: string | null;
  fromCache?: boolean;
  state?: CacheStampState;
  className?: string;
}) {
  const effectiveState: CacheStampState = state ?? (fromCache ? "cached" : "live");
  if (!cachedAt && !state) return null;
  return (
    <UiCacheStamp
      state={effectiveState}
      timestamp={cachedAt ? formatRelative(cachedAt) : null}
      title={cachedAt ? formatDate(cachedAt) : undefined}
      className={className}
    />
  );
}
