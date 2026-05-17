import type { GitHubAccountSession } from "../../../src/shared/domain/auth.js";
import { syncPriority } from "../../../src/shared/sync-policy.js";

export interface EnqueueSyncOptions {
  priority?: number;
  reason?: string | null;
  notBefore?: string | null;
  dedupeKey?: string | null;
  bypassCooldown?: boolean;
}

export const foregroundOperationSyncDeferralMs = 2 * 60_000;
export const lowRateLimitRemaining = 100;

export function defaultSyncPriority(jobType: string): number {
  if (jobType.startsWith("manual_")) return syncPriority.manual;
  if (jobType === "initial_repo_sync" || jobType === "startup_repo_sync" || jobType === "active_repo_sync") return syncPriority.activeRepo;
  return syncPriority.maintenance;
}

export function defaultSyncReason(jobType: string): string {
  if (jobType.startsWith("manual_")) return "manual_refresh";
  if (jobType === "initial_repo_sync") return "initial_watch";
  if (jobType === "startup_repo_sync") return "startup_refresh";
  if (jobType === "active_repo_sync") return "active_view";
  return "background_maintenance";
}

export function shouldDeferSyncForForegroundOperation(jobType: string, reason: string | null, options: EnqueueSyncOptions): boolean {
  return jobType !== "manual_repo_sync" && reason !== "manual_refresh" && !options.bypassCooldown;
}

export function syncAccountStatus(account: GitHubAccountSession | null): SyncServiceAccountStatus {
  if (!account?.tokenSource) return "disconnected";
  return account.authStatus;
}

export function blockingSyncAuthStatus(status: SyncServiceAccountStatus | null | undefined): SyncServiceAccountStatus | null {
  if (
    status === "disconnected" ||
    status === "expired" ||
    status === "revoked" ||
    status === "insufficient_scope" ||
    status === "org_sso_required"
  )
    return status;
  return null;
}

export function authStatusSyncMessage(status: SyncServiceAccountStatus): string {
  switch (status) {
    case "disconnected":
      return "Connect GitHub to resume sync.";
    case "expired":
      return "GitHub sign-in expired. Reconnect your account to resume background sync.";
    case "revoked":
      return "GitHub token was revoked or rejected. Reconnect your account to resume background sync.";
    case "insufficient_scope":
      return "GitHub token is missing required permissions. Reconnect with the requested scopes to resume sync.";
    case "org_sso_required":
      return "GitHub organization SSO approval is required before background sync can resume.";
    default:
      return "GitHub authentication needs attention before background sync can resume.";
  }
}

export type SyncServiceAccountStatus =
  | "disconnected"
  | "connected"
  | "expired"
  | "revoked"
  | "insufficient_scope"
  | "org_sso_required"
  | "rate_limited"
  | "unknown_error";
