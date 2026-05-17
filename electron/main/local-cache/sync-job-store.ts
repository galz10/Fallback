import type { SyncJob } from "../../../src/shared/domain/sync.js";
import { nowIso } from "../path-utils.js";
import { LocalCacheStoreBase } from "./store-base.js";
import { mapSyncJob, nullableNumber, nullableString } from "./store-helpers.js";
import type { SyncJobInput } from "./store-types.js";

export class SyncJobStore extends LocalCacheStoreBase {
  createSyncJob(repoId: string | null, jobType: string, input: SyncJobInput = {}): SyncJob {
    const id = crypto.randomUUID();
    const createdAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO sync_jobs (
           id, repo_id, account_id, provider, job_type, status, priority, reason, not_before, dedupe_key, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        repoId,
        input.accountId ?? this.getGitHubAccount()?.id ?? null,
        input.provider ?? "github.com",
        jobType,
        input.priority ?? 0,
        input.reason ?? null,
        input.notBefore ?? null,
        input.dedupeKey ?? null,
        createdAt,
        createdAt
      );
    return this.getSyncJob(id)!;
  }

  failInterruptedSyncJobs(): void {
    const timestamp = nowIso();
    this.db
      .prepare(
        `UPDATE sync_jobs
         SET status = 'failed',
             error_message = 'Sync interrupted before completion.',
             completed_at = ?,
             updated_at = ?
         WHERE status IN ('queued', 'running')`
      )
      .run(timestamp, timestamp);
    this.db
      .prepare(
        `UPDATE repos
         SET sync_status = 'stale',
             sync_error = 'Previous sync was interrupted.',
             updated_at = ?
         WHERE sync_status IN ('queued', 'syncing')`
      )
      .run(timestamp);
  }

  updateSyncJob(
    id: string,
    patch: Partial<
      Pick<
        SyncJob,
        | "status"
        | "priority"
        | "reason"
        | "notBefore"
        | "attemptCount"
        | "lastErrorCode"
        | "dedupeKey"
        | "errorCode"
        | "errorMessage"
        | "progressMessage"
        | "startedAt"
        | "completedAt"
        | "githubRateLimitRemaining"
        | "githubRateLimitResetAt"
      >
    >
  ): void {
    const current = this.getSyncJob(id);
    if (!current) {
      return;
    }
    const hasPatch = (key: keyof typeof patch) => Object.prototype.hasOwnProperty.call(patch, key);
    this.db
      .prepare(
        `UPDATE sync_jobs
         SET status = ?,
             priority = ?,
             reason = ?,
             not_before = ?,
             attempt_count = ?,
             last_error_code = ?,
             dedupe_key = ?,
             error_code = ?,
             error_message = ?,
             started_at = ?,
             completed_at = ?,
             github_rate_limit_remaining = ?,
             github_rate_limit_reset_at = ?,
             progress_message = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        hasPatch("status") ? patch.status : current.status,
        hasPatch("priority") ? patch.priority : current.priority,
        hasPatch("reason") ? patch.reason : current.reason,
        hasPatch("notBefore") ? patch.notBefore : current.notBefore,
        hasPatch("attemptCount") ? patch.attemptCount : current.attemptCount,
        hasPatch("lastErrorCode") ? patch.lastErrorCode : current.lastErrorCode,
        hasPatch("dedupeKey") ? patch.dedupeKey : current.dedupeKey,
        hasPatch("errorCode") ? patch.errorCode : current.errorCode,
        hasPatch("errorMessage") ? patch.errorMessage : current.errorMessage,
        hasPatch("startedAt") ? patch.startedAt : current.startedAt,
        hasPatch("completedAt") ? patch.completedAt : current.completedAt,
        hasPatch("githubRateLimitRemaining") ? patch.githubRateLimitRemaining : current.githubRateLimitRemaining,
        hasPatch("githubRateLimitResetAt") ? patch.githubRateLimitResetAt : current.githubRateLimitResetAt,
        hasPatch("progressMessage") ? patch.progressMessage : current.progressMessage,
        nowIso(),
        id
      );
  }

  getSyncJob(id: string): SyncJob | null {
    const row = this.db.prepare("SELECT * FROM sync_jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    return {
      id: String(row.id),
      repoId: row.repo_id ? String(row.repo_id) : null,
      accountId: nullableString(row.account_id),
      provider: nullableString(row.provider),
      jobType: String(row.job_type),
      status: String(row.status),
      priority: Number(row.priority ?? 0),
      reason: nullableString(row.reason),
      notBefore: nullableString(row.not_before),
      attemptCount: Number(row.attempt_count ?? 0),
      lastErrorCode: nullableString(row.last_error_code),
      dedupeKey: nullableString(row.dedupe_key),
      errorCode: nullableString(row.error_code),
      errorMessage: row.error_message ? String(row.error_message) : null,
      progressMessage: nullableString(row.progress_message),
      startedAt: row.started_at ? String(row.started_at) : null,
      completedAt: row.completed_at ? String(row.completed_at) : null,
      githubRateLimitRemaining: row.github_rate_limit_remaining == null ? null : Number(row.github_rate_limit_remaining),
      githubRateLimitResetAt: row.github_rate_limit_reset_at ? String(row.github_rate_limit_reset_at) : null
    };
  }

  activeSyncJob(repoId: string): SyncJob | null {
    const row = this.db
      .prepare(
        `SELECT * FROM sync_jobs
         WHERE repo_id = ? AND status IN ('queued', 'running')
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .get(repoId) as Record<string, unknown> | undefined;
    return row ? mapSyncJob(row) : null;
  }

  activeSyncJobByDedupeKey(dedupeKey: string): SyncJob | null {
    const row = this.db
      .prepare(
        `SELECT * FROM sync_jobs
         WHERE dedupe_key = ? AND status IN ('queued', 'running')
         ORDER BY priority DESC, created_at ASC
         LIMIT 1`
      )
      .get(dedupeKey) as Record<string, unknown> | undefined;
    return row ? mapSyncJob(row) : null;
  }

  latestRateLimit(): { remaining: number | null; resetAt: string | null } | null {
    const row = this.db
      .prepare(
        `SELECT github_rate_limit_remaining, github_rate_limit_reset_at
         FROM sync_jobs
         WHERE github_rate_limit_remaining IS NOT NULL OR github_rate_limit_reset_at IS NOT NULL
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get() as Record<string, unknown> | undefined;
    return row
      ? {
          remaining: nullableNumber(row.github_rate_limit_remaining),
          resetAt: nullableString(row.github_rate_limit_reset_at)
        }
      : null;
  }

  syncJobDiagnostics(): Array<{ jobType: string; status: string; reason: string | null; errorCode: string | null; count: number }> {
    return this.diagnosticRows(
      `SELECT job_type, status, reason, error_code, COUNT(*) AS count
       FROM sync_jobs
       GROUP BY job_type, status, reason, error_code
       ORDER BY status, reason, job_type, error_code`,
      (row: Record<string, unknown>) => ({
        jobType: String(row.job_type),
        status: String(row.status),
        reason: nullableString(row.reason),
        errorCode: nullableString(row.error_code),
        count: Number(row.count)
      })
    );
  }
}
