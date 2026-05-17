import type { GitHubClient, GitHubComment, GitHubReview } from "../github-client.js";
import type { SubmitPullRequestReviewInput } from "../../../src/shared/domain/github-work.js";

export interface GitHubWorkWritebackContext {
  path: string;
}

export interface GitHubWorkWritebackDependencies {
  github: GitHubClient;
  repoSyncContext(repoId: string): GitHubWorkWritebackContext;
  upsertComment(repoId: string, kind: "issue" | "pull_request", number: number, comment: GitHubComment): void;
  upsertReview(repoId: string, prNumber: number, review: GitHubReview): void;
}

export class GitHubWorkWriteback {
  constructor(private readonly dependencies: GitHubWorkWritebackDependencies) {}

  async addIssueComment(repoId: string, number: number, body: string): Promise<void> {
    const trimmedBody = body.trim();
    if (!trimmedBody) throw new Error("Comment body is required.");
    const { path } = this.dependencies.repoSyncContext(repoId);
    const comment = await this.dependencies.github.post<GitHubComment>(`${path}/issues/${number}/comments`, { body: trimmedBody });
    this.dependencies.upsertComment(repoId, "issue", number, comment);
  }

  async addPullRequestComment(repoId: string, number: number, body: string): Promise<void> {
    const trimmedBody = body.trim();
    if (!trimmedBody) throw new Error("Comment body is required.");
    const { path } = this.dependencies.repoSyncContext(repoId);
    const comment = await this.dependencies.github.post<GitHubComment>(`${path}/issues/${number}/comments`, { body: trimmedBody });
    this.dependencies.upsertComment(repoId, "pull_request", number, comment);
  }

  async submitPullRequestReview(repoId: string, number: number, input: SubmitPullRequestReviewInput): Promise<void> {
    const event = input.event;
    if (!["APPROVE", "REQUEST_CHANGES", "COMMENT"].includes(event)) throw new Error("Unsupported PR review event.");
    const body = input.body?.trim() ?? "";
    const comments = input.comments?.map((comment) => ({
      path: comment.path,
      body: comment.body.trim(),
      line: comment.line,
      side: comment.side,
      ...(comment.startLine ? { start_line: comment.startLine } : {}),
      ...(comment.startSide ? { start_side: comment.startSide } : {})
    }));
    if (comments?.some((comment) => !comment.body)) throw new Error("Inline review comments require a message.");
    if ((event === "REQUEST_CHANGES" || event === "COMMENT") && !body && (!comments || comments.length === 0)) {
      throw new Error(event === "REQUEST_CHANGES" ? "Request changes requires a message." : "Review comment body is required.");
    }

    const { path } = this.dependencies.repoSyncContext(repoId);
    const review = await this.dependencies.github.post<GitHubReview>(`${path}/pulls/${number}/reviews`, {
      event,
      ...(body ? { body } : {}),
      ...(comments && comments.length > 0 ? { comments } : {})
    });
    this.dependencies.upsertReview(repoId, number, review);
  }
}
