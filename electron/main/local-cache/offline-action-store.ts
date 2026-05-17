import type {
  CreateOfflineActionInput,
  OfflineAction,
  OfflineActionListInput,
  OfflineActionPayload,
  OfflineActionQueueSummary,
  OfflineActionStatus,
  UpdateOfflineActionInput
} from "../../../src/shared/domain/offline-action.js";
import { nowIso } from "../path-utils.js";
import { LocalCacheStoreBase } from "./store-base.js";

const activeStatuses: OfflineActionStatus[] = ["queued", "sending", "failed_retryable", "blocked"];

export class OfflineActionStore extends LocalCacheStoreBase {
  createOfflineAction(input: CreateOfflineActionInput): OfflineAction {
    const now = nowIso();
    const account = this.accounts.getGitHubAccount();
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO offline_actions (
           id, account_id, repo_id, action_type, entity_type, entity_number, title, body, payload_json, status,
           priority, attempt_count, next_attempt_at, last_attempt_at, upstream_last_seen_sha, upstream_last_seen_updated_at,
           created_at, updated_at, posted_at, last_error_code, last_error
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, 0, ?, NULL, ?, ?, ?, ?, NULL, ?, ?)`
      )
      .run(
        id,
        account?.id ?? null,
        input.repoId,
        input.actionType,
        input.entityType,
        input.entityNumber,
        input.title ?? null,
        input.body,
        JSON.stringify(input.payload),
        input.priority ?? 0,
        input.nextAttemptAt ?? now,
        input.upstreamLastSeenSha ?? null,
        input.upstreamLastSeenUpdatedAt ?? null,
        now,
        now,
        input.lastErrorCode ?? null,
        input.lastError ?? null
      );
    return this.getOfflineAction(id)!;
  }

  getOfflineAction(id: string): OfflineAction | null {
    const row = this.db
      .prepare(
        `SELECT a.*, r.full_name AS repo_full_name
         FROM offline_actions a
         LEFT JOIN repos r ON r.id = a.repo_id
         WHERE a.id = ?`
      )
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapOfflineAction(row) : null;
  }

  listOfflineActions(input: OfflineActionListInput = {}): OfflineAction[] {
    const account = this.accounts.getGitHubAccount();
    const params: unknown[] = [];
    const clauses = ["(a.account_id IS NULL OR a.account_id = ?)"];
    params.push(account?.id ?? "");
    if (!input.includeCompleted) clauses.push(`a.status IN (${activeStatuses.map(() => "?").join(", ")})`);
    if (!input.includeCompleted) params.push(...activeStatuses);
    if (input.repoId) {
      clauses.push("a.repo_id = ?");
      params.push(input.repoId);
    }
    if (input.entityType) {
      clauses.push("a.entity_type = ?");
      params.push(input.entityType);
    }
    if (input.entityNumber != null) {
      clauses.push("a.entity_number = ?");
      params.push(input.entityNumber);
    }
    const rows = this.db
      .prepare(
        `SELECT a.*, r.full_name AS repo_full_name
         FROM offline_actions a
         LEFT JOIN repos r ON r.id = a.repo_id
         WHERE ${clauses.join(" AND ")}
         ORDER BY
           CASE a.status WHEN 'blocked' THEN 0 WHEN 'sending' THEN 1 WHEN 'failed_retryable' THEN 2 WHEN 'queued' THEN 3 ELSE 4 END,
           a.priority DESC,
           a.created_at ASC`
      )
      .all(...params) as Record<string, unknown>[];
    return rows.map(mapOfflineAction);
  }

  offlineActionSummary(): OfflineActionQueueSummary {
    const account = this.accounts.getGitHubAccount();
    const rows = this.db
      .prepare(
        `SELECT status, COUNT(*) AS count, MIN(next_attempt_at) AS next_attempt_at
         FROM offline_actions
         WHERE account_id IS NULL OR account_id = ?
         GROUP BY status`
      )
      .all(account?.id ?? "") as Array<{ status: OfflineActionStatus; count: number; next_attempt_at: string | null }>;
    const summary: OfflineActionQueueSummary = {
      queued: 0,
      sending: 0,
      retryable: 0,
      blocked: 0,
      sent: 0,
      cancelled: 0,
      active: 0,
      nextAttemptAt: null
    };
    for (const row of rows) {
      if (row.status === "queued") summary.queued = row.count;
      if (row.status === "sending") summary.sending = row.count;
      if (row.status === "failed_retryable") summary.retryable = row.count;
      if (row.status === "blocked") summary.blocked = row.count;
      if (row.status === "sent") summary.sent = row.count;
      if (row.status === "cancelled") summary.cancelled = row.count;
      if (activeStatuses.includes(row.status)) {
        summary.active += row.count;
        if (row.next_attempt_at && (!summary.nextAttemptAt || row.next_attempt_at < summary.nextAttemptAt)) {
          summary.nextAttemptAt = row.next_attempt_at;
        }
      }
    }
    return summary;
  }

  updateOfflineAction(id: string, input: UpdateOfflineActionInput): OfflineAction {
    const current = this.getOfflineAction(id);
    if (!current) throw new Error("Queued action not found.");
    if (current.status === "sent" || current.status === "cancelled" || current.status === "sending") {
      throw new Error("This queued action cannot be edited in its current state.");
    }
    const nextBody = input.body ?? current.body;
    const nextPayload = input.payload ?? current.payload;
    this.db
      .prepare(
        `UPDATE offline_actions
         SET body = ?, payload_json = ?, title = ?, status = CASE WHEN status = 'blocked' THEN 'queued' ELSE status END,
             last_error = NULL, last_error_code = NULL, next_attempt_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(nextBody, JSON.stringify(nextPayload), input.title ?? current.title, nowIso(), nowIso(), id);
    return this.getOfflineAction(id)!;
  }

  cancelOfflineAction(id: string): OfflineAction {
    const current = this.getOfflineAction(id);
    if (!current) throw new Error("Queued action not found.");
    if (current.status === "sent") throw new Error("Sent actions cannot be cancelled.");
    this.db
      .prepare("UPDATE offline_actions SET status = 'cancelled', updated_at = ?, next_attempt_at = NULL WHERE id = ?")
      .run(nowIso(), id);
    return this.getOfflineAction(id)!;
  }

  markOfflineActionSending(id: string): OfflineAction | null {
    this.db
      .prepare(
        "UPDATE offline_actions SET status = 'sending', attempt_count = attempt_count + 1, last_attempt_at = ?, updated_at = ? WHERE id = ?"
      )
      .run(nowIso(), nowIso(), id);
    return this.getOfflineAction(id);
  }

  markOfflineActionSent(id: string): OfflineAction | null {
    this.db
      .prepare(
        "UPDATE offline_actions SET status = 'sent', posted_at = ?, next_attempt_at = NULL, last_error = NULL, last_error_code = NULL, updated_at = ? WHERE id = ?"
      )
      .run(nowIso(), nowIso(), id);
    return this.getOfflineAction(id);
  }

  markOfflineActionRetryable(id: string, errorCode: string, error: string, nextAttemptAt: string): OfflineAction | null {
    this.db
      .prepare(
        `UPDATE offline_actions
         SET status = 'failed_retryable', last_error_code = ?, last_error = ?, next_attempt_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(errorCode, error, nextAttemptAt, nowIso(), id);
    return this.getOfflineAction(id);
  }

  markOfflineActionBlocked(id: string, errorCode: string, error: string): OfflineAction | null {
    this.db
      .prepare(
        `UPDATE offline_actions
         SET status = 'blocked', last_error_code = ?, last_error = ?, next_attempt_at = NULL, updated_at = ?
         WHERE id = ?`
      )
      .run(errorCode, error, nowIso(), id);
    return this.getOfflineAction(id);
  }

  dueOfflineActions(now = nowIso(), limit = 25): OfflineAction[] {
    const account = this.accounts.getGitHubAccount();
    const rows = this.db
      .prepare(
        `SELECT a.*, r.full_name AS repo_full_name
         FROM offline_actions a
         LEFT JOIN repos r ON r.id = a.repo_id
         WHERE (a.account_id IS NULL OR a.account_id = ?)
           AND a.status IN ('queued', 'failed_retryable')
           AND (a.next_attempt_at IS NULL OR a.next_attempt_at <= ?)
         ORDER BY a.priority DESC, a.next_attempt_at ASC, a.created_at ASC
         LIMIT ?`
      )
      .all(account?.id ?? "", now, limit) as Record<string, unknown>[];
    return rows.map(mapOfflineAction);
  }

  recoverInterruptedOfflineActions(): number {
    const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
    const result = this.db
      .prepare(
        `UPDATE offline_actions
         SET status = 'failed_retryable',
             last_error_code = COALESCE(last_error_code, 'interrupted'),
             last_error = COALESCE(last_error, 'Fallback stopped while this action was sending.'),
             next_attempt_at = ?,
             updated_at = ?
         WHERE status = 'sending' AND (last_attempt_at IS NULL OR last_attempt_at <= ?)`
      )
      .run(nowIso(), nowIso(), cutoff);
    return Number(result.changes);
  }

  pruneCompletedOfflineActions(): void {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
    this.db
      .prepare(
        `DELETE FROM offline_actions
         WHERE status IN ('sent', 'cancelled')
           AND updated_at < ?
           AND id NOT IN (
             SELECT id FROM offline_actions
             WHERE status IN ('sent', 'cancelled')
             ORDER BY updated_at DESC
             LIMIT 100
           )`
      )
      .run(cutoff);
  }
}

function mapOfflineAction(row: Record<string, unknown>): OfflineAction {
  return {
    id: String(row.id),
    accountId: nullableString(row.account_id),
    repoId: String(row.repo_id),
    repoFullName: nullableString(row.repo_full_name),
    actionType: offlineActionType(row.action_type),
    entityType: row.entity_type === "pull_request" ? "pull_request" : "issue",
    entityNumber: Number(row.entity_number),
    title: nullableString(row.title),
    body: String(row.body ?? ""),
    payload: offlineActionPayload(row.payload_json, offlineActionType(row.action_type), String(row.body ?? "")),
    status: offlineActionStatus(row.status),
    priority: Number(row.priority ?? 0),
    attemptCount: Number(row.attempt_count ?? 0),
    nextAttemptAt: nullableString(row.next_attempt_at),
    lastAttemptAt: nullableString(row.last_attempt_at),
    postedAt: nullableString(row.posted_at),
    lastErrorCode: nullableString(row.last_error_code),
    lastError: nullableString(row.last_error),
    upstreamLastSeenSha: nullableString(row.upstream_last_seen_sha),
    upstreamLastSeenUpdatedAt: nullableString(row.upstream_last_seen_updated_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function offlineActionType(value: unknown): OfflineAction["actionType"] {
  return value === "pr_comment" || value === "pr_review" ? value : "issue_comment";
}

function offlineActionStatus(value: unknown): OfflineActionStatus {
  if (
    value === "queued" ||
    value === "sending" ||
    value === "failed_retryable" ||
    value === "blocked" ||
    value === "sent" ||
    value === "cancelled"
  ) {
    return value;
  }
  return "queued";
}

function offlineActionPayload(value: unknown, actionType: OfflineAction["actionType"], body: string): OfflineActionPayload {
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as OfflineActionPayload;
      if (parsed && typeof parsed === "object" && parsed.actionType === actionType) return parsed;
    } catch {
      // Fall through to a conservative payload.
    }
  }
  if (actionType === "pr_review") return { actionType, event: "COMMENT", body, comments: [], headSha: null };
  return { actionType, body };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
