import type {
  PullRequestReviewCommentInput,
  PullRequestReviewDraft,
  PullRequestReviewDraftComment,
  PullRequestReviewEvent,
  SubmitPullRequestReviewInput
} from "./domain/github-work.js";

export interface ReviewSubmitState {
  canSubmit: boolean;
  message: string;
  tone: "neutral" | "warning" | "danger";
}

export function emptyPullRequestReviewDraft(input: { repoId: string; prNumber: number; headSha: string | null }): PullRequestReviewDraft {
  const now = new Date(0).toISOString();
  return {
    repoId: input.repoId,
    prNumber: input.prNumber,
    headSha: input.headSha,
    currentHeadSha: input.headSha,
    outdated: false,
    event: "COMMENT",
    body: "",
    comments: [],
    reviewedFiles: [],
    createdAt: now,
    updatedAt: now
  };
}

export function reviewDraftCommentCount(draft: Pick<PullRequestReviewDraft, "comments"> | null | undefined): number {
  return draft?.comments.filter((comment) => comment.body.trim()).length ?? 0;
}

export function reviewDraftHasContent(draft: Pick<PullRequestReviewDraft, "body" | "comments" | "reviewedFiles">): boolean {
  return Boolean(draft.body.trim() || reviewDraftCommentCount(draft) > 0 || draft.reviewedFiles.length > 0);
}

export function reviewSubmitPayload(draft: PullRequestReviewDraft): SubmitPullRequestReviewInput {
  const body = draft.body.trim();
  const comments = draft.comments
    .map(reviewDraftCommentPayload)
    .filter((comment): comment is PullRequestReviewCommentInput => Boolean(comment));
  return {
    event: draft.event,
    ...(body ? { body } : {}),
    ...(comments.length > 0 ? { comments } : {})
  };
}

export function reviewSubmitState(input: {
  draft: PullRequestReviewDraft;
  connected: boolean;
  online: boolean;
  queueWhenUnavailable?: boolean;
  pending?: boolean;
  canWrite?: boolean;
  writeBlockReason?: string | null;
}): ReviewSubmitState {
  if (input.pending) return { canSubmit: false, message: "Submitting review to GitHub...", tone: "neutral" };
  if (!input.connected) return { canSubmit: false, message: "Connect GitHub to submit a review.", tone: "warning" };
  if (!input.online && !input.queueWhenUnavailable)
    return { canSubmit: false, message: "Offline. Reconnect before submitting a review.", tone: "warning" };
  if (input.canWrite === false)
    return {
      canSubmit: false,
      message: input.writeBlockReason ?? "This account cannot write reviews on this repository.",
      tone: "danger"
    };
  if (input.draft.outdated) {
    return {
      canSubmit: false,
      message: "Draft is from an older PR head. Discard it, refresh the PR, then rebuild the review on the latest diff.",
      tone: "warning"
    };
  }
  const commentCount = reviewDraftCommentCount(input.draft);
  const hasBody = Boolean(input.draft.body.trim());
  if ((input.draft.event === "COMMENT" || input.draft.event === "REQUEST_CHANGES") && !hasBody && commentCount === 0) {
    return {
      canSubmit: false,
      message:
        input.draft.event === "REQUEST_CHANGES" ? "Request changes needs a summary or inline comment." : "Add a comment before submitting.",
      tone: "neutral"
    };
  }
  return {
    canSubmit: true,
    message: input.online ? reviewSubmitReadyMessage(input.draft.event, commentCount) : "Offline. Review will be queued locally.",
    tone: input.online ? "neutral" : "warning"
  };
}

export function reviewFailureCopy(errorMessage: string): string {
  if (/rate limit|secondary rate|abuse/i.test(errorMessage)) {
    return "GitHub rate limited this review. Wait for the limit to reset, then submit the saved draft again.";
  }
  if (/403|permission|forbidden|resource not accessible|sso|scope/i.test(errorMessage)) {
    return "GitHub rejected review permissions. Check account access, token scopes, or organization SSO, then retry.";
  }
  if (/offline|network|fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(errorMessage)) {
    return "Network failed while submitting. Your draft is still saved locally.";
  }
  return errorMessage;
}

export function upsertReviewDraftComment(
  comments: PullRequestReviewDraftComment[],
  comment: PullRequestReviewDraftComment
): PullRequestReviewDraftComment[] {
  const existingIndex = comments.findIndex((item) => item.id === comment.id);
  if (existingIndex < 0) return [...comments, comment];
  return comments.map((item, index) => (index === existingIndex ? comment : item));
}

export function removeReviewDraftComment(comments: PullRequestReviewDraftComment[], id: string): PullRequestReviewDraftComment[] {
  return comments.filter((comment) => comment.id !== id);
}

function reviewDraftCommentPayload(comment: PullRequestReviewDraftComment): PullRequestReviewCommentInput | null {
  const body = comment.body.trim();
  if (!body) return null;
  return {
    path: comment.path,
    body,
    line: comment.line,
    side: comment.side,
    ...(comment.startLine ? { startLine: comment.startLine } : {}),
    ...(comment.startSide ? { startSide: comment.startSide } : {})
  };
}

function reviewSubmitReadyMessage(event: PullRequestReviewEvent, commentCount: number): string {
  const comments = commentCount === 1 ? "1 inline comment" : `${commentCount} inline comments`;
  if (event === "APPROVE") return commentCount > 0 ? `Ready to approve with ${comments}.` : "Ready to approve.";
  if (event === "REQUEST_CHANGES") return commentCount > 0 ? `Ready to request changes with ${comments}.` : "Ready to request changes.";
  return commentCount > 0 ? `Ready to submit ${comments}.` : "Ready to comment.";
}
