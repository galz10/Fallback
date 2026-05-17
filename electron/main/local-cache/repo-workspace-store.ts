import type { RepoWorkspace } from "../../../src/shared/domain/watched-repo.js";
import { nowIso } from "../path-utils.js";
import { LocalCacheStoreBase } from "./store-base.js";
import { mapRepoWorkspace, primaryWorkspaceDraft } from "./store-helpers.js";

export class RepoWorkspaceStore extends LocalCacheStoreBase {
  listRepoWorkspaces(repoId: string): RepoWorkspace[] {
    this.backfillRepoWorkspace(repoId);
    const rows = this.db
      .prepare("SELECT * FROM repo_workspaces WHERE repo_id = ? ORDER BY is_active DESC, kind ASC, local_path ASC")
      .all(repoId) as Record<string, unknown>[];
    return rows.map(mapRepoWorkspace);
  }

  getRepoWorkspace(repoId: string, workspaceId: string): RepoWorkspace | null {
    this.backfillRepoWorkspace(repoId);
    const row = this.db.prepare("SELECT * FROM repo_workspaces WHERE repo_id = ? AND id = ?").get(repoId, workspaceId) as
      | Record<string, unknown>
      | undefined;
    return row ? mapRepoWorkspace(row) : null;
  }

  activeRepoWorkspace(repoId: string): RepoWorkspace | null {
    this.backfillRepoWorkspace(repoId);
    const row = this.db
      .prepare("SELECT * FROM repo_workspaces WHERE repo_id = ? AND is_active = 1 ORDER BY updated_at DESC LIMIT 1")
      .get(repoId) as Record<string, unknown> | undefined;
    if (row) return mapRepoWorkspace(row);
    const fallback = this.db
      .prepare("SELECT * FROM repo_workspaces WHERE repo_id = ? ORDER BY kind ASC, updated_at DESC LIMIT 1")
      .get(repoId) as Record<string, unknown> | undefined;
    return fallback ? mapRepoWorkspace(fallback) : null;
  }

  upsertRepoWorkspace(input: Omit<RepoWorkspace, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }): RepoWorkspace {
    const timestamp = nowIso();
    if (input.isActive) this.db.prepare("UPDATE repo_workspaces SET is_active = 0 WHERE repo_id = ?").run(input.repoId);
    this.db
      .prepare(
        `INSERT INTO repo_workspaces (
          id, repo_id, kind, local_path, git_common_dir, git_dir, main_worktree_path, branch, head_sha,
          is_active, is_dirty, locked, lock_reason, prunable, prune_reason, detached, bare, missing,
          last_seen_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          kind = excluded.kind,
          local_path = excluded.local_path,
          git_common_dir = excluded.git_common_dir,
          git_dir = excluded.git_dir,
          main_worktree_path = excluded.main_worktree_path,
          branch = excluded.branch,
          head_sha = excluded.head_sha,
          is_active = excluded.is_active,
          is_dirty = excluded.is_dirty,
          locked = excluded.locked,
          lock_reason = excluded.lock_reason,
          prunable = excluded.prunable,
          prune_reason = excluded.prune_reason,
          detached = excluded.detached,
          bare = excluded.bare,
          missing = excluded.missing,
          last_seen_at = excluded.last_seen_at,
          updated_at = excluded.updated_at`
      )
      .run(
        input.id,
        input.repoId,
        input.kind,
        input.localPath,
        input.gitCommonDir,
        input.gitDir,
        input.mainWorktreePath,
        input.branch,
        input.headSha,
        Number(input.isActive),
        input.isDirty == null ? null : Number(input.isDirty),
        Number(input.locked),
        input.lockReason,
        Number(input.prunable),
        input.pruneReason,
        Number(input.detached),
        Number(input.bare),
        Number(input.missing),
        input.lastSeenAt,
        input.createdAt ?? timestamp,
        input.updatedAt ?? timestamp
      );
    return this.getRepoWorkspace(input.repoId, input.id)!;
  }

  setActiveRepoWorkspace(repoId: string, workspaceId: string): RepoWorkspace {
    const workspace = this.getRepoWorkspace(repoId, workspaceId);
    if (!workspace) throw new Error("Workspace is not registered for this repository.");
    const timestamp = nowIso();
    this.db.transaction(() => {
      this.db.prepare("UPDATE repo_workspaces SET is_active = 0, updated_at = ? WHERE repo_id = ?").run(timestamp, repoId);
      this.db
        .prepare("UPDATE repo_workspaces SET is_active = 1, updated_at = ? WHERE repo_id = ? AND id = ?")
        .run(timestamp, repoId, workspaceId);
      this.db
        .prepare(
          "UPDATE repos SET local_path = ?, watch_mode = 'cloned', clone_enabled = 1, clone_status = 'cloned', updated_at = ? WHERE id = ?"
        )
        .run(workspace.localPath, timestamp, repoId);
    })();
    return this.getRepoWorkspace(repoId, workspaceId)!;
  }

  deleteRepoWorkspace(repoId: string, workspaceId: string): void {
    this.db.prepare("DELETE FROM repo_workspaces WHERE repo_id = ? AND id = ?").run(repoId, workspaceId);
  }

  backfillRepoWorkspace(repoId: string): void {
    const repo = this.getRepo(repoId);
    if (!repo?.localPath) return;
    const exists = this.db.prepare("SELECT 1 FROM repo_workspaces WHERE repo_id = ? LIMIT 1").get(repoId);
    if (!exists) this.upsertRepoWorkspace(primaryWorkspaceDraft(repoId, repo.localPath, true));
  }
}
