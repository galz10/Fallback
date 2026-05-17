import type { DatabaseService } from "../database-service.js";
import { errorCode as classifyErrorCode, errorMessage } from "../error-classification.js";
import { nowIso } from "../path-utils.js";
import { syncReasonLabel } from "../../../src/shared/sync-policy.js";
import type { SyncJob } from "../../../src/shared/domain/sync.js";

export interface SyncJobRecorderDependencies {
  database: DatabaseService;
  rateLimitPatch(): Pick<SyncJob, "githubRateLimitRemaining" | "githubRateLimitResetAt">;
  updateAccountAuthFailure(error: unknown): void;
  notifySyncChanged(repoId: string | null): void;
}

export class SyncJobRecorder {
  constructor(private readonly dependencies: SyncJobRecorderDependencies) {}

  updateProgress(jobId: string, progressMessage: string): void {
    this.dependencies.database.localCache.syncJobs.updateSyncJob(jobId, { progressMessage });
    this.dependencies.notifySyncChanged(this.dependencies.database.localCache.syncJobs.getSyncJob(jobId)?.repoId ?? null);
  }

  failSyncJob(jobId: string, error: unknown, message = errorMessage(error)): void {
    this.dependencies.updateAccountAuthFailure(error);
    const current = this.dependencies.database.localCache.syncJobs.getSyncJob(jobId);
    const code = classifyErrorCode(error, "sync_failed");
    this.dependencies.database.localCache.syncJobs.updateSyncJob(jobId, {
      status: "failed",
      errorCode: code,
      lastErrorCode: code,
      errorMessage: message,
      progressMessage: `${syncReasonLabel(current?.reason)}: sync failed`,
      completedAt: nowIso(),
      ...this.dependencies.rateLimitPatch()
    });
    this.dependencies.notifySyncChanged(current?.repoId ?? null);
  }
}
