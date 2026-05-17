import fs from "node:fs";
import type { AttentionSummary } from "../../../src/shared/attention.js";
import type { CacheSummary } from "../../../src/shared/domain/cache.js";
import type { HealthHistory } from "../../../src/shared/domain/health.js";
import { nowIso } from "../path-utils.js";
import { LocalCacheStoreBase } from "./store-base.js";
import { directorySize, logDbTiming, nullableString, repoTables, type CacheSummaryCounters } from "./store-helpers.js";

export class CacheSummaryStore extends LocalCacheStoreBase {
  pruneClosedIssuesOlderThanAge(
    retentionDays = 365,
    options: { repoId?: string | null } = {}
  ): {
    issues: number;
    comments: number;
    labels: number;
    userRelations: number;
    searchRows: number;
    attentionStates: number;
    notificationEvents: number;
  } {
    if (retentionDays <= 0) return emptyClosedIssuePruneResult();
    return this.pruneClosedIssuesOlderThan(closedIssueRetentionCutoffIso(retentionDays), options);
  }

  pruneClosedIssuesOlderThan(
    cutoffIso = closedIssueRetentionCutoffIso(),
    options: { repoId?: string | null } = {}
  ): {
    issues: number;
    comments: number;
    labels: number;
    userRelations: number;
    searchRows: number;
    attentionStates: number;
    notificationEvents: number;
  } {
    const repoClause = options.repoId ? "AND repo_id = ?" : "";
    const repoArgs = options.repoId ? [options.repoId] : [];
    return this.db.transaction(() => {
      this.db
        .prepare(
          "CREATE TEMP TABLE IF NOT EXISTS closed_issue_prune_targets (repo_id TEXT NOT NULL, number INTEGER NOT NULL, PRIMARY KEY (repo_id, number))"
        )
        .run();
      this.db.prepare("DELETE FROM closed_issue_prune_targets").run();
      this.db
        .prepare(
          `INSERT INTO closed_issue_prune_targets (repo_id, number)
           SELECT repo_id, number
           FROM issues
           WHERE is_pull_request = 0
             AND state = 'closed'
             AND closed_at IS NOT NULL
             AND closed_at < ?
             ${repoClause}`
        )
        .run(cutoffIso, ...repoArgs);

      const labels = this.deleteTargetRows(
        `DELETE FROM entity_labels
         WHERE entity_type = 'issue'
           AND EXISTS (
             SELECT 1 FROM closed_issue_prune_targets targets
             WHERE targets.repo_id = entity_labels.repo_id
               AND targets.number = entity_labels.entity_number
           )`
      );
      const userRelations = this.deleteTargetRows(
        `DELETE FROM user_issues
         WHERE EXISTS (
           SELECT 1 FROM closed_issue_prune_targets targets
           WHERE targets.repo_id = user_issues.repo_id
             AND targets.number = user_issues.issue_number
         )`
      );
      const comments = this.deleteTargetRows(
        `DELETE FROM comments
         WHERE entity_type = 'issue'
           AND EXISTS (
             SELECT 1 FROM closed_issue_prune_targets targets
             WHERE targets.repo_id = comments.repo_id
               AND targets.number = comments.entity_number
           )`
      );
      const searchRows = this.deleteTargetRows(
        `DELETE FROM search_index
         WHERE entity_type IN ('issue', 'comment')
           AND EXISTS (
             SELECT 1 FROM closed_issue_prune_targets targets
             WHERE targets.repo_id = search_index.repo_id
               AND targets.number = search_index.entity_number
           )`
      );
      const attentionStates = this.deleteTargetRows(
        `DELETE FROM attention_states
         WHERE entity_type = 'issue'
           AND EXISTS (
             SELECT 1 FROM closed_issue_prune_targets targets
             WHERE targets.repo_id = attention_states.repo_id
               AND targets.number = attention_states.entity_number
           )`
      );
      const notificationEvents = this.deleteTargetRows(
        `DELETE FROM notification_events
         WHERE entity_type = 'issue'
           AND EXISTS (
             SELECT 1 FROM closed_issue_prune_targets targets
             WHERE targets.repo_id = notification_events.repo_id
               AND targets.number = notification_events.entity_number
           )`
      );
      const issues = this.deleteTargetRows(
        `DELETE FROM issues
         WHERE EXISTS (
           SELECT 1 FROM closed_issue_prune_targets targets
           WHERE targets.repo_id = issues.repo_id
             AND targets.number = issues.number
         )`
      );
      this.db.prepare("DELETE FROM closed_issue_prune_targets").run();
      return { issues, comments, labels, userRelations, searchRows, attentionStates, notificationEvents };
    })();
  }

  deleteRepoCache(repoId: string): void {
    this.db.transaction(() => {
      this.deleteRows(repoTables, repoId);
      this.db.prepare("DELETE FROM search_index WHERE repo_id = ?").run(repoId);
      this.db.prepare("DELETE FROM repos WHERE id = ?").run(repoId);
    })();
  }

  deleteAllCache(): void {
    this.db.transaction(() => {
      this.deleteRows(repoTables);
      this.db.prepare("DELETE FROM search_index").run();
      this.db.prepare("DELETE FROM operations").run();
      this.db.prepare("DELETE FROM repo_identities").run();
      this.db.prepare("DELETE FROM repos").run();
      this.db.prepare("DELETE FROM repo_accounts").run();
      this.db.prepare("DELETE FROM diagnostic_events").run();
    })();
  }

  cacheSummary(workspacePath: string, databasePath: string, options: { includeLocalBytes?: boolean } = {}): CacheSummary {
    const startedAt = performance.now();
    const databaseBytes = fs.existsSync(databasePath) ? fs.statSync(databasePath).size : 0;
    const repoRows = this.repoCacheRowsFast();
    const counters = this.cacheSummaryCountersFast();
    const totalRows = repoRows.reduce((sum, repo) => sum + repo.rows, 0);
    const includeLocalBytes = options.includeLocalBytes === true;
    const localSizeDeadline = includeLocalBytes ? Date.now() + 150 : 0;
    const repos = repoRows.map((repo) => {
      const localBytes = includeLocalBytes ? directorySize(repo.localPath, localSizeDeadline) : 0;
      const databaseEstimate = totalRows ? Math.round((databaseBytes * repo.rows) / totalRows) : 0;
      return {
        ...repo,
        localBytes,
        estimatedBytes: databaseEstimate + localBytes
      };
    });
    const estimatedRepoBytes = repos.reduce((sum, repo) => sum + repo.estimatedBytes, 0);
    const allocatedDatabaseBytes = repos.reduce((sum, repo) => sum + Math.max(0, repo.estimatedBytes - repo.localBytes), 0);
    const sharedDatabaseBytes = Math.max(0, databaseBytes - allocatedDatabaseBytes);
    const value = {
      workspacePath,
      databasePath,
      totalBytes: estimatedRepoBytes + sharedDatabaseBytes,
      databaseBytes,
      watchedRepos: counters.watchedRepos,
      pullRequests: counters.pullRequests,
      issues: counters.issues,
      comments: counters.comments,
      reviews: counters.reviews,
      checkRuns: counters.checkRuns,
      commitStatuses: counters.commitStatuses,
      searchRows: counters.searchRows,
      repos
    };
    logDbTiming("cache:summary", performance.now() - startedAt, { repos: repos.length, includeLocalBytes: includeLocalBytes ? 1 : 0 });
    return value;
  }

  cacheSummarySnapshot(workspacePath: string, databasePath: string): CacheSummary | null {
    const row = this.db.prepare("SELECT payload_json FROM cache_summary_snapshots WHERE id = 'default'").get() as
      | { payload_json: string }
      | undefined;
    if (!row) return null;
    try {
      return { ...(JSON.parse(row.payload_json) as CacheSummary), workspacePath, databasePath };
    } catch {
      this.db.prepare("DELETE FROM cache_summary_snapshots WHERE id = 'default'").run();
      return null;
    }
  }

  upsertCacheSummarySnapshot(summary: CacheSummary): void {
    const timestamp = nowIso();
    this.db
      .prepare(
        `INSERT INTO cache_summary_snapshots (id, payload_json, created_at, updated_at)
         VALUES ('default', ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`
      )
      .run(JSON.stringify(summary), timestamp, timestamp);
  }

  attentionSummarySnapshot(accountLogin: string): AttentionSummary | null {
    const row = this.db.prepare("SELECT payload_json FROM attention_summary_snapshots WHERE account_login = ?").get(accountLogin) as
      | { payload_json: string }
      | undefined;
    if (!row) return null;
    try {
      return { ...(JSON.parse(row.payload_json) as AttentionSummary), fromCache: true };
    } catch {
      this.db.prepare("DELETE FROM attention_summary_snapshots WHERE account_login = ?").run(accountLogin);
      return null;
    }
  }

  upsertAttentionSummarySnapshot(accountLogin: string, summary: AttentionSummary): void {
    const timestamp = nowIso();
    this.db
      .prepare(
        `INSERT INTO attention_summary_snapshots (account_login, payload_json, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(account_login) DO UPDATE SET
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`
      )
      .run(accountLogin, JSON.stringify({ ...summary, fromCache: true }), timestamp, timestamp);
  }

  healthHistorySnapshot(): HealthHistory | null {
    const row = this.db.prepare("SELECT payload_json FROM health_history_snapshots WHERE id = 'default'").get() as
      | { payload_json: string }
      | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.payload_json) as HealthHistory;
    } catch {
      this.db.prepare("DELETE FROM health_history_snapshots WHERE id = 'default'").run();
      return null;
    }
  }

  upsertHealthHistorySnapshot(history: HealthHistory): void {
    const timestamp = nowIso();
    this.db
      .prepare(
        `INSERT INTO health_history_snapshots (id, payload_json, created_at, updated_at)
         VALUES ('default', ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`
      )
      .run(JSON.stringify(history), timestamp, timestamp);
  }

  estimatedRepoCacheBytes(repoId: string, databasePath: string): number {
    const databaseBytes = fs.existsSync(databasePath) ? fs.statSync(databasePath).size : 0;
    const repoRows = this.repoCacheRowsFast();
    const totalRows = repoRows.reduce((sum, repo) => sum + repo.rows, 0);
    if (!totalRows) return 0;
    const repo = repoRows.find((item) => item.repoId === repoId);
    return repo ? Math.round((databaseBytes * repo.rows) / totalRows) + directorySize(repo.localPath, Date.now() + 50) : 0;
  }

  count(table: string, where?: string): number {
    const sql = `SELECT COUNT(*) AS count FROM ${table}${where ? ` WHERE ${where}` : ""}`;
    const row = this.db.prepare(sql).get() as { count: number };
    return row.count;
  }

  diagnosticRows<T>(sql: string, map: (row: Record<string, unknown>) => T): T[] {
    return (this.db.prepare(sql).all() as Record<string, unknown>[]).map(map);
  }

  deleteRows(tables: readonly string[], repoId?: string): void {
    for (const table of tables) {
      if (repoId) {
        this.db.prepare(`DELETE FROM ${table} WHERE repo_id = ?`).run(repoId);
        continue;
      }
      this.db.prepare(`DELETE FROM ${table}`).run();
    }
  }

  private deleteTargetRows(sql: string): number {
    return Number(this.db.prepare(sql).run().changes ?? 0);
  }

  repoCacheRows(): Array<{ repoId: string; repoFullName: string; rows: number }> {
    return this.db
      .prepare(
        `SELECT
           r.id AS repo_id,
           r.full_name AS repo_full_name,
           COUNT(DISTINCT p.id) +
           COUNT(DISTINCT i.id) +
           COUNT(DISTINCT c.id) +
           COUNT(DISTINCT rv.id) +
           COUNT(DISTINCT cr.id) +
           COUNT(DISTINCT cs.id) AS rows
         FROM repos r
         LEFT JOIN pull_requests p ON p.repo_id = r.id
         LEFT JOIN issues i ON i.repo_id = r.id
         LEFT JOIN comments c ON c.repo_id = r.id
         LEFT JOIN reviews rv ON rv.repo_id = r.id
         LEFT JOIN check_runs cr ON cr.repo_id = r.id
         LEFT JOIN commit_statuses cs ON cs.repo_id = r.id
         WHERE r.watch_enabled = 1
         GROUP BY r.id, r.full_name
         ORDER BY r.full_name`
      )
      .all()
      .map((row) => {
        const item = row as Record<string, unknown>;
        return { repoId: String(item.repo_id), repoFullName: String(item.repo_full_name), rows: Number(item.rows) };
      });
  }

  repoCacheRowsFast(): Array<{ repoId: string; repoFullName: string; localPath: string | null; rows: number }> {
    return (
      this.db
        .prepare(
          `SELECT
             r.id AS repo_id,
             r.full_name AS repo_full_name,
             r.local_path,
             COALESCE(row_counts.rows, 0) AS rows
           FROM repos r
           LEFT JOIN (
             SELECT repo_id, SUM(row_count) AS rows
             FROM (
               SELECT repo_id, COUNT(*) AS row_count FROM pull_requests GROUP BY repo_id
               UNION ALL SELECT repo_id, COUNT(*) AS row_count FROM issues GROUP BY repo_id
               UNION ALL SELECT repo_id, COUNT(*) AS row_count FROM comments GROUP BY repo_id
               UNION ALL SELECT repo_id, COUNT(*) AS row_count FROM reviews GROUP BY repo_id
               UNION ALL SELECT repo_id, COUNT(*) AS row_count FROM check_runs GROUP BY repo_id
               UNION ALL SELECT repo_id, COUNT(*) AS row_count FROM commit_statuses GROUP BY repo_id
             )
             GROUP BY repo_id
           ) row_counts ON row_counts.repo_id = r.id
           WHERE r.watch_enabled = 1
           ORDER BY r.full_name`
        )
        .all() as Array<{ repo_id: string; repo_full_name: string; local_path: string | null; rows: number }>
    ).map((repo) => ({
      repoId: repo.repo_id,
      repoFullName: repo.repo_full_name,
      localPath: nullableString(repo.local_path),
      rows: Number(repo.rows)
    }));
  }

  cacheSummaryCountersFast(): CacheSummaryCounters {
    const rows = this.db
      .prepare(
        `SELECT key, count FROM (
           SELECT 'watchedRepos' AS key, COUNT(*) AS count FROM repos WHERE watch_enabled = 1
           UNION ALL SELECT 'pullRequests', COUNT(*) FROM pull_requests p INNER JOIN repos r ON r.id = p.repo_id WHERE r.watch_enabled = 1
           UNION ALL SELECT 'issues', COUNT(*) FROM issues i INNER JOIN repos r ON r.id = i.repo_id WHERE r.watch_enabled = 1 AND i.is_pull_request = 0
           UNION ALL SELECT 'comments', COUNT(*) FROM comments c INNER JOIN repos r ON r.id = c.repo_id WHERE r.watch_enabled = 1
           UNION ALL SELECT 'reviews', COUNT(*) FROM reviews v INNER JOIN repos r ON r.id = v.repo_id WHERE r.watch_enabled = 1
           UNION ALL SELECT 'checkRuns', COUNT(*) FROM check_runs cr INNER JOIN repos r ON r.id = cr.repo_id WHERE r.watch_enabled = 1
           UNION ALL SELECT 'commitStatuses', COUNT(*) FROM commit_statuses cs INNER JOIN repos r ON r.id = cs.repo_id WHERE r.watch_enabled = 1
           UNION ALL SELECT 'searchRows', COUNT(*) FROM search_index s INNER JOIN repos r ON r.id = s.repo_id WHERE r.watch_enabled = 1
         )`
      )
      .all() as Array<{ key: keyof CacheSummaryCounters; count: number }>;
    const counts = new Map(rows.map((row) => [row.key, Number(row.count)]));
    return {
      watchedRepos: counts.get("watchedRepos") ?? 0,
      pullRequests: counts.get("pullRequests") ?? 0,
      issues: counts.get("issues") ?? 0,
      comments: counts.get("comments") ?? 0,
      reviews: counts.get("reviews") ?? 0,
      checkRuns: counts.get("checkRuns") ?? 0,
      commitStatuses: counts.get("commitStatuses") ?? 0,
      searchRows: counts.get("searchRows") ?? 0
    };
  }
}

function emptyClosedIssuePruneResult(): {
  issues: number;
  comments: number;
  labels: number;
  userRelations: number;
  searchRows: number;
  attentionStates: number;
  notificationEvents: number;
} {
  return { issues: 0, comments: 0, labels: 0, userRelations: 0, searchRows: 0, attentionStates: 0, notificationEvents: 0 };
}

function closedIssueRetentionCutoffIso(retentionDays = 365): string {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  return cutoff.toISOString();
}
