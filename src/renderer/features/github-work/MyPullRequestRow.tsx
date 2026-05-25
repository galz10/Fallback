import { GitPullRequestIcon as GitHubPullRequestIcon } from "@primer/octicons-react";
import type { PullRequestSummary } from "../../../shared/domain/github-work";
import { compactCount, formatRelative } from "../../lib/format";

export function MyPullRequestRow({ pr, onClick }: { pr: PullRequestSummary; onClick: () => void }) {
  const status = myPullRequestStatus(pr);
  return (
    <div className="group grid min-h-[76px] grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 border-b border-white/[0.06] px-4 py-3.5 text-left text-sm transition-colors last:border-b-0 hover:bg-white/[0.025] md:grid-cols-[auto_minmax(0,1fr)_minmax(190px,auto)]">
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center" title="Pull request">
        <GitHubPullRequestIcon className="h-3.5 w-3.5 text-purple-900" />
      </span>
      <div className="min-w-0 overflow-hidden">
        <button type="button" onClick={onClick} className="block w-full min-w-0 text-left">
          <div className="truncate text-[14px] font-medium leading-5 text-neutral-200 transition-colors group-hover:text-neutral-50">
            <span className="mr-2.5 font-mono font-normal text-neutral-500">#{pr.number}</span>
            {pr.title}
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-5 text-neutral-500">
            {pr.repoFullName && <span className="max-w-[240px] truncate font-medium text-neutral-500">{pr.repoFullName}</span>}
            {pr.repoFullName && (
              <span className="text-neutral-700" aria-hidden="true">
                -
              </span>
            )}
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${status.className}`}>{status.label}</span>
            <span className="text-neutral-700" aria-hidden="true">
              -
            </span>
            <span>{pr.updatedAt ? formatRelative(pr.updatedAt) : "Update unknown"}</span>
          </div>
          <div className="mt-0.5 truncate text-[12px] leading-5 text-neutral-600">{myPullRequestPreview(pr)}</div>
          <div className="truncate text-[12px] leading-5 text-neutral-700">{myPullRequestDetail(pr)}</div>
        </button>
      </div>
      <div className="col-start-2 flex min-w-0 flex-wrap items-center gap-1 text-xs md:col-start-auto md:justify-end">
        <button
          type="button"
          onClick={onClick}
          className="rounded-md px-2 py-1 text-[12px] font-medium text-neutral-400 transition-colors hover:bg-white/[0.06] hover:text-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-600"
        >
          Open
        </button>
      </div>
    </div>
  );
}

function myPullRequestPreview(pr: PullRequestSummary): string {
  const stats = [
    pr.checkState === "failing"
      ? "Checks failing"
      : pr.checkState === "pending"
        ? "Checks pending"
        : pr.checkState === "passing"
          ? "Checks passing"
          : null,
    pr.reviewState ? reviewStateLabel(pr.reviewState) : null,
    pr.changedFiles != null ? `${compactCount(pr.changedFiles)} changed files` : null
  ].filter((item): item is string => Boolean(item));
  return stats.length > 0 ? stats.join(" - ") : "No review or check signal cached";
}

function myPullRequestDetail(pr: PullRequestSummary): string {
  const parts = [
    pr.headBranch && pr.baseBranch ? `${pr.headBranch} into ${pr.baseBranch}` : pr.headBranch || pr.baseBranch,
    pr.commentsCount != null || pr.reviewCommentsCount != null
      ? `${compactCount((pr.commentsCount ?? 0) + (pr.reviewCommentsCount ?? 0))} comments`
      : null
  ].filter((item): item is string => Boolean(item));
  return parts.length > 0 ? parts.join(" - ") : "Authored by you";
}

function reviewStateLabel(value: string): string {
  if (value === "changes requested") return "Changes requested";
  if (value === "approved") return "Approved";
  if (value === "reviewed") return "Reviewed";
  return value;
}

function myPullRequestStatus(pr: PullRequestSummary): { label: string; className: string } {
  if (pr.merged) return { label: "Merged", className: "bg-purple-500/10 text-purple-300" };
  if (pr.state === "closed") return { label: "Closed", className: "bg-red-500/10 text-red-300" };
  if (pr.isDraft) return { label: "Draft", className: "bg-white/[0.06] text-neutral-400" };
  if (pr.checkState === "failing") return { label: "Checks failing", className: "bg-red-500/10 text-red-300" };
  if (pr.checkState === "pending") return { label: "Checks pending", className: "bg-amber-500/10 text-amber-300" };
  return { label: "Open", className: "bg-green-500/10 text-green-300" };
}
