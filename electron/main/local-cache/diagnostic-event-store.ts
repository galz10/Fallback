import { nowIso } from "../path-utils.js";
import type { OperationRecoveryDiagnosticRecord } from "./operation-record-store.js";
import { LocalCacheStoreBase } from "./store-base.js";
import { nullableString, type DiagnosticEventInput } from "./store-helpers.js";

export class DiagnosticEventStore extends LocalCacheStoreBase {
  operationRecoveryDiagnostics(limit = 25): OperationRecoveryDiagnosticRecord[] {
    return this.operationRecords.recoveryDiagnostics(limit);
  }

  healthDiagnostics(): Array<{ surface: string; status: string; errorCode: string | null; count: number }> {
    return this.diagnosticRows(
      `SELECT surface, status, error_code, COUNT(*) AS count
       FROM health_probes
       GROUP BY surface, status, error_code
       ORDER BY status, surface, error_code`,
      (row: Record<string, unknown>) => ({
        surface: String(row.surface),
        status: String(row.status),
        errorCode: nullableString(row.error_code),
        count: Number(row.count)
      })
    );
  }

  recordDiagnosticEvent(input: DiagnosticEventInput): void {
    this.db
      .prepare(
        `INSERT INTO diagnostic_events (id, source, level, code, message, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(crypto.randomUUID(), input.source, input.level, input.code, input.message ?? null, nowIso());
  }

  diagnosticEvents(): Array<{ source: string; level: string; code: string; count: number; latestAt: string }> {
    return this.diagnosticRows(
      `SELECT source, level, code, COUNT(*) AS count, MAX(created_at) AS latest_at
       FROM diagnostic_events
       GROUP BY source, level, code
       ORDER BY latest_at DESC`,
      (row: Record<string, unknown>) => ({
        source: String(row.source),
        level: String(row.level),
        code: String(row.code),
        count: Number(row.count),
        latestAt: String(row.latest_at)
      })
    );
  }

  credentialDiagnosticEvents(limit = 20): Array<{ level: string; code: string; message: string | null; createdAt: string }> {
    return (
      this.db
        .prepare(
          `SELECT level, code, message, created_at
           FROM diagnostic_events
           WHERE source = 'credential_diagnostics'
           ORDER BY created_at DESC
           LIMIT ?`
        )
        .all(limit) as Record<string, unknown>[]
    ).map((row) => ({
      level: String(row.level),
      code: String(row.code),
      message: nullableString(row.message),
      createdAt: String(row.created_at)
    }));
  }
}
