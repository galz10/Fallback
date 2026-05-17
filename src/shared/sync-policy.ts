import type { WatchedRepo } from "./domain/watched-repo.js";
import type { SyncStatus } from "./domain/sync.js";

export const syncPriority = {
  maintenance: 10,
  staleRepo: 30,
  recentActivity: 35,
  localChanges: 45,
  myWork: 55,
  activeRepo: 70,
  activeDetail: 80,
  manual: 100
} as const;

export const syncFreshnessMs = {
  activeDetail: 5 * 60 * 1000,
  activeRepo: 30 * 60 * 1000,
  myWork: 30 * 60 * 1000,
  repoMetadata: 30 * 60 * 1000,
  repoReferences: 6 * 60 * 60 * 1000,
  recentActivity: 24 * 60 * 60 * 1000,
  maintenance: 24 * 60 * 60 * 1000
} as const;

interface RepoPrioritySignals {
  hasLocalChanges?: boolean;
  now?: number;
}

export function isRepoRefreshDue(
  repo: Pick<WatchedRepo, "lastSuccessfulSyncAt" | "lastSyncedAt" | "syncStatus">,
  ttlMs: number,
  now = Date.now()
): boolean {
  if (repo.syncStatus === "queued" || repo.syncStatus === "syncing") return false;
  const lastSyncAt = repo.lastSuccessfulSyncAt ?? repo.lastSyncedAt;
  if (!lastSyncAt) return true;
  const lastSyncTime = Date.parse(lastSyncAt);
  return !Number.isFinite(lastSyncTime) || now - lastSyncTime >= ttlMs;
}

export function syncCooldownMs(status: SyncStatus, attemptCount = 0): number {
  const retryBackoff = Math.min(60, 5 * 2 ** Math.max(0, attemptCount - 1)) * 60 * 1000;
  if (status === "rate_limited") return 30 * 60 * 1000;
  if (status === "auth_error") return 60 * 60 * 1000;
  if (status === "offline") return 10 * 60 * 1000;
  if (status === "failed") return retryBackoff;
  return 0;
}

export function repoHasRecentGitHubActivity(
  repo: Pick<WatchedRepo, "pushedAt" | "githubUpdatedAt" | "lastSuccessfulSyncAt" | "lastSyncedAt">,
  now = Date.now()
): boolean {
  const activityTime = timestamp(repo.pushedAt ?? repo.githubUpdatedAt);
  if (activityTime <= 0 || now - activityTime > syncFreshnessMs.recentActivity) return false;
  const lastSyncTime = timestamp(repo.lastSuccessfulSyncAt ?? repo.lastSyncedAt);
  return lastSyncTime <= 0 || activityTime >= lastSyncTime;
}

export function repoSyncPriority(
  repo: Pick<
    WatchedRepo,
    "watchPriority" | "openPullRequests" | "lastSuccessfulSyncAt" | "syncStatus" | "pushedAt" | "githubUpdatedAt" | "lastSyncedAt"
  >,
  signals: RepoPrioritySignals = {}
): number {
  if (repo.openPullRequests > 0) return syncPriority.myWork;
  if (signals.hasLocalChanges) return syncPriority.localChanges;
  if (repo.watchPriority >= 10) return syncPriority.staleRepo + 10;
  if (repoHasRecentGitHubActivity(repo, signals.now)) return syncPriority.recentActivity;
  if (!repo.lastSuccessfulSyncAt || repo.syncStatus === "stale" || repo.syncStatus === "failed") return syncPriority.staleRepo;
  return syncPriority.maintenance;
}

export function repoSyncReason(
  repo: Pick<
    WatchedRepo,
    "watchPriority" | "openPullRequests" | "lastSuccessfulSyncAt" | "syncStatus" | "pushedAt" | "githubUpdatedAt" | "lastSyncedAt"
  >,
  signals: RepoPrioritySignals = {}
): string {
  if (repo.openPullRequests > 0) return "requested_review_queue";
  if (signals.hasLocalChanges) return "local_changes";
  if (repo.watchPriority >= 10) return "high_priority_repo";
  if (repoHasRecentGitHubActivity(repo, signals.now)) return "recent_github_activity";
  if (!repo.lastSuccessfulSyncAt || repo.syncStatus === "stale" || repo.syncStatus === "failed") return "stale_repo";
  return "background_maintenance";
}

export function syncReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "Background maintenance";
  return reason
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
