import type {
  ActionCheckSummary,
  CheckRunSummary,
  IssueDetail,
  IssueListInput,
  IssueSummary,
  PullRequestDetail,
  PullRequestSummary,
  ReviewSummary,
  TimelineComment,
  WorkflowRunSummary
} from "../../../src/shared/domain/github-work.js";
import { nowIso } from "../path-utils.js";
import { LocalCacheStoreBase } from "./store-base.js";
import {
  issueSelect,
  issueStateClause,
  logDbListTiming,
  logDbTiming,
  mapActionCheck,
  mapCheckRun,
  mapComment,
  mapIssue,
  mapPullRequest,
  mapReview,
  mapWorkflowRun,
  normalizeListLimit,
  normalizeListOffset,
  nullableString,
  pullRequestSelect,
  type PullRequestDiffCacheTarget
} from "./store-helpers.js";

export class GitHubWorkStore extends LocalCacheStoreBase {
  recordUserPullRequest(login: string, repoId: string, prNumber: number, relation: string): void {
    this.db
      .prepare(
        `INSERT INTO user_pull_requests (repo_id, pr_number, github_user_login, relation, last_synced_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(repo_id, pr_number, github_user_login)
         DO UPDATE SET
           relation = CASE
             WHEN CASE excluded.relation
                    WHEN 'author' THEN 4
                    WHEN 'reviewed' THEN 3
                    WHEN 'reviewer' THEN 2
                    WHEN 'assignee' THEN 1
                    ELSE 0
                  END > CASE user_pull_requests.relation
                    WHEN 'author' THEN 4
                    WHEN 'reviewed' THEN 3
                    WHEN 'reviewer' THEN 2
                    WHEN 'assignee' THEN 1
                    ELSE 0
                  END THEN excluded.relation
             ELSE user_pull_requests.relation
           END,
           last_synced_at = excluded.last_synced_at`
      )
      .run(repoId, prNumber, login, relation, nowIso());
  }

  recordUserIssue(login: string, repoId: string, issueNumber: number, relation: string | null): void {
    const timestamp = nowIso();
    if (!relation) {
      this.db
        .prepare("DELETE FROM user_issues WHERE repo_id = ? AND issue_number = ? AND github_user_login = ?")
        .run(repoId, issueNumber, login);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO user_issues (repo_id, issue_number, github_user_login, relation, last_synced_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(repo_id, issue_number, github_user_login)
         DO UPDATE SET
           relation = CASE
             WHEN CASE excluded.relation
                    WHEN 'author' THEN 3
                    WHEN 'assignee' THEN 2
                    WHEN 'mention' THEN 1
                    ELSE 0
                  END > CASE user_issues.relation
                    WHEN 'author' THEN 3
                    WHEN 'assignee' THEN 2
                    WHEN 'mention' THEN 1
                    ELSE 0
                  END THEN excluded.relation
             ELSE user_issues.relation
           END,
           last_synced_at = excluded.last_synced_at`
      )
      .run(repoId, issueNumber, login, relation, timestamp);
  }

  backfillUserIssues(login: string): void {
    const mention = `%@${login}%`;
    this.db
      .prepare(
        `INSERT INTO user_issues (repo_id, issue_number, github_user_login, relation, last_synced_at)
         SELECT
           i.repo_id,
           i.number,
           ?,
           CASE
             WHEN lower(i.author_login) = lower(?) THEN 'author'
             WHEN lower(',' || COALESCE(i.assignee_logins, '') || ',') LIKE '%,' || lower(?) || ',%' THEN 'assignee'
             ELSE 'mention'
           END,
           COALESCE(i.last_synced_at, ?)
         FROM issues i
         WHERE i.is_pull_request = 0
           AND (
             lower(i.author_login) = lower(?)
             OR lower(',' || COALESCE(i.assignee_logins, '') || ',') LIKE '%,' || lower(?) || ',%'
             OR i.body LIKE ?
           )
         ON CONFLICT(repo_id, issue_number, github_user_login)
         DO UPDATE SET
           relation = excluded.relation,
           last_synced_at = excluded.last_synced_at`
      )
      .run(login, login, login, nowIso(), login, login, mention);
  }

  hasUserIssueRelations(login: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM user_issues WHERE github_user_login = ? LIMIT 1").get(login) as unknown;
    return Boolean(row);
  }

  listPullRequests(repoId: string): PullRequestSummary[] {
    const sqlStart = performance.now();
    const rows = this.db
      .prepare(`${pullRequestSelect} WHERE p.repo_id = ? ORDER BY p.updated_at DESC, p.number DESC`)
      .all(repoId) as Record<string, unknown>[];
    const sqlMs = performance.now() - sqlStart;
    const mapStart = performance.now();
    const prs = rows.map(mapPullRequest);
    logDbListTiming("prs:list", rows.length, sqlMs, performance.now() - mapStart);
    return prs;
  }

  listPullRequestsMissingDiffCache(repoId: string, limit: number): PullRequestDiffCacheTarget[] {
    const rows = this.db
      .prepare(
        `SELECT p.number, p.base_sha, p.head_sha, p.base_branch, p.head_branch
         FROM pull_requests p
         LEFT JOIN github_page_cache cache
           ON cache.repo_id = p.repo_id
          AND cache.cache_key = CASE
                WHEN p.head_sha IS NOT NULL AND p.head_sha != ''
                  THEN 'pull:' || p.number || ':diff:' || p.head_sha
                ELSE 'pull:' || p.number || ':diff'
              END
         WHERE p.repo_id = ?
           AND p.state = 'open'
           AND cache.cache_key IS NULL
         ORDER BY p.updated_at DESC, p.number DESC
         LIMIT ?`
      )
      .all(repoId, Math.max(0, limit)) as Record<string, unknown>[];

    return rows.map((row) => ({
      number: Number(row.number),
      baseSha: nullableString(row.base_sha),
      headSha: nullableString(row.head_sha),
      baseBranch: nullableString(row.base_branch),
      headBranch: nullableString(row.head_branch)
    }));
  }

  listUserPullRequests(login?: string | null, options: { activeOnly?: boolean } = {}): PullRequestSummary[] {
    const accountLogin = login ?? this.getGitHubAccount()?.login;
    if (!accountLogin) return [];
    const rawAccountId = this.getGitHubAccount()?.id ?? null;
    const accountId = rawAccountId && !this.useLegacyUnscopedRepoVisibility(rawAccountId) ? rawAccountId : null;
    const activeClause = options.activeOnly ? "AND p.state = 'open' AND p.merged = 0 AND p.closed_at IS NULL AND p.merged_at IS NULL" : "";

    const sqlStart = performance.now();
    const rows = this.db
      .prepare(
        `${pullRequestSelect}
           LEFT JOIN user_pull_requests upr
             ON upr.repo_id = p.repo_id
            AND upr.pr_number = p.number
            AND upr.github_user_login = ?
           ${accountId ? "INNER JOIN repo_accounts ra ON ra.repo_id = p.repo_id AND ra.account_id = ? AND ra.watch_enabled = 1" : ""}
           WHERE (
                upr.relation IN ('author', 'assignee', 'reviewer', 'reviewed')
              OR lower(p.author_login) = lower(?)
              OR lower(',' || COALESCE(p.assignee_logins, '') || ',') LIKE '%,' || lower(?) || ',%'
              OR lower(',' || COALESCE(p.requested_reviewer_logins, '') || ',') LIKE '%,' || lower(?) || ',%'
              OR EXISTS (
                SELECT 1
                FROM reviews rv
                WHERE rv.repo_id = p.repo_id
                  AND rv.pr_number = p.number
                  AND lower(rv.author_login) = lower(?)
              )
           )
           ${activeClause}
           ORDER BY p.updated_at DESC, p.number DESC`
      )
      .all(
        ...(accountId
          ? [accountLogin, accountId, accountLogin, accountLogin, accountLogin, accountLogin]
          : [accountLogin, accountLogin, accountLogin, accountLogin, accountLogin])
      ) as Record<string, unknown>[];
    const sqlMs = performance.now() - sqlStart;
    const mapStart = performance.now();
    const prs = rows.map(mapPullRequest);
    logDbListTiming("prs:list-mine", rows.length, sqlMs, performance.now() - mapStart, { activeOnly: options.activeOnly ? 1 : 0 });
    return prs;
  }

  getPullRequest(repoId: string, number: number): PullRequestDetail | null {
    const pr = this.db.prepare(`${pullRequestSelect} WHERE p.repo_id = ? AND p.number = ?`).get(repoId, number) as
      | Record<string, unknown>
      | undefined;
    if (!pr) {
      return null;
    }
    return {
      ...mapPullRequest(pr),
      comments: this.listComments(repoId, "pull_request", number),
      reviews: this.listReviews(repoId, number),
      reviewComments: this.listComments(repoId, "review_comment", number),
      checkRuns: this.listCheckRuns(repoId, nullableString(pr.head_sha))
    };
  }

  listIssues(repoId: string, options: IssueListInput = {}): IssueSummary[] {
    const limit = normalizeListLimit(options.limit, 250, 2_000);
    const offset = normalizeListOffset(options.offset);
    const stateClause = issueStateClause(options.state);
    const args: Array<string | number> = [repoId];
    if (stateClause) args.push(options.state!);
    args.push(limit, offset);
    const sqlStart = performance.now();
    const rows = this.db
      .prepare(
        `${issueSelect} WHERE i.repo_id = ? AND i.is_pull_request = 0 ${stateClause} ORDER BY i.updated_at DESC, i.number DESC LIMIT ? OFFSET ?`
      )
      .all(...args) as Record<string, unknown>[];
    const sqlMs = performance.now() - sqlStart;
    const mapStart = performance.now();
    const issues = rows.map(mapIssue);
    logDbListTiming("issues:list", rows.length, sqlMs, performance.now() - mapStart, { limit, offset, state: options.state ?? "all" });
    return issues;
  }

  listIssueTypes(repoId: string): string[] {
    if (!tableExists(this.db, "issue_types")) return this.listIssueTypesFromIssues(repoId);
    const rows = this.db
      .prepare(
        `SELECT name
         FROM issue_types
         WHERE repo_id = ?
         ORDER BY lower(name) ASC`
      )
      .all(repoId) as Array<{ name: string }>;
    return rows.map((row) => row.name);
  }

  listIssueFieldOptions(repoId: string, fieldNames: string[] = ["priority", "effort"]): Record<string, string[]> {
    if (!tableExists(this.db, "issue_field_options")) return {};
    const normalized = uniqueNormalizedValues(fieldNames);
    if (normalized.length === 0) return {};
    const placeholders = normalized.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT field_name, option_name
         FROM issue_field_options
         WHERE repo_id = ?
           AND lower(field_name) IN (${placeholders})
         ORDER BY lower(field_name) ASC, lower(option_name) ASC`
      )
      .all(repoId, ...normalized) as Array<{ field_name: string; option_name: string }>;
    const options: Record<string, string[]> = {};
    for (const row of rows) {
      const fieldName = row.field_name.toLowerCase();
      options[fieldName] = [...(options[fieldName] ?? []), row.option_name];
    }
    return options;
  }

  private listIssueTypesFromIssues(repoId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT issue_type_name AS name
         FROM issues
         WHERE repo_id = ?
           AND issue_type_name IS NOT NULL
           AND issue_type_name != ''
         ORDER BY lower(issue_type_name) ASC`
      )
      .all(repoId) as Array<{ name: string }>;
    return rows.map((row) => row.name);
  }

  countIssues(repoId: string, options: Pick<IssueListInput, "state"> = {}): number {
    const startedAt = performance.now();
    const stateClause = issueStateClause(options.state);
    const args: string[] = [repoId];
    if (stateClause) args.push(options.state!);
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM issues i WHERE i.repo_id = ? AND i.is_pull_request = 0 ${stateClause}`)
      .get(...args) as { count: number } | undefined;
    const count = Number(row?.count ?? 0);
    logDbTiming("issues:count", performance.now() - startedAt, { count, state: options.state ?? "all" });
    return count;
  }

  listUserIssues(login?: string | null, options: { activeOnly?: boolean; limit?: number } = {}): IssueSummary[] {
    const accountLogin = login ?? this.getGitHubAccount()?.login;
    if (!accountLogin) return [];
    const rawAccountId = this.getGitHubAccount()?.id ?? null;
    const accountId = rawAccountId && !this.useLegacyUnscopedRepoVisibility(rawAccountId) ? rawAccountId : null;
    const activeClause = options.activeOnly ? "AND i.state = 'open' AND i.closed_at IS NULL" : "";
    const limit = Math.max(1, Math.min(options.limit ?? 250, 500));
    if (!this.hasUserIssueRelations(accountLogin)) {
      const backfillStart = performance.now();
      this.backfillUserIssues(accountLogin);
      const backfillMs = Math.round(performance.now() - backfillStart);
      if (backfillMs >= 50) console.warn(`[perf] user issues relation backfill: ${backfillMs}ms`);
    }

    const sqlStart = performance.now();
    const rows = this.db
      .prepare(
        `${issueSelect}
         INNER JOIN user_issues ui
           ON ui.repo_id = i.repo_id
          AND ui.issue_number = i.number
          AND ui.github_user_login = ?
         ${accountId ? "INNER JOIN repo_accounts ra ON ra.repo_id = i.repo_id AND ra.account_id = ? AND ra.watch_enabled = 1" : ""}
         WHERE i.is_pull_request = 0
         ${activeClause}
         ORDER BY i.updated_at DESC, i.number DESC
         LIMIT ?`
      )
      .all(...(accountId ? [accountLogin, accountId, limit] : [accountLogin, limit])) as Record<string, unknown>[];
    const sqlMs = performance.now() - sqlStart;
    const mapStart = performance.now();
    const issues = rows.map(mapIssue);
    logDbListTiming("issues:list-mine", rows.length, sqlMs, performance.now() - mapStart);
    return issues;
  }

  getIssue(repoId: string, number: number): IssueDetail | null {
    const issue = this.db.prepare(`${issueSelect} WHERE i.repo_id = ? AND i.number = ?`).get(repoId, number) as
      | Record<string, unknown>
      | undefined;
    if (!issue) {
      return null;
    }
    return {
      ...mapIssue(issue),
      comments: this.listComments(repoId, "issue", number)
    };
  }

  listRecentComments(repoId: string): TimelineComment[] {
    return (
      this.db
        .prepare(
          `SELECT *
           FROM comments
           WHERE repo_id = ?
           ORDER BY updated_at DESC, created_at DESC
           LIMIT 20`
        )
        .all(repoId) as Record<string, unknown>[]
    ).map(mapComment);
  }

  listActionChecks(repoId: string): ActionCheckSummary[] {
    const sqlStart = performance.now();
    const rows = this.db
      .prepare(
        `WITH pr_heads AS (
           SELECT repo_id, head_sha, MIN(number) AS number
           FROM pull_requests
           WHERE repo_id = ? AND head_sha IS NOT NULL
           GROUP BY repo_id, head_sha
         )
         SELECT
             cr.id,
             cr.repo_id,
             r.full_name AS repo_full_name,
             'check_run' AS kind,
             cr.name,
             cr.status,
             cr.conclusion,
             CASE
               WHEN cr.conclusion IN ('success', 'neutral', 'skipped') THEN 'passing'
               WHEN cr.conclusion IS NOT NULL THEN 'failing'
               WHEN cr.status IN ('queued', 'in_progress', 'waiting', 'requested', 'pending') THEN 'pending'
               ELSE 'unknown'
             END AS state,
             CASE
               WHEN cr.conclusion IS NOT NULL AND cr.conclusion NOT IN ('success', 'neutral', 'skipped') THEN 0
               WHEN cr.conclusion IS NULL AND cr.status IN ('queued', 'in_progress', 'waiting', 'requested', 'pending') THEN 1
               WHEN cr.conclusion IS NULL THEN 2
               ELSE 3
             END AS sort_rank,
             p.head_branch AS branch,
             cr.commit_sha,
             COALESCE(cr.pr_number, p.number) AS pr_number,
             p.title AS pr_title,
             cr.html_url,
             cr.details_url,
             NULL AS target_url,
             NULL AS description,
             cr.started_at,
             cr.completed_at,
             COALESCE(cr.completed_at, cr.started_at, cr.last_synced_at) AS updated_at,
             cr.last_synced_at
           FROM check_runs cr
           LEFT JOIN repos r ON r.id = cr.repo_id
           LEFT JOIN pr_heads ph
             ON ph.repo_id = cr.repo_id
            AND ph.head_sha = cr.commit_sha
           LEFT JOIN pull_requests p
             ON p.repo_id = cr.repo_id
            AND p.number = COALESCE(cr.pr_number, ph.number)
           WHERE cr.repo_id = ?
           UNION ALL
           SELECT
             cs.id,
             cs.repo_id,
             r.full_name AS repo_full_name,
             'commit_status' AS kind,
             cs.context AS name,
             cs.state AS status,
             NULL AS conclusion,
             CASE
               WHEN cs.state = 'success' THEN 'passing'
               WHEN cs.state IN ('failure', 'error') THEN 'failing'
               WHEN cs.state = 'pending' THEN 'pending'
               ELSE 'unknown'
             END AS state,
             CASE
               WHEN cs.state IN ('failure', 'error') THEN 0
               WHEN cs.state = 'pending' THEN 1
               WHEN cs.state = 'success' THEN 3
               ELSE 2
             END AS sort_rank,
             p.head_branch AS branch,
             cs.commit_sha,
             p.number AS pr_number,
             p.title AS pr_title,
             NULL AS html_url,
             NULL AS details_url,
             cs.target_url,
             cs.description,
             NULL AS started_at,
             NULL AS completed_at,
             COALESCE(cs.updated_at, cs.created_at, cs.last_synced_at) AS updated_at,
             cs.last_synced_at
           FROM commit_statuses cs
           LEFT JOIN repos r ON r.id = cs.repo_id
           LEFT JOIN pr_heads ph
             ON ph.repo_id = cs.repo_id
            AND ph.head_sha = cs.commit_sha
           LEFT JOIN pull_requests p
             ON p.repo_id = cs.repo_id
            AND p.number = ph.number
           WHERE cs.repo_id = ?
           ORDER BY
             sort_rank,
             updated_at DESC,
             name ASC
           LIMIT 250`
      )
      .all(repoId, repoId, repoId) as Record<string, unknown>[];
    const sqlMs = performance.now() - sqlStart;
    const mapStart = performance.now();
    const checks = rows.map(mapActionCheck);
    logDbListTiming("actions:checks", rows.length, sqlMs, performance.now() - mapStart);
    return checks;
  }

  listWorkflowRuns(repoId: string): WorkflowRunSummary[] {
    const sqlStart = performance.now();
    const rows = this.db
      .prepare(
        `SELECT wr.*, r.full_name AS repo_full_name
           FROM workflow_runs wr
           LEFT JOIN repos r ON r.id = wr.repo_id
           WHERE wr.repo_id = ?
           ORDER BY COALESCE(wr.run_started_at, wr.updated_at, wr.created_at, wr.last_synced_at) DESC
           LIMIT 100`
      )
      .all(repoId) as Record<string, unknown>[];
    const sqlMs = performance.now() - sqlStart;
    const mapStart = performance.now();
    const runs = rows.map(mapWorkflowRun);
    logDbListTiming("actions:workflow-runs", rows.length, sqlMs, performance.now() - mapStart);
    return runs;
  }

  listComments(repoId: string, entityType: string, entityNumber: number): TimelineComment[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM comments
         WHERE repo_id = ? AND entity_type = ? AND entity_number = ?
         ORDER BY created_at ASC`
        )
        .all(repoId, entityType, entityNumber) as Record<string, unknown>[]
    ).map(mapComment);
  }

  listReviews(repoId: string, prNumber: number): ReviewSummary[] {
    return (
      this.db
        .prepare("SELECT * FROM reviews WHERE repo_id = ? AND pr_number = ? ORDER BY submitted_at ASC")
        .all(repoId, prNumber) as Record<string, unknown>[]
    ).map(mapReview);
  }

  listCheckRuns(repoId: string, commitSha: string | null): CheckRunSummary[] {
    if (!commitSha) {
      return [];
    }
    return (
      this.db
        .prepare("SELECT * FROM check_runs WHERE repo_id = ? AND commit_sha = ? ORDER BY completed_at DESC, name ASC")
        .all(repoId, commitSha) as Record<string, unknown>[]
    ).map(mapCheckRun);
  }
}

function uniqueNormalizedValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

function tableExists(db: { prepare(sql: string): { get(...args: unknown[]): unknown } }, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}
