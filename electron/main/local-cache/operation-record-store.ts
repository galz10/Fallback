import type Database from "better-sqlite3";
import type { OperationRecord, OperationRiskLevel, OperationStatus } from "../../../src/shared/domain/operation.js";
import { nowIso } from "../path-utils.js";

type SqliteDatabase = ReturnType<typeof Database>;

export interface OperationRecordInput {
  repoId?: string | null;
  workspaceId?: string | null;
  workspacePath?: string | null;
  workspaceBranch?: string | null;
  kind: string;
  status?: OperationStatus;
  riskLevel?: OperationRiskLevel;
  commandSummary?: string | null;
  redactedCommand?: string | null;
  recoveryHeadSha?: string | null;
  recoveryBranch?: string | null;
  recoveryIsDirty?: boolean | null;
  recoveryFileCount?: number | null;
  recoveryStashRefs?: string[];
  recoveryHint?: string | null;
  recoveryReflogHint?: string | null;
  recoveryRef?: string | null;
  resultSummary?: string | null;
  resultStashRefs?: string[];
}

export class OperationRecordStore {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: OperationRecordInput): OperationRecord {
    const id = crypto.randomUUID();
    const timestamp = nowIso();
    this.db
      .prepare(
        `INSERT INTO operations (
           id, repo_id, workspace_id, workspace_path, workspace_branch, kind, status, risk_level, command_summary, redacted_command,
           recovery_head_sha, recovery_branch, recovery_is_dirty, recovery_file_count,
           recovery_stash_refs, recovery_hint, recovery_reflog_hint, recovery_ref, result_summary, result_stash_refs,
           created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.repoId ?? null,
        input.workspaceId ?? null,
        input.workspacePath ?? null,
        input.workspaceBranch ?? null,
        input.kind,
        input.status ?? "queued",
        input.riskLevel ?? "normal",
        input.commandSummary ?? null,
        input.redactedCommand ?? null,
        input.recoveryHeadSha ?? null,
        input.recoveryBranch ?? null,
        nullableBooleanNumber(input.recoveryIsDirty),
        input.recoveryFileCount ?? null,
        JSON.stringify(input.recoveryStashRefs ?? []),
        input.recoveryHint ?? null,
        input.recoveryReflogHint ?? null,
        input.recoveryRef ?? null,
        input.resultSummary ?? null,
        JSON.stringify(input.resultStashRefs ?? []),
        timestamp,
        timestamp
      );
    return this.get(id)!;
  }

  update(id: string, patch: Partial<OperationRecord>): OperationRecord | null {
    const current = this.get(id);
    if (!current) return null;
    const hasPatch = (key: keyof OperationRecord) => Object.prototype.hasOwnProperty.call(patch, key);
    this.db
      .prepare(
        `UPDATE operations
         SET status = ?,
             risk_level = ?,
             command_summary = ?,
             redacted_command = ?,
             recovery_head_sha = ?,
             recovery_branch = ?,
             recovery_is_dirty = ?,
             recovery_file_count = ?,
             recovery_stash_refs = ?,
             recovery_hint = ?,
             recovery_reflog_hint = ?,
             recovery_ref = ?,
             result_summary = ?,
             result_stash_refs = ?,
             started_at = ?,
             completed_at = ?,
             duration_ms = ?,
             error_code = ?,
             error_message = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        hasPatch("status") ? patch.status : current.status,
        hasPatch("riskLevel") ? patch.riskLevel : current.riskLevel,
        hasPatch("commandSummary") ? patch.commandSummary : current.commandSummary,
        hasPatch("redactedCommand") ? patch.redactedCommand : current.redactedCommand,
        hasPatch("recoveryHeadSha") ? patch.recoveryHeadSha : current.recoveryHeadSha,
        hasPatch("recoveryBranch") ? patch.recoveryBranch : current.recoveryBranch,
        hasPatch("recoveryIsDirty") ? nullableBooleanNumber(patch.recoveryIsDirty) : nullableBooleanNumber(current.recoveryIsDirty),
        hasPatch("recoveryFileCount") ? patch.recoveryFileCount : current.recoveryFileCount,
        hasPatch("recoveryStashRefs") ? JSON.stringify(patch.recoveryStashRefs ?? []) : JSON.stringify(current.recoveryStashRefs),
        hasPatch("recoveryHint") ? patch.recoveryHint : current.recoveryHint,
        hasPatch("recoveryReflogHint") ? patch.recoveryReflogHint : current.recoveryReflogHint,
        hasPatch("recoveryRef") ? patch.recoveryRef : current.recoveryRef,
        hasPatch("resultSummary") ? patch.resultSummary : current.resultSummary,
        hasPatch("resultStashRefs") ? JSON.stringify(patch.resultStashRefs ?? []) : JSON.stringify(current.resultStashRefs),
        hasPatch("startedAt") ? patch.startedAt : current.startedAt,
        hasPatch("completedAt") ? patch.completedAt : current.completedAt,
        hasPatch("durationMs") ? patch.durationMs : current.durationMs,
        hasPatch("errorCode") ? patch.errorCode : current.errorCode,
        hasPatch("errorMessage") ? patch.errorMessage : current.errorMessage,
        nowIso(),
        id
      );
    return this.get(id);
  }

  get(id: string): OperationRecord | null {
    const row = this.db
      .prepare(
        `SELECT o.*, r.full_name AS repo_full_name
         FROM operations o
         LEFT JOIN repos r ON r.id = o.repo_id
         WHERE o.id = ?`
      )
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapOperation(row) : null;
  }

  listRecent(repoId?: string): OperationRecord[] {
    const sql = `SELECT o.*, r.full_name AS repo_full_name
       FROM operations o
       LEFT JOIN repos r ON r.id = o.repo_id
       ${repoId ? "WHERE o.repo_id = ?" : ""}
       ORDER BY o.created_at DESC, o.rowid DESC
       LIMIT 25`;
    const rows = (repoId ? this.db.prepare(sql).all(repoId) : this.db.prepare(sql).all()) as Record<string, unknown>[];
    return rows.map(mapOperation);
  }

  active(repoId: string): OperationRecord | null {
    const row = this.db
      .prepare(
        `SELECT o.*, r.full_name AS repo_full_name
         FROM operations o
         LEFT JOIN repos r ON r.id = o.repo_id
         WHERE o.repo_id = ? AND o.status IN ('queued', 'preflight', 'running')
         ORDER BY o.created_at ASC, o.rowid ASC
         LIMIT 1`
      )
      .get(repoId) as Record<string, unknown> | undefined;
    return row ? mapOperation(row) : null;
  }

  recoveryDiagnostics(limit = 25): OperationRecoveryDiagnosticRecord[] {
    const rows = this.db
      .prepare(
        `SELECT o.*, r.full_name AS repo_full_name
         FROM operations o
         LEFT JOIN repos r ON r.id = o.repo_id
         WHERE o.recovery_head_sha IS NOT NULL
            OR o.recovery_branch IS NOT NULL
            OR o.recovery_ref IS NOT NULL
            OR o.recovery_reflog_hint IS NOT NULL
         ORDER BY o.created_at DESC, o.rowid DESC
         LIMIT ?`
      )
      .all(limit) as Record<string, unknown>[];
    return rows.map((row) => {
      const operation = mapOperation(row);
      return {
        repoId: operation.repoId,
        repoFullName: operation.repoFullName,
        workspaceId: operation.workspaceId,
        workspacePath: operation.workspacePath,
        workspaceBranch: operation.workspaceBranch,
        kind: operation.kind,
        status: operation.status,
        commandSummary: operation.commandSummary,
        redactedCommand: operation.redactedCommand,
        recoveryHeadSha: operation.recoveryHeadSha,
        recoveryBranch: operation.recoveryBranch,
        recoveryIsDirty: operation.recoveryIsDirty,
        recoveryFileCount: operation.recoveryFileCount,
        recoveryStashRefs: operation.recoveryStashRefs,
        recoveryHint: operation.recoveryHint,
        recoveryReflogHint: operation.recoveryReflogHint,
        recoveryRef: operation.recoveryRef,
        createdAt: operation.createdAt
      };
    });
  }
}

export interface OperationRecoveryDiagnosticRecord {
  repoId: string | null;
  repoFullName: string | null;
  workspaceId: string | null;
  workspacePath: string | null;
  workspaceBranch: string | null;
  kind: string;
  status: string;
  commandSummary: string | null;
  redactedCommand: string | null;
  recoveryHeadSha: string | null;
  recoveryBranch: string | null;
  recoveryIsDirty: boolean | null;
  recoveryFileCount: number | null;
  recoveryStashRefs: string[];
  recoveryHint: string | null;
  recoveryReflogHint: string | null;
  recoveryRef: string | null;
  createdAt: string;
}

function mapOperation(row: Record<string, unknown>): OperationRecord {
  return {
    id: String(row.id),
    repoId: nullableString(row.repo_id),
    repoFullName: nullableString(row.repo_full_name),
    workspaceId: nullableString(row.workspace_id),
    workspacePath: nullableString(row.workspace_path),
    workspaceBranch: nullableString(row.workspace_branch),
    kind: String(row.kind),
    status: operationStatus(row.status),
    riskLevel: operationRiskLevel(row.risk_level),
    commandSummary: nullableString(row.command_summary),
    redactedCommand: nullableString(row.redacted_command),
    recoveryHeadSha: nullableString(row.recovery_head_sha),
    recoveryBranch: nullableString(row.recovery_branch),
    recoveryIsDirty: row.recovery_is_dirty == null ? null : Boolean(row.recovery_is_dirty),
    recoveryFileCount: nullableNumber(row.recovery_file_count),
    recoveryStashRefs: parseStringArray(row.recovery_stash_refs),
    recoveryHint: nullableString(row.recovery_hint),
    recoveryReflogHint: nullableString(row.recovery_reflog_hint),
    recoveryRef: nullableString(row.recovery_ref),
    resultSummary: nullableString(row.result_summary),
    resultStashRefs: parseStringArray(row.result_stash_refs),
    startedAt: nullableString(row.started_at),
    completedAt: nullableString(row.completed_at),
    durationMs: nullableNumber(row.duration_ms),
    errorCode: nullableString(row.error_code),
    errorMessage: nullableString(row.error_message),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function nullableBooleanNumber(value: boolean | null | undefined): number | null {
  return value == null ? null : value ? 1 : 0;
}

function operationStatus(value: unknown): OperationStatus {
  const status = nullableString(value);
  if (
    status === "queued" ||
    status === "preflight" ||
    status === "running" ||
    status === "succeeded" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "blocked"
  ) {
    return status;
  }
  return "failed";
}

function operationRiskLevel(value: unknown): OperationRiskLevel {
  const risk = nullableString(value);
  if (risk === "low" || risk === "normal" || risk === "destructive") return risk;
  return "normal";
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
