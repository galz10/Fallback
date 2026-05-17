import type { SyncStatus } from "../../../src/shared/domain/sync.js";
import type { WatchedRepo } from "../../../src/shared/domain/watched-repo.js";
import { nowIso } from "../path-utils.js";
import { LocalCacheStoreBase } from "./store-base.js";
import { logDbListTiming, mapRepo, primaryWorkspaceDraft, type RepoRow } from "./store-helpers.js";

export class RepoStore extends LocalCacheStoreBase {
  setRepoSyncState(repoId: string, status: SyncStatus, error: string | null, successfulSyncAt?: string): void {
    this.db
      .prepare(
        `UPDATE repos
         SET sync_status = ?,
             sync_error = ?,
             last_synced_at = ?,
             last_successful_sync_at = COALESCE(?, last_successful_sync_at),
             updated_at = ?
         WHERE id = ?`
      )
      .run(status, error, nowIso(), successfulSyncAt ?? null, nowIso(), repoId);
  }

  setRepoCloneState(repoId: string, cloneStatus: string, localPath: string | null): void {
    this.db
      .prepare(
        `UPDATE repos
         SET watch_mode = 'cloned',
             clone_enabled = 1,
             clone_status = ?,
             local_path = COALESCE(?, local_path),
             updated_at = ?
         WHERE id = ?`
      )
      .run(cloneStatus, localPath, nowIso(), repoId);
    if (localPath) this.upsertRepoWorkspace(primaryWorkspaceDraft(repoId, localPath, true));
  }

  markPullRequestStale(repoId: string, number: number): void {
    this.db
      .prepare("UPDATE pull_requests SET state = 'stale', last_synced_at = ? WHERE repo_id = ? AND number = ?")
      .run(nowIso(), repoId, number);
  }

  markIssueStale(repoId: string, number: number): void {
    this.db.prepare("UPDATE issues SET state = 'stale', last_synced_at = ? WHERE repo_id = ? AND number = ?").run(nowIso(), repoId, number);
  }

  listWatchedRepos(): WatchedRepo[] {
    return this.listWatchedReposForAccount(null);
  }

  listWatchedReposForActiveAccount(): WatchedRepo[] {
    return this.listWatchedReposForAccount(this.getGitHubAccount()?.id ?? null);
  }

  listStartupRepoShellsForActiveAccount(): WatchedRepo[] {
    return this.listStartupRepoShellsForAccount(this.getGitHubAccount()?.id ?? null);
  }

  listStartupRepoShellsForAccount(accountId: string | null): WatchedRepo[] {
    const startedAt = performance.now();
    const scopedAccountId = accountId && !this.useLegacyUnscopedRepoVisibility(accountId) ? accountId : null;
    const rows = this.db
      .prepare(
        `SELECT
           r.*,
           0 AS open_pull_requests,
           0 AS open_issues,
           NULL AS sync_progress_message,
           NULL AS group_ids,
           NULL AS group_names
         FROM repos r
         ${scopedAccountId ? "JOIN repo_accounts ra ON ra.repo_id = r.id AND ra.account_id = ? AND ra.watch_enabled = 1" : ""}
         WHERE r.watch_enabled = 1
         ORDER BY r.watch_priority DESC, r.full_name ASC`
      )
      .all(...(scopedAccountId ? [scopedAccountId] : [])) as RepoRow[];
    const mapStart = performance.now();
    const repos = rows.map(mapRepo);
    logDbListTiming("repos:startup-shells", rows.length, mapStart - startedAt, performance.now() - mapStart, {
      scoped: scopedAccountId ? 1 : 0
    });
    return repos;
  }

  listWatchedReposForAccount(accountId: string | null): WatchedRepo[] {
    const startedAt = performance.now();
    const scopedAccountId = accountId && !this.useLegacyUnscopedRepoVisibility(accountId) ? accountId : null;
    const rows = this.db
      .prepare(
        `WITH
           open_prs AS (
             SELECT repo_id, COUNT(*) AS count
             FROM pull_requests
             WHERE state = 'open'
             GROUP BY repo_id
           ),
           open_issues AS (
             SELECT repo_id, COUNT(*) AS count
             FROM issues
             WHERE state = 'open' AND is_pull_request = 0
             GROUP BY repo_id
           ),
           active_jobs AS (
             SELECT repo_id, progress_message
             FROM (
               SELECT
                 repo_id,
                 progress_message,
                 ROW_NUMBER() OVER (PARTITION BY repo_id ORDER BY created_at ASC) AS rank
               FROM sync_jobs
               WHERE status IN ('queued', 'running')
             )
             WHERE rank = 1
           ),
           groups AS (
             SELECT repo_id, GROUP_CONCAT(id, char(31)) AS group_ids, GROUP_CONCAT(name, char(31)) AS group_names
             FROM (
               SELECT rgm.repo_id, g.id, g.name
               FROM repo_group_memberships rgm
               JOIN repo_groups g ON g.id = rgm.group_id
               ORDER BY rgm.repo_id ASC, g.name ASC
             )
             GROUP BY repo_id
           )
         SELECT
           r.*,
           COALESCE(open_prs.count, 0) AS open_pull_requests,
           COALESCE(open_issues.count, 0) AS open_issues,
           active_jobs.progress_message AS sync_progress_message,
           groups.group_ids,
           groups.group_names
         FROM repos r
         ${scopedAccountId ? "JOIN repo_accounts ra ON ra.repo_id = r.id AND ra.account_id = ? AND ra.watch_enabled = 1" : ""}
         LEFT JOIN open_prs ON open_prs.repo_id = r.id
         LEFT JOIN open_issues ON open_issues.repo_id = r.id
         LEFT JOIN active_jobs ON active_jobs.repo_id = r.id
         LEFT JOIN groups ON groups.repo_id = r.id
         WHERE r.watch_enabled = 1
         ORDER BY r.watch_priority DESC, r.full_name ASC`
      )
      .all(...(scopedAccountId ? [scopedAccountId] : [])) as RepoRow[];
    const mapStart = performance.now();
    const repos = rows.map(mapRepo);
    logDbListTiming("repos:list-watched", rows.length, mapStart - startedAt, performance.now() - mapStart, {
      scoped: scopedAccountId ? 1 : 0
    });
    return repos;
  }

  repoIsVisibleToAccount(repoId: string, accountId: string | null = this.getGitHubAccount()?.id ?? null): boolean {
    if (!accountId) return false;
    if (this.useLegacyUnscopedRepoVisibility(accountId)) {
      const row = this.db.prepare("SELECT 1 FROM repos WHERE id = ? AND watch_enabled = 1 LIMIT 1").get(repoId);
      return Boolean(row);
    }
    const row = this.db
      .prepare(
        `SELECT 1
         FROM repos r
         JOIN repo_accounts ra ON ra.repo_id = r.id AND ra.account_id = ? AND ra.watch_enabled = 1
         WHERE r.id = ? AND r.watch_enabled = 1
         LIMIT 1`
      )
      .get(accountId, repoId);
    return Boolean(row);
  }

  useLegacyUnscopedRepoVisibility(accountId: string): boolean {
    const accountCount = Number(
      (
        this.db
          .prepare("SELECT COUNT(*) AS count FROM accounts WHERE github_user_id IS NOT NULL AND COALESCE(profile_hidden, 0) = 0")
          .get() as { count: number }
      ).count
    );
    if (accountCount > 1) return false;
    const bindingCount = Number(
      (this.db.prepare("SELECT COUNT(*) AS count FROM repo_accounts WHERE account_id = ?").get(accountId) as { count: number }).count
    );
    return bindingCount === 0;
  }

  requireRepoVisibleToActiveAccount(repoId: string): void {
    const account = this.getGitHubAccount();
    if (!account) throw new Error("Connect a GitHub profile before using this repository.");
    if (!this.repoIsVisibleToAccount(repoId, account.id)) {
      throw new Error(
        `This repository is not available in the active GitHub profile (${account.profileName ?? account.login ?? "unknown"}).`
      );
    }
  }

  getRepo(repoId: string): WatchedRepo | null {
    const row = this.db
      .prepare(
        `SELECT
           r.*,
           (SELECT COUNT(*) FROM pull_requests p WHERE p.repo_id = r.id AND p.state = 'open') AS open_pull_requests,
           (SELECT COUNT(*) FROM issues i WHERE i.repo_id = r.id AND i.state = 'open' AND i.is_pull_request = 0) AS open_issues,
           (
             SELECT sj.progress_message
             FROM sync_jobs sj
             WHERE sj.repo_id = r.id AND sj.status IN ('queued', 'running')
             ORDER BY sj.created_at ASC
             LIMIT 1
           ) AS sync_progress_message,
           (
             SELECT GROUP_CONCAT(id, char(31))
             FROM (
               SELECT g.id AS id
               FROM repo_group_memberships rgm
               JOIN repo_groups g ON g.id = rgm.group_id
               WHERE rgm.repo_id = r.id
               ORDER BY g.name ASC
             )
           ) AS group_ids,
           (
             SELECT GROUP_CONCAT(name, char(31))
             FROM (
               SELECT g.name AS name
               FROM repo_group_memberships rgm
               JOIN repo_groups g ON g.id = rgm.group_id
               WHERE rgm.repo_id = r.id
               ORDER BY g.name ASC
             )
           ) AS group_names
         FROM repos r
         WHERE r.id = ?`
      )
      .get(repoId) as RepoRow | undefined;
    return row ? mapRepo(row) : null;
  }

  unwatchRepo(repoId: string): void {
    const accountId = this.getGitHubAccount()?.id ?? null;
    if (accountId && !this.useLegacyUnscopedRepoVisibility(accountId)) {
      this.db
        .prepare("UPDATE repo_accounts SET watch_enabled = 0, sync_status = 'stale', updated_at = ? WHERE repo_id = ? AND account_id = ?")
        .run(nowIso(), repoId, accountId);
      this.refreshRepoGlobalWatchState(repoId);
      return;
    }
    this.db
      .prepare(
        `UPDATE repos
         SET watch_enabled = 0,
             sync_status = 'stale',
             updated_at = ?
         WHERE id = ?`
      )
      .run(nowIso(), repoId);
  }
}
