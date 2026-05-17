import { nowIso } from "../path-utils.js";
import { LocalCacheStoreBase } from "./store-base.js";
import { nullableString } from "./store-helpers.js";

export class RepoMetadataStore extends LocalCacheStoreBase {
  getRepoMetadataCache<T>(repoId: string, cacheKey: string): { payload: T; updatedAt: string } | null {
    const row = this.db
      .prepare("SELECT payload, updated_at FROM repo_metadata_cache WHERE repo_id = ? AND cache_key = ?")
      .get(repoId, cacheKey) as { payload: string; updated_at: string } | undefined;
    if (!row) return null;
    return {
      payload: JSON.parse(row.payload) as T,
      updatedAt: row.updated_at
    };
  }

  setRepoMetadataCache(repoId: string, cacheKey: string, payload: unknown, updatedAt = nowIso()): void {
    this.db
      .prepare(
        `INSERT INTO repo_metadata_cache (repo_id, cache_key, payload, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(repo_id, cache_key)
         DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
      )
      .run(repoId, cacheKey, JSON.stringify(payload), updatedAt);
  }

  getIssueBackfillCursor(repoId: string, state: string): { nextPage: number; completedAt: string | null; updatedAt: string } {
    const row = this.db
      .prepare("SELECT next_page, completed_at, updated_at FROM issue_backfill_cursors WHERE repo_id = ? AND state = ?")
      .get(repoId, state) as { next_page: number; completed_at: string | null; updated_at: string } | undefined;
    return row
      ? { nextPage: Number(row.next_page), completedAt: nullableString(row.completed_at), updatedAt: String(row.updated_at) }
      : { nextPage: 1, completedAt: null, updatedAt: nowIso() };
  }

  setIssueBackfillCursor(repoId: string, state: string, nextPage: number, completedAt: string | null): void {
    this.db
      .prepare(
        `INSERT INTO issue_backfill_cursors (repo_id, state, next_page, completed_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(repo_id, state)
         DO UPDATE SET next_page = excluded.next_page,
                       completed_at = excluded.completed_at,
                       updated_at = excluded.updated_at`
      )
      .run(repoId, state, nextPage, completedAt, nowIso());
  }

  getGitHubPageCache<T>(
    repoId: string,
    cacheKey: string
  ): {
    etag: string | null;
    lastModified: string | null;
    payload: T | null;
    updatedAt: string;
  } | null {
    const row = this.db
      .prepare("SELECT etag, last_modified, payload, updated_at FROM github_page_cache WHERE repo_id = ? AND cache_key = ?")
      .get(repoId, cacheKey) as
      | { etag: string | null; last_modified: string | null; payload: string | null; updated_at: string }
      | undefined;
    if (!row) return null;
    return {
      etag: nullableString(row.etag),
      lastModified: nullableString(row.last_modified),
      payload: row.payload ? (JSON.parse(row.payload) as T) : null,
      updatedAt: row.updated_at
    };
  }

  setGitHubPageCache(
    repoId: string,
    cacheKey: string,
    input: { etag?: string | null; lastModified?: string | null; payload?: unknown }
  ): void {
    const current = this.getGitHubPageCache<unknown>(repoId, cacheKey);
    this.db
      .prepare(
        `INSERT INTO github_page_cache (repo_id, cache_key, etag, last_modified, payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(repo_id, cache_key)
         DO UPDATE SET etag = excluded.etag,
                       last_modified = excluded.last_modified,
                       payload = excluded.payload,
                       updated_at = excluded.updated_at`
      )
      .run(
        repoId,
        cacheKey,
        input.etag ?? current?.etag ?? null,
        input.lastModified ?? current?.lastModified ?? null,
        input.payload === undefined ? (current?.payload == null ? null : JSON.stringify(current.payload)) : JSON.stringify(input.payload),
        nowIso()
      );
  }
}
