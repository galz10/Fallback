import type { SearchFilters, SearchResult } from "../../../src/shared/domain/github-work.js";
import { LocalCacheStoreBase } from "./store-base.js";
import { escapeFtsQuery, nullableString } from "./store-helpers.js";

export class SearchIndexStore extends LocalCacheStoreBase {
  search(query: string, filters: SearchFilters = {}): SearchResult[] {
    return this.searchForAccount(query, filters, null);
  }

  searchForActiveAccount(query: string, filters: SearchFilters = {}): SearchResult[] {
    return this.searchForAccount(query, filters, this.getGitHubAccount()?.id ?? null);
  }

  searchForAccount(query: string, filters: SearchFilters = {}, accountId: string | null): SearchResult[] {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }
    const clauses = ["search_index MATCH ?"];
    const args: unknown[] = [escapeFtsQuery(trimmed)];
    const scopedAccountId = accountId && !this.useLegacyUnscopedRepoVisibility(accountId) ? accountId : null;
    if (scopedAccountId) {
      clauses.push("ra.account_id = ?");
      clauses.push("ra.watch_enabled = 1");
      args.push(scopedAccountId);
    }
    if (filters.repoId) {
      clauses.push("s.repo_id = ?");
      args.push(filters.repoId);
    }
    if (filters.entityType) {
      clauses.push("s.entity_type = ?");
      args.push(filters.entityType);
    }
    if (filters.state) {
      clauses.push("s.state = ?");
      args.push(filters.state);
    }
    if (filters.author) {
      clauses.push("s.author_login = ?");
      args.push(filters.author);
    }
    if (filters.label) {
      clauses.push("s.labels LIKE ?");
      args.push(`%${filters.label}%`);
    }

    return this.db
      .prepare(
        `SELECT
           s.entity_id,
           s.repo_id,
           r.full_name AS repo_full_name,
           s.entity_type,
           s.entity_number,
           s.title,
           snippet(search_index, 5, '', '', '...', 12) AS snippet,
           s.author_login,
           s.state,
           s.updated_at
         FROM search_index s
         JOIN repos r ON r.id = s.repo_id
         ${scopedAccountId ? "JOIN repo_accounts ra ON ra.repo_id = s.repo_id" : ""}
         WHERE ${clauses.join(" AND ")}
         ORDER BY bm25(search_index)
         LIMIT 50`
      )
      .all(...args)
      .map((row) => {
        const item = row as Record<string, unknown>;
        return {
          entityId: String(item.entity_id),
          repoId: String(item.repo_id),
          repoFullName: String(item.repo_full_name),
          entityType: String(item.entity_type) as SearchResult["entityType"],
          entityNumber: Number(item.entity_number),
          title: nullableString(item.title),
          snippet: nullableString(item.snippet),
          authorLogin: nullableString(item.author_login),
          state: nullableString(item.state),
          updatedAt: nullableString(item.updated_at)
        };
      });
  }

  rebuildSearchIndex(repoId?: string): void {
    const tx = this.db.transaction(() => {
      if (repoId) {
        this.db.prepare("DELETE FROM search_index WHERE repo_id = ?").run(repoId);
      } else {
        this.db.prepare("DELETE FROM search_index").run();
      }

      const repoClause = repoId ? "WHERE repo_id = ?" : "";
      const args = repoId ? [repoId] : [];
      const repoWhere = repoId ? "WHERE id = ?" : "";

      for (const row of this.db.prepare(`SELECT * FROM repos ${repoWhere}`).all(...args) as Record<string, unknown>[]) {
        this.insertSearchRow({
          entityId: String(row.id),
          repoId: String(row.id),
          entityType: "repo",
          entityNumber: 0,
          title: nullableString(row.full_name),
          body: nullableString(row.description),
          authorLogin: nullableString(row.owner),
          state: nullableString(row.sync_status),
          labels: "",
          updatedAt: nullableString(row.updated_at)
        });
      }

      for (const row of this.db.prepare(`SELECT * FROM pull_requests ${repoClause}`).all(...args) as Record<string, unknown>[]) {
        this.insertSearchRow({
          entityId: String(row.id),
          repoId: String(row.repo_id),
          entityType: "pull_request",
          entityNumber: Number(row.number),
          title: nullableString(row.title),
          body: nullableString(row.body),
          authorLogin: nullableString(row.author_login),
          state: nullableString(row.state),
          labels: this.labelNames(String(row.repo_id), "pull_request", Number(row.number)),
          updatedAt: nullableString(row.updated_at)
        });
      }

      for (const row of this.db.prepare(`SELECT * FROM issues ${repoClause}`).all(...args) as Record<string, unknown>[]) {
        if (Number(row.is_pull_request) === 1) {
          continue;
        }
        this.insertSearchRow({
          entityId: String(row.id),
          repoId: String(row.repo_id),
          entityType: "issue",
          entityNumber: Number(row.number),
          title: nullableString(row.title),
          body: nullableString(row.body),
          authorLogin: nullableString(row.author_login),
          state: nullableString(row.state),
          labels: this.labelNames(String(row.repo_id), "issue", Number(row.number)),
          updatedAt: nullableString(row.updated_at)
        });
      }

      for (const row of this.db.prepare(`SELECT * FROM comments ${repoClause}`).all(...args) as Record<string, unknown>[]) {
        this.insertSearchRow({
          entityId: String(row.id),
          repoId: String(row.repo_id),
          entityType: "comment",
          entityNumber: Number(row.entity_number),
          title: `${row.entity_type} #${row.entity_number}`,
          body: nullableString(row.body),
          authorLogin: nullableString(row.author_login),
          state: null,
          labels: "",
          updatedAt: nullableString(row.updated_at)
        });
      }

      for (const row of this.db.prepare(`SELECT * FROM reviews ${repoClause}`).all(...args) as Record<string, unknown>[]) {
        this.insertSearchRow({
          entityId: String(row.id),
          repoId: String(row.repo_id),
          entityType: "review",
          entityNumber: Number(row.pr_number),
          title: `Review on PR #${row.pr_number}`,
          body: nullableString(row.body),
          authorLogin: nullableString(row.author_login),
          state: nullableString(row.state),
          labels: "",
          updatedAt: nullableString(row.submitted_at)
        });
      }
    });
    tx();
  }

  rebuildIssueSearchIndex(repoId: string, number: number): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `DELETE FROM search_index
           WHERE repo_id = ?
             AND entity_number = ?
             AND entity_type IN ('issue', 'comment')`
        )
        .run(repoId, number);

      const issue = this.db.prepare("SELECT * FROM issues WHERE repo_id = ? AND number = ? AND is_pull_request = 0").get(repoId, number) as
        | Record<string, unknown>
        | undefined;
      if (issue) {
        this.insertSearchRow({
          entityId: String(issue.id),
          repoId: String(issue.repo_id),
          entityType: "issue",
          entityNumber: Number(issue.number),
          title: nullableString(issue.title),
          body: nullableString(issue.body),
          authorLogin: nullableString(issue.author_login),
          state: nullableString(issue.state),
          labels: this.labelNames(String(issue.repo_id), "issue", Number(issue.number)),
          updatedAt: nullableString(issue.updated_at)
        });
      }

      for (const row of this.db
        .prepare("SELECT * FROM comments WHERE repo_id = ? AND entity_type = 'issue' AND entity_number = ?")
        .all(repoId, number) as Record<string, unknown>[]) {
        this.insertSearchRow({
          entityId: String(row.id),
          repoId: String(row.repo_id),
          entityType: "comment",
          entityNumber: Number(row.entity_number),
          title: `issue #${row.entity_number}`,
          body: nullableString(row.body),
          authorLogin: nullableString(row.author_login),
          state: null,
          labels: "",
          updatedAt: nullableString(row.updated_at)
        });
      }
    });
    tx();
  }

  rebuildPullRequestSearchIndex(repoId: string, number: number): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `DELETE FROM search_index
           WHERE repo_id = ?
             AND entity_number = ?
             AND entity_type IN ('pull_request', 'comment', 'review')`
        )
        .run(repoId, number);

      const pullRequest = this.db.prepare("SELECT * FROM pull_requests WHERE repo_id = ? AND number = ?").get(repoId, number) as
        | Record<string, unknown>
        | undefined;
      if (pullRequest) {
        this.insertSearchRow({
          entityId: String(pullRequest.id),
          repoId: String(pullRequest.repo_id),
          entityType: "pull_request",
          entityNumber: Number(pullRequest.number),
          title: nullableString(pullRequest.title),
          body: nullableString(pullRequest.body),
          authorLogin: nullableString(pullRequest.author_login),
          state: nullableString(pullRequest.state),
          labels: this.labelNames(String(pullRequest.repo_id), "pull_request", Number(pullRequest.number)),
          updatedAt: nullableString(pullRequest.updated_at)
        });
      }

      for (const row of this.db
        .prepare(
          `SELECT * FROM comments
           WHERE repo_id = ?
             AND entity_type IN ('pull_request', 'review_comment')
             AND entity_number = ?`
        )
        .all(repoId, number) as Record<string, unknown>[]) {
        this.insertSearchRow({
          entityId: String(row.id),
          repoId: String(row.repo_id),
          entityType: "comment",
          entityNumber: Number(row.entity_number),
          title: `${row.entity_type} #${row.entity_number}`,
          body: nullableString(row.body),
          authorLogin: nullableString(row.author_login),
          state: null,
          labels: "",
          updatedAt: nullableString(row.updated_at)
        });
      }

      for (const row of this.db.prepare("SELECT * FROM reviews WHERE repo_id = ? AND pr_number = ?").all(repoId, number) as Record<
        string,
        unknown
      >[]) {
        this.insertSearchRow({
          entityId: String(row.id),
          repoId: String(row.repo_id),
          entityType: "review",
          entityNumber: Number(row.pr_number),
          title: `Review on PR #${row.pr_number}`,
          body: nullableString(row.body),
          authorLogin: nullableString(row.author_login),
          state: nullableString(row.state),
          labels: "",
          updatedAt: nullableString(row.submitted_at)
        });
      }
    });
    tx();
  }

  insertSearchRow(input: {
    entityId: string;
    repoId: string;
    entityType: string;
    entityNumber: number;
    title: string | null;
    body: string | null;
    authorLogin: string | null;
    state: string | null;
    labels: string;
    updatedAt: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO search_index
          (entity_id, repo_id, entity_type, entity_number, title, body, author_login, state, labels, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
      )
      .run(
        input.entityId,
        input.repoId,
        input.entityType,
        input.entityNumber,
        input.title,
        input.body,
        input.authorLogin,
        input.state,
        input.labels,
        input.updatedAt
      );
  }

  labelNames(repoId: string, entityType: string, entityNumber: number): string {
    return (
      this.db
        .prepare(
          `SELECT l.name
           FROM entity_labels el
           JOIN labels l ON l.id = el.label_id
           WHERE el.repo_id = ? AND el.entity_type = ? AND el.entity_number = ?
           ORDER BY l.name`
        )
        .all(repoId, entityType, entityNumber) as Array<{ name: string }>
    )
      .map((row) => row.name)
      .join(" ");
  }
}
