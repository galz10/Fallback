import type { PullRequestReviewDraft } from "../../../src/shared/domain/github-work.js";
import { emptyPullRequestReviewDraft } from "../../../src/shared/pr-review-drafts.js";
import { nowIso } from "../path-utils.js";
import { LocalCacheStoreBase } from "./store-base.js";
import { mapPullRequestReviewDraft, nullableString } from "./store-helpers.js";
import type { PullRequestReviewDraftInput } from "./store-types.js";

export class ReviewDraftStore extends LocalCacheStoreBase {
  getPullRequestReviewDraft(repoId: string, prNumber: number): PullRequestReviewDraft | null {
    const currentHeadSha = this.pullRequestHeadSha(repoId, prNumber);
    const rows = this.db
      .prepare(
        `SELECT *
         FROM pr_review_drafts
         WHERE repo_id = ? AND pr_number = ?
         ORDER BY CASE WHEN head_sha = ? THEN 0 ELSE 1 END, updated_at DESC`
      )
      .all(repoId, prNumber, currentHeadSha ?? "") as Record<string, unknown>[];
    const row = rows[0];
    return row ? mapPullRequestReviewDraft(row, currentHeadSha) : null;
  }

  upsertPullRequestReviewDraft(repoId: string, prNumber: number, input: PullRequestReviewDraftInput): PullRequestReviewDraft {
    const currentHeadSha = this.pullRequestHeadSha(repoId, prNumber);
    const headSha = input.headSha ?? currentHeadSha;
    if (!headSha) throw new Error("Cannot save a review draft before the PR head SHA is cached.");
    const existing = this.db
      .prepare("SELECT * FROM pr_review_drafts WHERE repo_id = ? AND pr_number = ? AND head_sha = ?")
      .get(repoId, prNumber, headSha) as Record<string, unknown> | undefined;
    const current = existing
      ? mapPullRequestReviewDraft(existing, currentHeadSha)
      : emptyPullRequestReviewDraft({ repoId, prNumber, headSha });
    const next: PullRequestReviewDraft = {
      ...current,
      currentHeadSha,
      outdated: currentHeadSha !== null && current.headSha !== currentHeadSha,
      event: input.event ?? current.event,
      body: input.body ?? current.body,
      comments: input.comments ?? current.comments,
      reviewedFiles: input.reviewedFiles ?? current.reviewedFiles,
      updatedAt: nowIso()
    };
    const createdAt = existing ? current.createdAt : next.updatedAt;
    this.db
      .prepare(
        `INSERT INTO pr_review_drafts (
           repo_id, pr_number, head_sha, event, body, comments_json, reviewed_files_json, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(repo_id, pr_number, head_sha) DO UPDATE SET
           event = excluded.event,
           body = excluded.body,
           comments_json = excluded.comments_json,
           reviewed_files_json = excluded.reviewed_files_json,
           updated_at = excluded.updated_at`
      )
      .run(
        repoId,
        prNumber,
        headSha,
        next.event,
        next.body,
        JSON.stringify(next.comments),
        JSON.stringify(next.reviewedFiles),
        createdAt,
        next.updatedAt
      );
    return this.getPullRequestReviewDraft(repoId, prNumber)!;
  }

  clearPullRequestReviewDraft(repoId: string, prNumber: number, headSha?: string | null): void {
    const targetHeadSha = headSha ?? this.pullRequestHeadSha(repoId, prNumber);
    if (targetHeadSha) {
      this.db
        .prepare("DELETE FROM pr_review_drafts WHERE repo_id = ? AND pr_number = ? AND head_sha = ?")
        .run(repoId, prNumber, targetHeadSha);
      return;
    }
    this.db.prepare("DELETE FROM pr_review_drafts WHERE repo_id = ? AND pr_number = ?").run(repoId, prNumber);
  }

  pullRequestHeadSha(repoId: string, prNumber: number): string | null {
    const row = this.db.prepare("SELECT head_sha FROM pull_requests WHERE repo_id = ? AND number = ?").get(repoId, prNumber) as
      | { head_sha: string | null }
      | undefined;
    return nullableString(row?.head_sha);
  }
}
