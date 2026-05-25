import type { PullRequestSummary } from "../../../shared/domain/github-work";

export function filterMyPullRequests(pullRequests: PullRequestSummary[], login?: string): PullRequestSummary[] {
  return pullRequests.filter((pr) => sameLogin(pr.authorLogin, login) && !pr.merged).sort(byUpdatedDesc);
}

export function myPullRequestKey(pr: Pick<PullRequestSummary, "repoId" | "number">): string {
  return `${pr.repoId}:${pr.number}`;
}

export function myPullRequestStatusCounts(pullRequests: PullRequestSummary[]): {
  open: number;
  draft: number;
  closed: number;
} {
  return pullRequests.reduce(
    (counts, pr) => {
      if (pr.state === "closed") counts.closed += 1;
      else if (pr.isDraft) counts.draft += 1;
      else counts.open += 1;
      return counts;
    },
    { open: 0, draft: 0, closed: 0 }
  );
}

function sameLogin(value: string | null | undefined, login?: string): boolean {
  return Boolean(value && login && value.toLowerCase() === login.toLowerCase());
}

function byUpdatedDesc(a: { updatedAt: string | null }, b: { updatedAt: string | null }): number {
  return timestamp(b.updatedAt) - timestamp(a.updatedAt);
}

function timestamp(value: string | null): number {
  return value ? Date.parse(value) : 0;
}
