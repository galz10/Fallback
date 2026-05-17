export interface PRFilters {
  state?: "open" | "closed" | "all";
  author?: string;
  label?: string;
}

export interface IssueFilters {
  state?: "open" | "closed" | "all";
  author?: string;
  label?: string;
}

export interface IssueListInput extends IssueFilters {
  limit?: number;
  offset?: number;
}

export interface IssueListResult {
  items: IssueSummary[];
  issueTypes: string[];
  issueFieldOptions: Record<string, string[]>;
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface SearchFilters {
  repoId?: string;
  entityType?: "repo" | "pull_request" | "issue" | "comment" | "review";
  state?: string;
  author?: string;
  label?: string;
}

export interface PullRequestSummary {
  id: string;
  repoId: string;
  number: number;
  title: string;
  body: string | null;
  authorLogin: string | null;
  assigneeLogins: string[];
  requestedReviewerLogins: string[];
  state: string;
  isDraft: boolean;
  merged: boolean;
  repoFullName?: string | null;
  headSha: string | null;
  baseSha: string | null;
  baseBranch: string | null;
  headBranch: string | null;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  commitsCount: number | null;
  commentsCount: number | null;
  reviewCommentsCount: number | null;
  reviewState: string | null;
  checkState: "passing" | "failing" | "pending" | "unknown";
  checkCount: number;
  labels: string[];
  htmlUrl: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  closedAt: string | null;
  mergedAt: string | null;
  lastSyncedAt: string | null;
}

export interface IssueSummary {
  id: string;
  repoId: string;
  number: number;
  title: string;
  body: string | null;
  authorLogin: string | null;
  assigneeLogins: string[];
  state: string;
  issueTypeName?: string | null;
  repoFullName?: string | null;
  commentsCount: number | null;
  labels: string[];
  htmlUrl: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  closedAt: string | null;
  lastSyncedAt: string | null;
}

export interface TimelineComment {
  id: string;
  entityType: "issue" | "pull_request" | "review_comment";
  entityNumber: number;
  authorLogin: string | null;
  body: string | null;
  htmlUrl: string | null;
  path: string | null;
  position: number | null;
  originalPosition: number | null;
  diffHunk: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ReviewSummary {
  id: string;
  prNumber: number;
  authorLogin: string | null;
  state: string;
  body: string | null;
  htmlUrl: string | null;
  submittedAt: string | null;
}

export type PullRequestReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export interface PullRequestReviewCommentInput {
  path: string;
  body: string;
  line: number;
  side: "LEFT" | "RIGHT";
  startLine?: number;
  startSide?: "LEFT" | "RIGHT";
}

export interface PullRequestReviewDraftComment extends PullRequestReviewCommentInput {
  id: string;
  fileId: string;
  diffSide: "additions" | "deletions";
}

export interface SubmitPullRequestReviewInput {
  event: PullRequestReviewEvent;
  body?: string;
  comments?: PullRequestReviewCommentInput[];
}

export interface PullRequestReviewDraft {
  repoId: string;
  prNumber: number;
  headSha: string | null;
  currentHeadSha: string | null;
  outdated: boolean;
  event: PullRequestReviewEvent;
  body: string;
  comments: PullRequestReviewDraftComment[];
  reviewedFiles: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UpdatePullRequestReviewDraftInput {
  headSha?: string | null;
  event?: PullRequestReviewEvent;
  body?: string;
  comments?: PullRequestReviewDraftComment[];
  reviewedFiles?: string[];
}

export interface CheckRunSummary {
  id: string;
  commitSha: string;
  name: string;
  status: string | null;
  conclusion: string | null;
  htmlUrl: string | null;
  detailsUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export type ActionCheckState = "passing" | "failing" | "pending" | "unknown";

export interface ActionCheckSummary {
  id: string;
  repoId: string;
  repoFullName: string | null;
  kind: "check_run" | "commit_status";
  name: string;
  status: string | null;
  conclusion: string | null;
  state: ActionCheckState;
  branch: string | null;
  commitSha: string;
  prNumber: number | null;
  prTitle: string | null;
  htmlUrl: string | null;
  detailsUrl: string | null;
  targetUrl: string | null;
  description: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
  lastSyncedAt: string | null;
}

export interface WorkflowRunSummary {
  id: string;
  repoId: string;
  repoFullName: string | null;
  githubWorkflowRunId: number;
  workflowName: string | null;
  displayTitle: string | null;
  runNumber: number | null;
  runAttempt: number | null;
  event: string | null;
  status: string | null;
  conclusion: string | null;
  state: ActionCheckState;
  headBranch: string | null;
  headSha: string | null;
  htmlUrl: string | null;
  actorLogin: string | null;
  path: string | null;
  runStartedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastSyncedAt: string | null;
}

export interface PullRequestDetail extends PullRequestSummary {
  comments: TimelineComment[];
  reviews: ReviewSummary[];
  reviewComments: TimelineComment[];
  checkRuns: CheckRunSummary[];
}

export interface PullRequestDiff {
  repoId: string;
  number: number;
  patch: string;
  source: "local" | "github" | "cache";
  cachedAt: string | null;
  fromCache: boolean;
}

export interface IssueDetail extends IssueSummary {
  comments: TimelineComment[];
}

export interface SearchResult {
  entityId: string;
  repoId: string;
  repoFullName: string;
  entityType: "repo" | "pull_request" | "issue" | "comment" | "review";
  entityNumber: number;
  title: string | null;
  snippet: string | null;
  authorLogin: string | null;
  state: string | null;
  updatedAt: string | null;
}
