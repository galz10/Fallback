import type { GitHubIssue, GitHubPullRequest } from "../github-client.js";
import type { PullRequestDiffWarmTarget } from "./repo-sync-context.js";

export function uniqueIssuesByNumber(issues: GitHubIssue[]): GitHubIssue[] {
  return uniqueByNumber(issues);
}

export function uniquePullRequestsByNumber(pullRequests: GitHubPullRequest[]): GitHubPullRequest[] {
  return uniqueByNumber(pullRequests);
}

export function prioritizePullRequests(pullRequests: GitHubPullRequest[], priorityNumbers: Set<number>): GitHubPullRequest[] {
  return [...pullRequests].sort((a, b) => Number(priorityNumbers.has(b.number)) - Number(priorityNumbers.has(a.number)));
}

export function pullRequestDiffWarmTarget(pr: GitHubPullRequest): PullRequestDiffWarmTarget {
  return {
    number: pr.number,
    baseSha: pr.base?.sha ?? null,
    headSha: pr.head?.sha ?? null,
    baseBranch: pr.base?.ref ?? null,
    headBranch: pr.head?.ref ?? null
  };
}

function uniqueByNumber<T extends { number: number }>(items: T[]): T[] {
  const seen = new Set<number>();
  const result: T[] = [];
  for (const item of items) {
    if (seen.has(item.number)) continue;
    seen.add(item.number);
    result.push(item);
  }
  return result;
}
