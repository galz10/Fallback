import type {
  GitHubCheckRunsResponse,
  GitHubComment,
  GitHubCommitStatus,
  GitHubCompareResponse,
  GitHubIssue,
  GitHubLabel,
  GitHubPullRequest,
  GitHubPullRequestCommit,
  GitHubReview
} from "../github-client.js";

export interface GitHubWorkCachePersistencePort {
  pullRequestNeedsCacheRefresh(repoId: string, pr: GitHubPullRequest): boolean;
  issueNeedsCacheRefresh(repoId: string, issue: GitHubIssue): boolean;
  transaction(work: () => void): void;
  upsertLabel(repoId: string, label: GitHubLabel): void;
  upsertPullRequest(repoId: string, pr: GitHubPullRequest): void;
  upsertIssue(repoId: string, issue: GitHubIssue): void;
  upsertEntityLabels(repoId: string, entityType: "issue" | "pull_request", entityNumber: number, labels: GitHubLabel[]): void;
}

export interface GitHubWorkUserPullRequestPersistencePort extends GitHubWorkCachePersistencePort {
  recordUserPullRequest(login: string, repoId: string, prNumber: number, relation: string): void;
}

export interface GitHubWorkIssueRelationPersistencePort extends Pick<
  GitHubWorkCachePersistencePort,
  "transaction" | "upsertIssue" | "upsertEntityLabels"
> {
  upsertComment(
    repoId: string,
    entityType: "issue" | "pull_request" | "review_comment",
    entityNumber: number,
    comment: GitHubComment
  ): void;
}

export interface GitHubWorkPullRequestRelationPersistencePort extends Pick<
  GitHubWorkCachePersistencePort,
  "transaction" | "upsertPullRequest" | "upsertEntityLabels"
> {
  upsertComment(
    repoId: string,
    entityType: "issue" | "pull_request" | "review_comment",
    entityNumber: number,
    comment: GitHubComment
  ): void;
  upsertReview(repoId: string, prNumber: number, review: GitHubReview): void;
  upsertCheckRun(repoId: string, prNumber: number, commitSha: string, checkRun: GitHubCheckRunsResponse["check_runs"][number]): void;
  upsertCommitStatus(repoId: string, commitSha: string, status: GitHubCommitStatus): void;
  upsertPullRequestCommit(repoId: string, prNumber: number, commit: GitHubPullRequestCommit): void;
  upsertCompareCache(repoId: string, baseSha: string, headSha: string, compare: GitHubCompareResponse): void;
  recordUserPullRequest(login: string, repoId: string, prNumber: number, relation: string): void;
}

export interface PersistGitHubWorkInput {
  repoId: string;
  issues: GitHubIssue[];
  pullRequests: GitHubPullRequest[];
  labels: GitHubLabel[];
}

export interface PersistedGitHubWork {
  pullRequestRefreshByNumber: Map<number, boolean>;
  issueRefreshByNumber: Map<number, boolean>;
  changedPullRequestCount: number;
  changedIssueCount: number;
}

export function persistGitHubWorkToCache(runtime: GitHubWorkCachePersistencePort, input: PersistGitHubWorkInput): PersistedGitHubWork {
  const pullRequestRefreshByNumber = new Map(
    input.pullRequests.map((pr) => [pr.number, runtime.pullRequestNeedsCacheRefresh(input.repoId, pr)])
  );
  const issueRefreshByNumber = new Map(input.issues.map((issue) => [issue.number, runtime.issueNeedsCacheRefresh(input.repoId, issue)]));
  const changedPullRequestCount = input.pullRequests.filter((pr) => pullRequestRefreshByNumber.get(pr.number)).length;
  const changedIssueCount = input.issues.filter((issue) => !issue.pull_request && issueRefreshByNumber.get(issue.number)).length;

  runtime.transaction(() => {
    for (const label of input.labels) runtime.upsertLabel(input.repoId, label);
    for (const pr of input.pullRequests) {
      if (!pullRequestRefreshByNumber.get(pr.number)) continue;
      runtime.upsertPullRequest(input.repoId, pr);
      runtime.upsertEntityLabels(input.repoId, "pull_request", pr.number, pr.labels ?? []);
    }
    for (const issue of input.issues) {
      if (!issueRefreshByNumber.get(issue.number)) continue;
      runtime.upsertIssue(input.repoId, issue);
      runtime.upsertEntityLabels(input.repoId, issue.pull_request ? "pull_request" : "issue", issue.number, issue.labels ?? []);
    }
  });

  return { pullRequestRefreshByNumber, issueRefreshByNumber, changedPullRequestCount, changedIssueCount };
}

export function persistUserPullRequestToCache(
  runtime: GitHubWorkUserPullRequestPersistencePort,
  input: { repoId: string; login: string; pullRequest: GitHubPullRequest; relation: string }
): boolean {
  const needsCacheRefresh = runtime.pullRequestNeedsCacheRefresh(input.repoId, input.pullRequest);
  runtime.transaction(() => {
    if (needsCacheRefresh) {
      runtime.upsertPullRequest(input.repoId, input.pullRequest);
      runtime.upsertEntityLabels(input.repoId, "pull_request", input.pullRequest.number, input.pullRequest.labels ?? []);
    }
    runtime.recordUserPullRequest(input.login, input.repoId, input.pullRequest.number, input.relation);
  });
  return needsCacheRefresh;
}

export function persistIssueRelationsToCache(
  runtime: GitHubWorkIssueRelationPersistencePort,
  input: { repoId: string; issue: GitHubIssue; comments: GitHubComment[] }
): void {
  runtime.transaction(() => {
    runtime.upsertIssue(input.repoId, input.issue);
    runtime.upsertEntityLabels(input.repoId, "issue", input.issue.number, input.issue.labels ?? []);
    for (const comment of input.comments) runtime.upsertComment(input.repoId, "issue", input.issue.number, comment);
  });
}

export function persistPullRequestRelationsToCache(
  runtime: GitHubWorkPullRequestRelationPersistencePort,
  input: {
    repoId: string;
    pullRequest: GitHubPullRequest;
    issueComments: GitHubComment[];
    reviews: GitHubReview[];
    reviewComments: GitHubComment[];
    checkRuns: GitHubCheckRunsResponse["check_runs"];
    statuses: GitHubCommitStatus[];
    commits: GitHubPullRequestCommit[];
    compare: GitHubCompareResponse | null;
    accountLogin: string | null;
  }
): void {
  runtime.transaction(() => {
    runtime.upsertPullRequest(input.repoId, input.pullRequest);
    runtime.upsertEntityLabels(input.repoId, "pull_request", input.pullRequest.number, input.pullRequest.labels ?? []);
    for (const comment of input.issueComments) runtime.upsertComment(input.repoId, "pull_request", input.pullRequest.number, comment);
    for (const review of input.reviews) runtime.upsertReview(input.repoId, input.pullRequest.number, review);
    if (input.accountLogin && input.reviews.some((review) => sameLogin(review.user?.login, input.accountLogin))) {
      runtime.recordUserPullRequest(input.accountLogin, input.repoId, input.pullRequest.number, "reviewed");
    }
    for (const comment of input.reviewComments) runtime.upsertComment(input.repoId, "review_comment", input.pullRequest.number, comment);
    for (const checkRun of input.checkRuns) {
      runtime.upsertCheckRun(input.repoId, input.pullRequest.number, input.pullRequest.head.sha, checkRun);
    }
    for (const status of input.statuses) runtime.upsertCommitStatus(input.repoId, input.pullRequest.head.sha, status);
    for (const commit of input.commits) runtime.upsertPullRequestCommit(input.repoId, input.pullRequest.number, commit);
    if (input.compare) runtime.upsertCompareCache(input.repoId, input.pullRequest.base.sha, input.pullRequest.head.sha, input.compare);
  });
}

function sameLogin(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}
