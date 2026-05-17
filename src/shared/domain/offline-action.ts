import type { PullRequestReviewCommentInput, PullRequestReviewEvent } from "./github-work.js";

export type OfflineActionType = "issue_comment" | "pr_comment" | "pr_review";
export type OfflineActionEntityType = "issue" | "pull_request";
export type OfflineActionStatus = "queued" | "sending" | "failed_retryable" | "blocked" | "sent" | "cancelled";
export type OfflineActionQueueReason = "offline" | "github_unavailable" | "rate_limited" | "network_error";
export type OfflineActionFailureKind = "retryable" | "blocked";

export interface IssueCommentOfflinePayload {
  actionType: "issue_comment";
  body: string;
}

export interface PullRequestCommentOfflinePayload {
  actionType: "pr_comment";
  body: string;
}

export interface PullRequestReviewOfflinePayload {
  actionType: "pr_review";
  event: PullRequestReviewEvent;
  body?: string;
  comments?: PullRequestReviewCommentInput[];
  headSha: string | null;
}

export type OfflineActionPayload = IssueCommentOfflinePayload | PullRequestCommentOfflinePayload | PullRequestReviewOfflinePayload;

export interface OfflineAction {
  id: string;
  accountId: string | null;
  repoId: string;
  repoFullName: string | null;
  actionType: OfflineActionType;
  entityType: OfflineActionEntityType;
  entityNumber: number;
  title: string | null;
  body: string;
  payload: OfflineActionPayload;
  status: OfflineActionStatus;
  priority: number;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  postedAt: string | null;
  lastErrorCode: string | null;
  lastError: string | null;
  upstreamLastSeenSha: string | null;
  upstreamLastSeenUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOfflineActionInput {
  repoId: string;
  actionType: OfflineActionType;
  entityType: OfflineActionEntityType;
  entityNumber: number;
  title?: string | null;
  body: string;
  payload: OfflineActionPayload;
  priority?: number;
  upstreamLastSeenSha?: string | null;
  upstreamLastSeenUpdatedAt?: string | null;
  nextAttemptAt?: string | null;
  lastErrorCode?: string | null;
  lastError?: string | null;
}

export interface UpdateOfflineActionInput {
  body?: string;
  payload?: OfflineActionPayload;
  title?: string | null;
}

export interface OfflineActionListInput {
  repoId?: string | null;
  entityType?: OfflineActionEntityType | null;
  entityNumber?: number | null;
  includeCompleted?: boolean;
}

export interface OfflineActionQueueSummary {
  queued: number;
  sending: number;
  retryable: number;
  blocked: number;
  sent: number;
  cancelled: number;
  active: number;
  nextAttemptAt: string | null;
}

export function offlineActionTitle(action: Pick<OfflineAction, "title" | "actionType" | "entityNumber">): string {
  return action.title ?? `${offlineActionLabel(action.actionType)} #${action.entityNumber}`;
}

export type WritebackSubmitResult = { mode: "sent" } | { mode: "queued"; action: OfflineAction; reason: OfflineActionQueueReason };

export function offlineActionIsActive(status: OfflineActionStatus): boolean {
  return status === "queued" || status === "sending" || status === "failed_retryable" || status === "blocked";
}

export function offlineActionCanEdit(action: Pick<OfflineAction, "status">): boolean {
  return action.status === "queued" || action.status === "failed_retryable" || action.status === "blocked";
}

export function offlineActionCanRetry(action: Pick<OfflineAction, "status">): boolean {
  return action.status === "queued" || action.status === "failed_retryable";
}

export function offlineActionLabel(actionType: OfflineActionType): string {
  if (actionType === "issue_comment") return "Issue comment";
  if (actionType === "pr_comment") return "PR comment";
  return "PR review";
}

export function offlineActionRequiredSurfaces(actionType: OfflineActionType): string[] {
  if (actionType === "issue_comment") return ["rest_api", "issues", "comments"];
  return ["rest_api", "pull_requests", "comments"];
}

export function offlineActionPreview(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, 180);
}
