import type { RepoGroup } from "../../../src/shared/domain/repo-group.js";
import type { WatchedRepo } from "../../../src/shared/domain/watched-repo.js";
import { nowIso } from "../path-utils.js";
import { LocalCacheStoreBase } from "./store-base.js";
import { cleanRepoGroupName, mapRepoGroup } from "./store-helpers.js";

export class RepoGroupStore extends LocalCacheStoreBase {
  listRepoGroups(): RepoGroup[] {
    const rows = this.db.prepare("SELECT * FROM repo_groups ORDER BY name ASC").all() as Record<string, unknown>[];
    return rows.map((row) => mapRepoGroup(row, this.repoIdsForGroup(String(row.id))));
  }

  listRepoGroupsForActiveAccount(): RepoGroup[] {
    const visibleRepos = this.listWatchedReposForActiveAccount() as WatchedRepo[];
    const visibleIds = new Set(visibleRepos.map((repo) => repo.id));
    return this.listRepoGroups().map((group) => ({ ...group, repoIds: group.repoIds.filter((repoId) => visibleIds.has(repoId)) }));
  }

  createRepoGroup(input: { name?: string }): RepoGroup {
    const name = cleanRepoGroupName(input.name);
    const id = `group:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
    const now = nowIso();
    this.db.prepare("INSERT INTO repo_groups (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(id, name, now, now);
    return this.listRepoGroups().find((group) => group.id === id)!;
  }

  updateRepoGroup(groupId: string, input: { name?: string }): RepoGroup {
    const existing = this.db.prepare("SELECT * FROM repo_groups WHERE id = ?").get(groupId) as Record<string, unknown> | undefined;
    if (!existing) throw new Error("Repository group not found.");
    const name = input.name == null ? String(existing.name) : cleanRepoGroupName(input.name);
    this.db.prepare("UPDATE repo_groups SET name = ?, updated_at = ? WHERE id = ?").run(name, nowIso(), groupId);
    return this.listRepoGroups().find((group) => group.id === groupId)!;
  }

  deleteRepoGroup(groupId: string): void {
    const remove = this.db.transaction(() => {
      this.db.prepare("DELETE FROM repo_group_memberships WHERE group_id = ?").run(groupId);
      this.db.prepare("DELETE FROM repo_groups WHERE id = ?").run(groupId);
    });
    remove();
  }

  setRepoGroupMemberships(groupId: string, repoIds: string[]): RepoGroup {
    const group = this.db.prepare("SELECT * FROM repo_groups WHERE id = ?").get(groupId) as Record<string, unknown> | undefined;
    if (!group) throw new Error("Repository group not found.");
    const visibleRepos = this.listWatchedReposForActiveAccount() as WatchedRepo[];
    const validRepoIds = new Set(visibleRepos.map((repo) => repo.id));
    const cleanRepoIds = [...new Set(repoIds.filter((repoId) => validRepoIds.has(repoId)))];
    const now = nowIso();
    const replace = this.db.transaction(() => {
      this.db.prepare("DELETE FROM repo_group_memberships WHERE group_id = ?").run(groupId);
      const insert = this.db.prepare("INSERT INTO repo_group_memberships (group_id, repo_id, created_at) VALUES (?, ?, ?)");
      for (const repoId of cleanRepoIds) insert.run(groupId, repoId, now);
      this.db.prepare("UPDATE repo_groups SET updated_at = ? WHERE id = ?").run(now, groupId);
    });
    replace();
    return this.listRepoGroups().find((item) => item.id === groupId)!;
  }

  repoIdsForGroup(groupId: string): string[] {
    return (
      this.db.prepare("SELECT repo_id FROM repo_group_memberships WHERE group_id = ? ORDER BY repo_id ASC").all(groupId) as Array<{
        repo_id: string;
      }>
    ).map((row) => row.repo_id);
  }
}
