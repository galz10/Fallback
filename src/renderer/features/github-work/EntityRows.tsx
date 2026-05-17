import React from "react";
import { IssueOpenedIcon as GitHubIssueOpenedIcon, GitPullRequestIcon as GitHubPullRequestIcon } from "@primer/octicons-react";
import type { IssueSummary, PullRequestSummary } from "../../../shared/domain/github-work";
import { triageIssue, triagePullRequest } from "../../../shared/triage";
import { compactCount, formatRelative } from "../../lib/format";
import type { EntityQueryKind } from "./work-query-language";

export function PullRequestQueueRow({
  pr,
  login,
  showRepo = false,
  onClick
}: {
  pr: PullRequestSummary;
  login?: string;
  showRepo?: boolean;
  onClick: () => void;
}) {
  const triage = triagePullRequest(pr, login);
  const primaryRisk =
    pr.checkState === "failing"
      ? "Checks failing"
      : triage.reviewSignal === "changes_requested"
        ? "Changes requested"
        : triage.reviewSignal === "needs_review"
          ? "Review requested"
          : triage.attentionReason;
  const statusItems: string[] = [
    primaryRisk,
    triage.reviewSignal === "needs_review" ? "Review requested" : triage.reviewSignal === "changes_requested" ? "Changes requested" : null,
    pr.requestedReviewerLogins.length > 0 ? `${compactCount(pr.requestedReviewerLogins.length)} reviewer` : null,
    pr.assigneeLogins.length > 0 ? `${compactCount(pr.assigneeLogins.length)} assignee` : null
  ].filter((item): item is string => Boolean(item));
  return (
    <button
      type="button"
      onClick={onClick}
      className="group grid min-h-[72px] w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 px-3 py-3 text-left text-sm transition-colors hover:bg-[#090a0c] focus-visible:bg-[#090a0c] md:grid-cols-[auto_minmax(0,1fr)_minmax(180px,auto)]"
    >
      <WorkItemTypeIcon kind="pr" state={pr.merged ? "merged" : pr.state} />
      <div className="min-w-0 overflow-hidden">
        <div className="truncate text-[15px] text-neutral-200 group-hover:text-white group-focus-visible:text-white transition-colors">
          <span className="mr-3 font-mono text-neutral-600">#{pr.number}</span>
          {pr.title}
        </div>
        <WorkItemMeta repo={showRepo ? pr.repoFullName : null} updatedAt={pr.updatedAt} />
      </div>
      <div className="col-start-2 flex min-w-0 flex-wrap items-center gap-2 text-xs md:col-start-auto md:justify-end">
        {primaryRisk && <WorkRiskBadge>{primaryRisk}</WorkRiskBadge>}
        {statusItems
          .filter((item) => item !== primaryRisk)
          .slice(0, 2)
          .map((item) => (
            <span key={item} className="text-neutral-500">
              {item}
            </span>
          ))}
      </div>
    </button>
  );
}

export function IssueQueueRow({
  issue,
  login,
  showRepo = false,
  onClick
}: {
  issue: IssueSummary;
  login?: string;
  showRepo?: boolean;
  onClick: () => void;
}) {
  const triage = triageIssue(issue, login);
  return (
    <button
      type="button"
      onClick={onClick}
      className="group grid min-h-[72px] w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 px-3 py-3 text-left text-sm transition-colors hover:bg-[#090a0c] focus-visible:bg-[#090a0c] md:grid-cols-[auto_minmax(0,1fr)_minmax(160px,auto)]"
    >
      <WorkItemTypeIcon kind="issue" state={issue.state} />
      <div className="min-w-0 overflow-hidden">
        <div className="truncate text-[15px] text-neutral-200 group-hover:text-white group-focus-visible:text-white transition-colors">
          <span className="mr-3 font-mono text-neutral-600">#{issue.number}</span>
          {issue.title}
        </div>
        <WorkItemMeta repo={showRepo ? issue.repoFullName : null} updatedAt={issue.updatedAt} />
      </div>
      <div className="col-start-2 flex min-w-0 flex-wrap items-center gap-2 text-xs md:col-start-auto md:justify-end">
        {triage.attentionReason && <WorkRiskBadge>{triage.attentionReason}</WorkRiskBadge>}
        {issue.assigneeLogins.length > 0 && <span className="text-neutral-500">{compactCount(issue.assigneeLogins.length)} assignee</span>}
      </div>
    </button>
  );
}

function WorkItemTypeIcon({ kind, state = "open" }: { kind: EntityQueryKind; state?: string }) {
  const iconClass = kind === "pr" ? "text-purple-900" : state === "closed" ? "text-red-900" : "text-green-900";
  return (
    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center" title={kind === "pr" ? "Pull request" : "Issue"}>
      {kind === "pr" ? (
        <GitHubPullRequestIcon className={`h-3.5 w-3.5 ${iconClass}`} />
      ) : (
        <GitHubIssueOpenedIcon className={`h-3.5 w-3.5 ${iconClass}`} />
      )}
    </span>
  );
}

function WorkRiskBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center rounded border border-neutral-800 bg-neutral-950 px-1.5 py-0.5 text-[11px] font-medium text-neutral-300">
      <span className="truncate">{children}</span>
    </span>
  );
}

function WorkItemMeta({ repo, updatedAt }: { repo?: string | null; updatedAt: string | null }) {
  return (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
      {repo && (
        <>
          <span className="max-w-[220px] truncate">{repo}</span>
          <span className="text-neutral-700" aria-hidden="true">
            ·
          </span>
        </>
      )}
      <span className="whitespace-nowrap">{updatedAt ? `updated ${formatRelative(updatedAt)}` : "update unknown"}</span>
    </div>
  );
}

export function LabelChips({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
      {labels.slice(0, 3).map((label) => (
        <span key={label} className="inline-flex items-center gap-1 text-[12px] text-neutral-500">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: labelColor(label) }} />
          {label}
        </span>
      ))}
      {labels.length > 3 && <span className="text-[12px] text-neutral-600">+{labels.length - 3}</span>}
    </div>
  );
}

export function checkTone(state: PullRequestSummary["checkState"]): "good" | "bad" | "warn" | "neutral" {
  if (state === "passing") return "good";
  if (state === "failing") return "bad";
  if (state === "pending") return "warn";
  return "neutral";
}

export function checkLabel(state: PullRequestSummary["checkState"], count: number): string {
  if (state === "passing") return count > 0 ? `Checks passing ${compactCount(count)}` : "Checks passing";
  if (state === "failing") return "Checks failing";
  if (state === "pending") return "Checks pending";
  return "Checks unknown";
}

export function reviewTone(signal: ReturnType<typeof triagePullRequest>["reviewSignal"]): "good" | "bad" | "warn" | "neutral" {
  if (signal === "approved") return "good";
  if (signal === "changes_requested") return "bad";
  if (signal === "needs_review" || signal === "pending") return "warn";
  return "neutral";
}

export function reviewLabel(signal: ReturnType<typeof triagePullRequest>["reviewSignal"]): string {
  if (signal === "needs_review") return "Review requested";
  if (signal === "changes_requested") return "Changes requested";
  if (signal === "approved") return "Approved";
  if (signal === "commented") return "Reviewed";
  if (signal === "pending") return "Review pending";
  return "No review";
}

function labelColor(label: string): string {
  let hash = 0;
  for (const char of label) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue} 55% 48%)`;
}

/* ---- PR Detail View ---- */
