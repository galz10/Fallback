import type { IssueSummary, PullRequestSummary } from "./domain/github-work.js";

export type PullRequestTriagePreset =
  | "all_open"
  | "needs_my_review"
  | "assigned_to_me"
  | "mentioning_me"
  | "failed_checks"
  | "waiting_on_author"
  | "recently_updated"
  | "drafts"
  | "merged_recently"
  | "stale_open"
  | "closed_recently";

export type IssueTriagePreset = "all_open" | "assigned_to_me" | "mentioning_me" | "recently_updated" | "stale_open" | "closed_recently";

export type ReviewSignal = "needs_review" | "changes_requested" | "approved" | "commented" | "pending" | "none";
export type ParticipantSignal = "author" | "assignee" | "reviewer" | "mentioned" | "involved" | "none";

export interface PullRequestTriage {
  attentionReason: string | null;
  reviewSignal: ReviewSignal;
  checkSignal: PullRequestSummary["checkState"];
  participantSignal: ParticipantSignal;
  score: number;
}

export interface IssueTriage {
  attentionReason: string | null;
  participantSignal: ParticipantSignal;
  score: number;
}

export const pullRequestPresetLabels: Record<PullRequestTriagePreset, string> = {
  all_open: "Open",
  needs_my_review: "Needs my review",
  assigned_to_me: "Assigned to me",
  mentioning_me: "Mentioning me",
  failed_checks: "Failed checks",
  waiting_on_author: "Waiting on author",
  recently_updated: "Recently updated",
  drafts: "Drafts",
  merged_recently: "Merged recently",
  stale_open: "Stale open",
  closed_recently: "Closed recently"
};

export const issuePresetLabels: Record<IssueTriagePreset, string> = {
  all_open: "Open",
  assigned_to_me: "Assigned to me",
  mentioning_me: "Mentioning me",
  recently_updated: "Recently updated",
  stale_open: "Stale open",
  closed_recently: "Closed recently"
};

export function triagePullRequest(pr: PullRequestSummary, login?: string): PullRequestTriage {
  const reviewSignal = prReviewSignal(pr, login);
  const participantSignal = prParticipantSignal(pr, login);
  const reason = prAttentionReason(pr, reviewSignal, participantSignal);
  let score = 0;
  if (reviewSignal === "needs_review") score += 90;
  if (pr.checkState === "failing") score += 75;
  if (reviewSignal === "changes_requested") score += 60;
  if (participantSignal === "assignee") score += 45;
  if (participantSignal === "mentioned") score += 35;
  if (pr.isDraft) score -= 20;
  if (isStale(pr.updatedAt, 14) && pr.state === "open") score += 12;
  score += recencyScore(pr.updatedAt);
  return {
    attentionReason: reason,
    reviewSignal,
    checkSignal: pr.checkState,
    participantSignal,
    score
  };
}

export function triageIssue(issue: IssueSummary, login?: string): IssueTriage {
  const participantSignal = issueParticipantSignal(issue, login);
  let score = 0;
  if (participantSignal === "assignee") score += 70;
  if (participantSignal === "mentioned") score += 45;
  if (priorityLabels(issue.labels)) score += 30;
  if (isStale(issue.updatedAt, 14) && issue.state === "open") score += 10;
  score += recencyScore(issue.updatedAt);
  return {
    attentionReason: issueAttentionReason(issue, participantSignal),
    participantSignal,
    score
  };
}

export function filterPullRequestsByPreset(
  prs: PullRequestSummary[],
  preset: PullRequestTriagePreset,
  login?: string
): PullRequestSummary[] {
  return prs.filter((pr) => matchesPullRequestPreset(pr, preset, login));
}

export function filterIssuesByPreset(issues: IssueSummary[], preset: IssueTriagePreset, login?: string): IssueSummary[] {
  return issues.filter((issue) => matchesIssuePreset(issue, preset, login));
}

export function sortPullRequestsForTriage(prs: PullRequestSummary[], login?: string): PullRequestSummary[] {
  return [...prs].sort((a, b) => triagePullRequest(b, login).score - triagePullRequest(a, login).score || updatedDesc(a, b));
}

export function sortIssuesForTriage(issues: IssueSummary[], login?: string): IssueSummary[] {
  return [...issues].sort((a, b) => triageIssue(b, login).score - triageIssue(a, login).score || updatedDesc(a, b));
}

export function pullRequestPresetCounts(
  prs: PullRequestSummary[],
  presets: PullRequestTriagePreset[],
  login?: string
): Record<PullRequestTriagePreset, number> {
  return Object.fromEntries(presets.map((preset) => [preset, filterPullRequestsByPreset(prs, preset, login).length])) as Record<
    PullRequestTriagePreset,
    number
  >;
}

export function issuePresetCounts(issues: IssueSummary[], presets: IssueTriagePreset[], login?: string): Record<IssueTriagePreset, number> {
  return Object.fromEntries(presets.map((preset) => [preset, filterIssuesByPreset(issues, preset, login).length])) as Record<
    IssueTriagePreset,
    number
  >;
}

function matchesPullRequestPreset(pr: PullRequestSummary, preset: PullRequestTriagePreset, login?: string): boolean {
  const triage = triagePullRequest(pr, login);
  if (preset === "all_open") return pr.state === "open";
  if (preset === "needs_my_review") return triage.reviewSignal === "needs_review";
  if (preset === "assigned_to_me") return triage.participantSignal === "assignee";
  if (preset === "mentioning_me") return mentionsUser(pr.body, login);
  if (preset === "failed_checks") return pr.checkState === "failing";
  if (preset === "waiting_on_author") return pr.state === "open" && pr.reviewState === "changes requested";
  if (preset === "recently_updated") return isRecent(pr.updatedAt, 7);
  if (preset === "drafts") return pr.isDraft;
  if (preset === "merged_recently") return pr.merged && isRecent(pr.mergedAt ?? pr.closedAt ?? pr.updatedAt, 14);
  if (preset === "stale_open") return pr.state === "open" && isStale(pr.updatedAt, 14);
  if (preset === "closed_recently") return pr.state === "closed" && isRecent(pr.closedAt ?? pr.updatedAt, 14);
  return true;
}

function matchesIssuePreset(issue: IssueSummary, preset: IssueTriagePreset, login?: string): boolean {
  const triage = triageIssue(issue, login);
  if (preset === "all_open") return issue.state === "open";
  if (preset === "assigned_to_me") return triage.participantSignal === "assignee";
  if (preset === "mentioning_me") return mentionsUser(issue.body, login);
  if (preset === "recently_updated") return isRecent(issue.updatedAt, 7);
  if (preset === "stale_open") return issue.state === "open" && isStale(issue.updatedAt, 14);
  if (preset === "closed_recently") return issue.state === "closed" && isRecent(issue.closedAt ?? issue.updatedAt, 14);
  return true;
}

function prReviewSignal(pr: PullRequestSummary, login?: string): ReviewSignal {
  if (login && pr.requestedReviewerLogins.some((reviewer) => sameLogin(reviewer, login))) return "needs_review";
  if (pr.reviewState === "changes requested") return "changes_requested";
  if (pr.reviewState === "approved") return "approved";
  if (pr.reviewState === "reviewed") return "commented";
  if (pr.reviewState) return "pending";
  return "none";
}

function prParticipantSignal(pr: PullRequestSummary, login?: string): ParticipantSignal {
  if (!login) return "none";
  if (sameLogin(pr.authorLogin, login)) return "author";
  if (pr.assigneeLogins.some((assignee) => sameLogin(assignee, login))) return "assignee";
  if (pr.requestedReviewerLogins.some((reviewer) => sameLogin(reviewer, login))) return "reviewer";
  if (mentionsUser(pr.body, login)) return "mentioned";
  return "none";
}

function issueParticipantSignal(issue: IssueSummary, login?: string): ParticipantSignal {
  if (!login) return "none";
  if (sameLogin(issue.authorLogin, login)) return "author";
  if (issue.assigneeLogins.some((assignee) => sameLogin(assignee, login))) return "assignee";
  if (mentionsUser(issue.body, login)) return "mentioned";
  return "none";
}

function prAttentionReason(pr: PullRequestSummary, reviewSignal: ReviewSignal, participantSignal: ParticipantSignal): string | null {
  if (reviewSignal === "needs_review") return "Review requested";
  if (pr.checkState === "failing") return "Checks failing";
  if (reviewSignal === "changes_requested") return "Changes requested";
  if (participantSignal === "assignee") return "Assigned to you";
  if (participantSignal === "mentioned") return "Mentioned you";
  if (pr.isDraft) return "Draft";
  if (pr.state === "open" && isStale(pr.updatedAt, 14)) return "Stale discussion";
  return null;
}

function issueAttentionReason(issue: IssueSummary, participantSignal: ParticipantSignal): string | null {
  if (participantSignal === "assignee") return "Assigned to you";
  if (participantSignal === "mentioned") return "Mentioned you";
  if (priorityLabels(issue.labels)) return "Priority label";
  if (issue.state === "open" && isStale(issue.updatedAt, 14)) return "Stale issue";
  return null;
}

function mentionsUser(body: string | null, login?: string): boolean {
  return Boolean(login && body?.toLowerCase().includes(`@${login.toLowerCase()}`));
}

function priorityLabels(labels: string[]): boolean {
  return labels.some((label) => /^(p0|p1|priority|urgent|blocker|critical)$/i.test(label));
}

function isRecent(value: string | null | undefined, days: number): boolean {
  const time = timestamp(value);
  return time > 0 && Date.now() - time <= days * 24 * 60 * 60 * 1000;
}

function isStale(value: string | null | undefined, days: number): boolean {
  const time = timestamp(value);
  return time > 0 && Date.now() - time > days * 24 * 60 * 60 * 1000;
}

function recencyScore(value: string | null | undefined): number {
  const time = timestamp(value);
  if (time <= 0) return 0;
  const ageDays = Math.max(0, (Date.now() - time) / (24 * 60 * 60 * 1000));
  return Math.max(0, 20 - ageDays);
}

function updatedDesc(a: { updatedAt: string | null }, b: { updatedAt: string | null }): number {
  return timestamp(b.updatedAt) - timestamp(a.updatedAt);
}

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sameLogin(value: string | null | undefined, login: string): boolean {
  return value?.toLowerCase() === login.toLowerCase();
}
