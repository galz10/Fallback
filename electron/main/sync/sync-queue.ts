import type { DatabaseService } from "../database-service.js";
import type { GitHubClient } from "../github-client.js";
import type { TokenService } from "../token-service.js";
import type { SyncJob } from "../../../src/shared/domain/sync.js";
import { syncPriority, syncReasonLabel } from "../../../src/shared/sync-policy.js";
import { nowIso } from "../path-utils.js";
import {
  authStatusSyncMessage,
  blockingSyncAuthStatus,
  defaultSyncPriority,
  defaultSyncReason,
  foregroundOperationSyncDeferralMs,
  lowRateLimitRemaining,
  shouldDeferSyncForForegroundOperation,
  syncAccountStatus,
  type EnqueueSyncOptions
} from "./sync-job-policy.js";

export interface SyncQueueCallbacks {
  onSyncChanged?: (repoId: string | null) => void;
}

export interface SyncQueueRuntime {
  isRateLimited(): boolean;
  rateLimitWarning(): string | null;
  rateLimitPatch(): Pick<SyncJob, "githubRateLimitRemaining" | "githubRateLimitResetAt">;
  syncRepo(repoId: string, jobId: string): Promise<SyncJob>;
}

interface SyncQueueItem {
  repoId: string;
  jobId: string;
  jobType: string;
  accountId: string | null;
  priority: number;
  notBefore: string | null;
  reason: string | null;
  queuedAt: number;
}

export class SyncQueue {
  readonly queue: SyncQueueItem[] = [];
  processing = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly github: GitHubClient,
    private readonly runtime: SyncQueueRuntime,
    private readonly callbacks: SyncQueueCallbacks = {},
    private readonly token?: TokenService
  ) {}

  enqueueRepoSync(repoId: string, jobType = "repo_sync", options: EnqueueSyncOptions = {}): Promise<SyncJob> {
    const warningMessage = this.runtime.rateLimitWarning();
    const priority = options.priority ?? defaultSyncPriority(jobType);
    const reason = options.reason ?? defaultSyncReason(jobType);
    const dedupeKey = options.dedupeKey ?? `${repoId}:${jobType}`;
    const activeOperation = this.database.localCache.operationRecords.active(repoId);
    const shouldDeferForOperation = Boolean(activeOperation && shouldDeferSyncForForegroundOperation(jobType, reason, options));
    const operationNotBefore = shouldDeferForOperation ? new Date(Date.now() + foregroundOperationSyncDeferralMs).toISOString() : null;
    const activeJob =
      this.database.localCache.syncJobs.activeSyncJobByDedupeKey(dedupeKey) ?? this.database.localCache.syncJobs.activeSyncJob(repoId);

    if (activeJob) {
      this.updateActiveJob(activeJob, jobType, priority, reason, operationNotBefore, shouldDeferForOperation);
      void this.drainQueue();
      this.notifySyncChanged(activeJob.repoId);
      return Promise.resolve({ ...(this.database.localCache.syncJobs.getSyncJob(activeJob.id) ?? activeJob), warningMessage });
    }

    const account = this.database.localCache.accounts.getGitHubAccount();
    if (!account || !this.database.localCache.repos.repoIsVisibleToAccount(repoId, account.id)) {
      const job = this.database.localCache.syncJobs.createSyncJob(repoId, jobType, {
        priority,
        reason,
        dedupeKey,
        accountId: account?.id ?? null
      });
      const message = account ? "Repository is not available in the active GitHub profile." : "Connect a GitHub profile before syncing.";
      this.failBeforeQueue(repoId, job, account?.id ?? null, reason, "github_profile_mismatch", message);
      return Promise.resolve({ ...this.database.localCache.syncJobs.getSyncJob(job.id)!, warningMessage });
    }

    const blockingAuthStatus = blockingSyncAuthStatus(syncAccountStatus(account));
    if (blockingAuthStatus) {
      const job = this.database.localCache.syncJobs.createSyncJob(repoId, jobType, { priority, reason, dedupeKey, accountId: account.id });
      const message = authStatusSyncMessage(blockingAuthStatus);
      this.failBeforeQueue(repoId, job, account.id, reason, `github_auth_${blockingAuthStatus}`, message);
      return Promise.resolve({ ...this.database.localCache.syncJobs.getSyncJob(job.id)!, warningMessage });
    }

    const job = this.database.localCache.syncJobs.createSyncJob(repoId, jobType, {
      priority,
      reason,
      notBefore: options.notBefore ?? operationNotBefore,
      dedupeKey,
      accountId: account.id
    });
    this.database.localCache.syncJobs.updateSyncJob(job.id, {
      progressMessage: shouldDeferForOperation
        ? "Paused while a foreground operation is running"
        : `${syncReasonLabel(reason)}: waiting to sync`
    });
    if (shouldDeferForOperation) {
      this.database.localCache.diagnostics.recordDiagnosticEvent({
        source: "sync",
        level: "info",
        code: "foreground_operation_sync_deferred",
        message: `${jobType} for ${repoId} deferred while ${activeOperation?.kind ?? "operation"} is active.`
      });
    }
    this.database.localCache.repos.setRepoSyncState(repoId, "queued", null);
    this.database.localCache.repoAccounts.setRepoAccountSyncState(repoId, account.id, "queued", null);
    this.queue.push({
      repoId,
      jobId: job.id,
      jobType,
      accountId: account.id,
      priority,
      reason,
      notBefore: options.notBefore ?? operationNotBefore,
      queuedAt: Date.now()
    });
    void this.drainQueue();
    this.notifySyncChanged(repoId);
    return Promise.resolve({ ...job, warningMessage });
  }

  enqueueWatchedRepos(jobType = "background_repo_sync"): Promise<SyncJob[]> {
    const options = jobType === "manual_repo_sync" ? { priority: syncPriority.manual, reason: "manual_refresh", bypassCooldown: true } : {};
    return Promise.all(
      this.database.localCache.repos.listWatchedReposForActiveAccount().map((repo) => this.enqueueRepoSync(repo.id, jobType, options))
    );
  }

  private updateActiveJob(
    activeJob: SyncJob,
    jobType: string,
    priority: number,
    reason: string | null,
    operationNotBefore: string | null,
    shouldDeferForOperation: boolean
  ): void {
    const isManualRefresh = jobType === "manual_repo_sync";
    if (priority > activeJob.priority || reason !== activeJob.reason || isManualRefresh) {
      this.database.localCache.syncJobs.updateSyncJob(activeJob.id, {
        priority: Math.max(priority, activeJob.priority),
        reason,
        notBefore: isManualRefresh ? null : (operationNotBefore ?? activeJob.notBefore),
        progressMessage: shouldDeferForOperation
          ? "Paused while a foreground operation is running"
          : `${syncReasonLabel(reason)}: waiting to sync`
      });
      const queued = this.queue.find((item) => item.jobId === activeJob.id);
      if (queued) {
        queued.priority = Math.max(priority, queued.priority);
        queued.reason = reason;
        if (isManualRefresh) {
          queued.jobType = jobType;
          queued.notBefore = null;
        } else if (operationNotBefore) {
          queued.notBefore = operationNotBefore;
        }
      } else if (activeJob.status === "queued" && activeJob.repoId) {
        this.requeueActiveJob(activeJob, {
          jobType: isManualRefresh ? jobType : activeJob.jobType,
          priority: Math.max(priority, activeJob.priority),
          reason,
          notBefore: isManualRefresh ? null : (operationNotBefore ?? activeJob.notBefore)
        });
      }
    } else if (operationNotBefore) {
      this.database.localCache.syncJobs.updateSyncJob(activeJob.id, {
        notBefore: operationNotBefore,
        progressMessage: "Paused while a foreground operation is running"
      });
      const queued = this.queue.find((item) => item.jobId === activeJob.id);
      if (queued) queued.notBefore = operationNotBefore;
      else if (activeJob.status === "queued" && activeJob.repoId) this.requeueActiveJob(activeJob, { notBefore: operationNotBefore });
    } else if (activeJob.status === "queued" && activeJob.repoId && !this.queue.some((item) => item.jobId === activeJob.id)) {
      this.requeueActiveJob(activeJob);
    }
  }

  private failBeforeQueue(
    repoId: string,
    job: SyncJob,
    accountId: string | null,
    reason: string | null,
    code: string,
    message: string
  ): void {
    this.database.localCache.repos.setRepoSyncState(repoId, "auth_error", message);
    this.database.localCache.repoAccounts.setRepoAccountSyncState(repoId, accountId, "auth_error", message);
    this.database.localCache.syncJobs.updateSyncJob(job.id, {
      status: "failed",
      errorCode: code,
      lastErrorCode: code,
      errorMessage: message,
      progressMessage: `${syncReasonLabel(reason)}: sync paused`,
      completedAt: nowIso(),
      ...this.runtime.rateLimitPatch()
    });
  }

  private async drainQueue(): Promise<void> {
    if (this.processing || this.runtime.isRateLimited()) return;

    this.processing = true;
    try {
      while (this.queue.length > 0 && !this.runtime.isRateLimited()) {
        const next = this.nextEligibleQueueItem();
        if (!next) break;
        if (this.isRateLimitLow() && next.jobType !== "manual_repo_sync") {
          this.deferQueueItem(next, this.github.getRateLimit()?.resetAt ?? null, "rate_limit_backoff");
          break;
        }
        this.database.localCache.syncJobs.updateSyncJob(next.jobId, {
          attemptCount: (this.database.localCache.syncJobs.getSyncJob(next.jobId)?.attemptCount ?? 0) + 1
        });
        const job = this.database.localCache.syncJobs.getSyncJob(next.jobId);
        const account = job?.accountId ? this.database.localCache.accounts.getGitHubAccountById(job.accountId) : null;
        const run = () => this.runtime.syncRepo(next.repoId, next.jobId);
        await (this.token ? this.token.withAccount(account, run) : run());
      }
    } finally {
      this.processing = false;
    }
  }

  private isRateLimitLow(): boolean {
    const rateLimit = this.github.getRateLimit();
    return rateLimit?.remaining != null && rateLimit.remaining <= lowRateLimitRemaining;
  }

  private nextEligibleQueueItem(): SyncQueueItem | null {
    const now = Date.now();
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const [index, item] of this.queue.entries()) {
      if (item.notBefore && Date.parse(item.notBefore) > now) continue;
      const ageMinutes = Math.max(0, (now - item.queuedAt) / 60_000);
      const score = item.priority + Math.min(ageMinutes, 30);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) return null;
    return this.queue.splice(bestIndex, 1)[0] ?? null;
  }

  private deferQueueItem(item: SyncQueueItem, notBefore: string | null, reason: string): void {
    const nextNotBefore = notBefore ?? new Date(Date.now() + 10 * 60_000).toISOString();
    item.notBefore = nextNotBefore;
    this.database.localCache.syncJobs.updateSyncJob(item.jobId, {
      notBefore: nextNotBefore,
      progressMessage: `${syncReasonLabel(item.reason)}: paused until ${new Date(nextNotBefore).toLocaleTimeString()}`
    });
    this.database.localCache.diagnostics.recordDiagnosticEvent({
      source: "sync",
      level: "info",
      code: reason,
      message: `${item.jobType} for ${item.repoId} paused until ${nextNotBefore}.`
    });
    this.queue.push(item);
    this.notifySyncChanged(item.repoId);
  }

  private requeueActiveJob(activeJob: SyncJob, patch: Partial<SyncQueueItem> = {}): SyncQueueItem | null {
    if (!activeJob.repoId) return null;
    const item: SyncQueueItem = {
      repoId: activeJob.repoId,
      jobId: activeJob.id,
      jobType: patch.jobType ?? activeJob.jobType,
      accountId: patch.accountId ?? activeJob.accountId,
      priority: patch.priority ?? activeJob.priority,
      reason: patch.reason ?? activeJob.reason,
      notBefore: patch.notBefore ?? activeJob.notBefore,
      queuedAt: Date.now()
    };
    this.queue.push(item);
    this.notifySyncChanged(activeJob.repoId);
    return item;
  }

  private notifySyncChanged(repoId: string | null): void {
    this.callbacks.onSyncChanged?.(repoId);
  }
}
