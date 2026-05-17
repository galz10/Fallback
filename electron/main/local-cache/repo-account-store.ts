import type { GitHubAccountSession } from "../../../src/shared/domain/auth.js";
import type { SyncStatus } from "../../../src/shared/domain/sync.js";
import { nowIso } from "../path-utils.js";
import { LocalCacheStoreBase } from "./store-base.js";
import { nullableBooleanNumber } from "./store-helpers.js";

export class RepoAccountStore extends LocalCacheStoreBase {
  setRepoAccountSyncState(
    repoId: string,
    accountId: string | null | undefined,
    status: SyncStatus,
    error: string | null,
    successfulSyncAt?: string
  ): void {
    if (!accountId) return;
    const timestamp = nowIso();
    this.db
      .prepare(
        `UPDATE repo_accounts
         SET sync_status = ?,
             sync_error = ?,
             last_synced_at = ?,
             last_successful_sync_at = COALESCE(?, last_successful_sync_at),
             updated_at = ?
         WHERE repo_id = ? AND account_id = ?`
      )
      .run(status, error, timestamp, successfulSyncAt ?? null, timestamp, repoId, accountId);
  }

  associateRepoAccount(
    repoId: string,
    account: GitHubAccountSession,
    permissions?: { admin?: boolean | null; push?: boolean | null; pull?: boolean | null } | null,
    options: { watchEnabled?: boolean } = {}
  ): void {
    this.db
      .prepare(
        `INSERT INTO repo_accounts (repo_id, account_id, endpoint, watch_enabled, permission_admin, permission_push, permission_pull, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(repo_id, account_id) DO UPDATE SET
           endpoint = excluded.endpoint,
           watch_enabled = CASE WHEN excluded.watch_enabled = 1 THEN 1 ELSE repo_accounts.watch_enabled END,
           permission_admin = excluded.permission_admin,
           permission_push = excluded.permission_push,
           permission_pull = excluded.permission_pull,
           updated_at = excluded.updated_at`
      )
      .run(
        repoId,
        account.id,
        account.endpoint,
        options.watchEnabled ? 1 : 0,
        nullableBooleanNumber(permissions?.admin),
        nullableBooleanNumber(permissions?.push),
        nullableBooleanNumber(permissions?.pull),
        nowIso()
      );
    if (options.watchEnabled) this.refreshRepoGlobalWatchState(repoId);
  }

  refreshRepoGlobalWatchState(repoId: string): void {
    const watched = this.db.prepare("SELECT 1 FROM repo_accounts WHERE repo_id = ? AND watch_enabled = 1 LIMIT 1").get(repoId);
    this.db
      .prepare(
        `UPDATE repos
         SET watch_enabled = ?,
             sync_status = CASE WHEN ? = 1 THEN sync_status ELSE 'stale' END,
             updated_at = ?
         WHERE id = ?`
      )
      .run(watched ? 1 : 0, watched ? 1 : 0, nowIso(), repoId);
  }

  reconcileGlobalRepoWatchStates(): void {
    this.db
      .prepare(
        `UPDATE repos
         SET watch_enabled = CASE
               WHEN EXISTS (SELECT 1 FROM repo_accounts ra WHERE ra.repo_id = repos.id AND ra.watch_enabled = 1) THEN 1
               ELSE 0
             END,
             updated_at = ?
         WHERE watch_enabled != CASE
               WHEN EXISTS (SELECT 1 FROM repo_accounts ra WHERE ra.repo_id = repos.id AND ra.watch_enabled = 1) THEN 1
               ELSE 0
             END`
      )
      .run(nowIso());
  }
}
