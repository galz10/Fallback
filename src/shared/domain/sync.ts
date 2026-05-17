export type SyncStatus = "never_synced" | "queued" | "syncing" | "fresh" | "stale" | "failed" | "rate_limited" | "auth_error" | "offline";

export interface SyncJob {
  id: string;
  repoId: string | null;
  accountId: string | null;
  provider: string | null;
  jobType: string;
  status: string;
  priority: number;
  reason: string | null;
  notBefore: string | null;
  attemptCount: number;
  lastErrorCode: string | null;
  dedupeKey: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  progressMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  githubRateLimitRemaining: number | null;
  githubRateLimitResetAt: string | null;
  warningMessage?: string | null;
}

export interface SyncActiveContext {
  repoId?: string | null;
  view: string;
  prNumber?: number | null;
  issueNumber?: number | null;
  visible: boolean;
  online: boolean;
}
