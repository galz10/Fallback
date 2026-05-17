import type { CacheSummary } from "../../shared/domain/cache";
import { formatBytes } from "../lib/format";
import { storageSegmentColor } from "./storage-segments";

export function StorageUsageBar({ cache, compact = false }: { cache: CacheSummary; compact?: boolean }) {
  const databaseOnlyBytes = Math.max(
    0,
    cache.databaseBytes - cache.repos.reduce((sum, repo) => sum + (repo.estimatedBytes - repo.localBytes), 0)
  );
  const segments = [
    ...cache.repos
      .filter((repo) => repo.estimatedBytes > 0)
      .sort((a, b) => b.estimatedBytes - a.estimatedBytes)
      .slice(0, 6)
      .map((repo, index) => ({
        label: repo.repoFullName,
        bytes: repo.estimatedBytes,
        className: storageSegmentColor(index)
      })),
    ...(databaseOnlyBytes > 0 ? [{ label: "Shared database", bytes: databaseOnlyBytes, className: "bg-gray-900" }] : [])
  ];
  const visibleBytes = segments.reduce((sum, segment) => sum + segment.bytes, 0);
  const otherBytes = Math.max(0, cache.totalBytes - visibleBytes);
  if (otherBytes > 0) segments.push({ label: "Other watched repos", bytes: otherBytes, className: "bg-gray-700" });

  if (compact) {
    return (
      <div className="h-1 w-full rounded-full bg-gray-alpha-200 overflow-hidden flex">
        {segments.map((segment) => (
          <div
            key={segment.label}
            className={`${segment.className} h-full opacity-90`}
            style={{ width: `${Math.max(2, (segment.bytes / Math.max(cache.totalBytes, 1)) * 100)}%` }}
            title={`${segment.label}: ${formatBytes(segment.bytes)}`}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="h-2 w-full rounded-full bg-gray-alpha-200 overflow-hidden border border-gray-alpha-300 flex">
        {segments.map((segment) => (
          <div
            key={segment.label}
            className={`${segment.className} h-full`}
            style={{ width: `${Math.max(2, (segment.bytes / Math.max(cache.totalBytes, 1)) * 100)}%` }}
            title={`${segment.label}: ${formatBytes(segment.bytes)}`}
          />
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="text-[12px] text-gray-900">
          Database: <span className="font-mono text-gray-1000">{formatBytes(cache.databaseBytes)}</span>
        </div>
        <div className="text-[12px] text-gray-900">
          Repo folders: <span className="font-mono text-gray-1000">{formatBytes(Math.max(0, cache.totalBytes - cache.databaseBytes))}</span>
        </div>
      </div>
      {cache.repos.length > 0 && (
        <div className="space-y-1.5">
          {cache.repos
            .filter((repo) => repo.estimatedBytes > 0)
            .sort((a, b) => b.estimatedBytes - a.estimatedBytes)
            .slice(0, 4)
            .map((repo) => (
              <div key={repo.repoId} className="flex items-center justify-between gap-3 text-[12px]">
                <span className="text-gray-900 truncate">{repo.repoFullName}</span>
                <span className="text-gray-1000 font-mono shrink-0">{formatBytes(repo.estimatedBytes)}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
