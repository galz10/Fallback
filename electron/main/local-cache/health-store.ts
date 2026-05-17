import type { HealthMatrixRow, HealthProbeResult } from "../../../src/shared/domain/health.js";
import type { WatchedRepo } from "../../../src/shared/domain/watched-repo.js";
import { LocalCacheStoreBase } from "./store-base.js";
import { mapHealthProbe, matrixRow } from "./store-helpers.js";

export class HealthStore extends LocalCacheStoreBase {
  recordHealthProbes(probes: HealthProbeResult[]): void {
    const statement = this.db.prepare(
      `INSERT INTO health_probes (id, repo_id, surface, status, latency_ms, http_status, error_code, error_message, checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    this.db.transaction(() => {
      for (const probe of probes) {
        statement.run(
          crypto.randomUUID(),
          probe.repoId ?? null,
          probe.surface,
          probe.status,
          probe.latencyMs,
          probe.httpStatus,
          probe.errorCode ?? null,
          probe.errorMessage,
          probe.checkedAt
        );
      }
    })();
  }

  latestHealthProbes(): HealthProbeResult[] {
    return (
      this.db
        .prepare(
          `SELECT h.*, r.full_name AS repo_full_name
             FROM health_probes h
             LEFT JOIN repos r ON r.id = h.repo_id
             JOIN (
               SELECT COALESCE(repo_id, '') AS repo_key, surface, MAX(checked_at) AS checked_at
               FROM health_probes
               GROUP BY COALESCE(repo_id, ''), surface
             ) latest
               ON COALESCE(h.repo_id, '') = latest.repo_key
              AND h.surface = latest.surface
              AND h.checked_at = latest.checked_at
             ORDER BY h.repo_id IS NOT NULL, r.full_name, h.surface`
        )
        .all() as Record<string, unknown>[]
    ).map(mapHealthProbe);
  }

  healthProbesSince(since: string): HealthProbeResult[] {
    return (
      this.db
        .prepare(
          `SELECT h.*, r.full_name AS repo_full_name
             FROM health_probes h
             LEFT JOIN repos r ON r.id = h.repo_id
             WHERE h.checked_at >= ?
             ORDER BY h.checked_at ASC, h.surface ASC`
        )
        .all(since) as Record<string, unknown>[]
    ).map(mapHealthProbe);
  }

  healthMatrix(): HealthMatrixRow[] {
    const probes = this.latestHealthProbes();
    const global = matrixRow(
      null,
      "GitHub",
      probes.filter((probe) => !probe.repoId)
    );
    const repos = this.listWatchedReposForActiveAccount() as WatchedRepo[];
    return [
      global,
      ...repos.map((repo) =>
        matrixRow(
          repo.id,
          repo.fullName,
          probes.filter((probe) => probe.repoId === repo.id)
        )
      )
    ];
  }
}
