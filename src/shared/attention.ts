import type { IssueSummary, PullRequestSummary } from "./domain/github-work.js";
import { triageIssue, triagePullRequest } from "./triage.js";

export type AttentionEntityType = "pull_request" | "issue" | "check" | "workflow_run" | "bot_group";
export type AttentionSurface = "my_work" | "notifications";
export type AttentionLane =
  | "needs_me"
  | "waiting"
  | "at_risk"
  | "snoozed"
  | "muted"
  | "done"
  | "reviewing"
  | "assigned"
  | "watching"
  | "noise";
export type AttentionFilter = "all" | "actionable" | "waiting" | "human" | "reviews" | "checks" | "bots" | "muted";
export type AttentionUrgency = "critical" | "high" | "normal" | "low";

export type AttentionReason =
  | "explicit_review_request"
  | "team_review_unclaimed"
  | "assigned_to_you"
  | "direct_mention"
  | "human_reply"
  | "changes_requested"
  | "checks_failing"
  | "authored_waiting_review"
  | "reviewed_waiting_author"
  | "new_commits_after_review"
  | "review_draft_pending"
  | "priority_label"
  | "bot_activity"
  | "ci_activity"
  | "repo_activity";

export interface AttentionEventSummary {
  id: string;
  kind:
    | "comment"
    | "review"
    | "review_request"
    | "commit_push"
    | "check_failed"
    | "check_passed"
    | "workflow_failed"
    | "workflow_passed"
    | "assignment"
    | "label"
    | "state_change";
  label: string;
  preview: string | null;
  actorLogin: string | null;
  actorIsBot: boolean;
  createdAt: string | null;
}

export interface AttentionLocalState {
  id?: string;
  entityType: AttentionEntityType;
  repoId: string;
  entityNumber: number | null;
  accountLogin: string;
  lastSeenEventId: string | null;
  lastSeenAt: string | null;
  readAt: string | null;
  doneAt: string | null;
  snoozedUntil: string | null;
  mutedUntil: string | null;
  pinnedAt: string | null;
  manualPriority: number | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface NotificationEventRecord {
  id?: string;
  eventKey: string;
  entityType: AttentionEntityType;
  repoId: string;
  entityNumber: number | null;
  eventKind: AttentionEventSummary["kind"];
  actorLogin: string | null;
  actorIsBot: boolean;
  title: string;
  bodyPreview: string | null;
  htmlUrl: string | null;
  githubCreatedAt: string | null;
  githubUpdatedAt: string | null;
  firstSeenAt?: string;
  lastSeenAt?: string;
  importance: number;
  promotesToMyWork: boolean;
  collapseKey: string | null;
  payload: Record<string, unknown> | null;
}

export interface AttentionItem {
  id: string;
  entityType: AttentionEntityType;
  repoId: string;
  repoFullName: string | null;
  number: number | null;
  title: string;
  htmlUrl: string | null;
  lane: AttentionLane;
  surfaces: AttentionSurface[];
  reason: AttentionReason;
  reasonLabel: string;
  why: string;
  latestMeaningfulEvent: AttentionEventSummary | null;
  whatChanged: string;
  whyRelevant: string;
  suggestedAction: string;
  urgency: AttentionUrgency;
  actorLogin: string | null;
  actorIsBot: boolean;
  priority: number;
  unread: boolean;
  actionable: boolean;
  blocking: boolean;
  snoozedUntil: string | null;
  doneAt: string | null;
  muted: boolean;
  updatedAt: string | null;
  lastSyncedAt: string | null;
}

export interface AttentionContext {
  login: string | null;
  teamLogins?: string[];
  botLoginPatterns?: string[];
  now: string;
  localState?: AttentionLocalState | null;
  latestEvent?: AttentionEventSummary | null;
  reviewDraft?: AttentionReviewDraftSummary | null;
  settings?: AttentionPolicySettings;
}

export interface AttentionReviewDraftSummary {
  commentCount: number;
  reviewedFileCount: number;
  updatedAt: string | null;
  outdated: boolean;
}

export interface AttentionPolicySettings {
  collapseBotActivity: boolean;
  promoteFailingChecks: boolean;
  promoteDirectMentions: boolean;
  promoteReviewRequests: boolean;
  quietPassingCi: boolean;
}

export interface AttentionSummary {
  unreadCount: number;
  actionableCount: number;
  waitingCount: number;
  blockingCount: number;
  botCollapsedCount: number;
  lastSyncedAt: string | null;
  fromCache: boolean;
}

export interface AttentionListInput {
  surface?: AttentionSurface;
  lane?: AttentionLane;
  filter?: AttentionFilter;
  repoId?: string;
  limit?: number;
}

export const attentionLaneLabels: Record<AttentionLane, string> = {
  needs_me: "Needs me",
  waiting: "Waiting",
  at_risk: "At risk",
  muted: "Muted",
  reviewing: "Reviewing",
  assigned: "Assigned",
  watching: "Watching",
  noise: "Noise",
  snoozed: "Snoozed",
  done: "Done"
};

export const attentionReasonLabels: Record<AttentionReason, string> = {
  explicit_review_request: "Review requested",
  team_review_unclaimed: "Team review",
  assigned_to_you: "Assigned to you",
  direct_mention: "Mentioned you",
  human_reply: "Waiting on your response",
  changes_requested: "Changes requested",
  checks_failing: "CI failed after your change",
  authored_waiting_review: "Waiting on review",
  reviewed_waiting_author: "Waiting on author",
  new_commits_after_review: "New commits",
  review_draft_pending: "Draft pending",
  priority_label: "Priority",
  bot_activity: "Bot activity",
  ci_activity: "CI activity",
  repo_activity: "Repo activity"
};

export function attentionForPullRequest(pr: PullRequestSummary, context: AttentionContext): AttentionItem {
  const login = context.login ?? undefined;
  const triage = triagePullRequest(pr, login);
  const isAuthor = sameLogin(pr.authorLogin, context.login);
  const isAssignee = pr.assigneeLogins.some((assignee) => sameLogin(assignee, context.login));
  const mentioned = mentionsUser(pr.body, context.login);
  const priorityLabel = hasPriorityLabel(pr.labels);
  const latestEvent = context.latestEvent ?? syntheticPullRequestEvent(pr, context);
  const actorIsBot = latestEvent?.actorIsBot ?? isLikelyBotLogin(pr.authorLogin, context.botLoginPatterns);
  const policy = normalizedPolicy(context.settings);
  const latestHumanFromOther = isHumanEventFromOther(latestEvent, context.login);
  const directlyMentioned = mentioned || mentionsUser(latestEvent?.preview, context.login);
  const involved = isAuthor || isAssignee || pr.requestedReviewerLogins.some((reviewer) => sameLogin(reviewer, context.login)) || mentioned;
  const draftHasWork = Boolean(
    context.reviewDraft &&
    (context.reviewDraft.commentCount > 0 || context.reviewDraft.reviewedFileCount > 0) &&
    (!context.reviewDraft.updatedAt ||
      !pr.updatedAt ||
      timestamp(context.reviewDraft.updatedAt) >= timestamp(pr.updatedAt) - 7 * 24 * 60 * 60 * 1000)
  );

  let reason: AttentionReason = "repo_activity";
  let lane: AttentionLane = "watching";
  let priority = triage.score;
  let why = "Recent PR activity";
  let blocking = false;
  let actionable = false;
  const activePullRequest = isActivePullRequest(pr);

  if (!activePullRequest) {
    reason = "repo_activity";
    lane = "watching";
    priority -= 25;
    why = pr.merged ? "PR already merged" : "PR already closed";
  } else if (
    policy.promoteReviewRequests &&
    context.login &&
    pr.requestedReviewerLogins.some((reviewer) => sameLogin(reviewer, context.login))
  ) {
    reason = "explicit_review_request";
    lane = "needs_me";
    priority += 100;
    why = "Explicitly requested you";
    actionable = true;
    blocking = olderThan(latestEvent?.createdAt ?? pr.updatedAt, context.now, 24 * 60 * 60 * 1000);
  } else if (isAuthor && policy.promoteFailingChecks && pr.checkState === "failing") {
    reason = "checks_failing";
    lane = "at_risk";
    priority += 85;
    why = "Your PR is blocked by failing checks";
    actionable = true;
    blocking = true;
  } else if (isAuthor && pr.reviewState === "changes requested") {
    reason = "changes_requested";
    lane = "at_risk";
    priority += 90;
    why = "Changes requested on your PR";
    actionable = true;
    blocking = true;
  } else if (draftHasWork && context.reviewDraft?.outdated) {
    reason = "review_draft_pending";
    lane = "at_risk";
    priority += 82;
    why = "Saved review draft is behind the PR head";
    actionable = true;
    blocking = true;
  } else if (draftHasWork) {
    reason = "review_draft_pending";
    lane = "needs_me";
    priority += 72;
    why = "Saved review draft is ready to resume";
    actionable = true;
  } else if (isAssignee) {
    reason = "assigned_to_you";
    lane = "needs_me";
    priority += 80;
    why = "Assigned to you";
    actionable = true;
  } else if (policy.promoteDirectMentions && directlyMentioned && latestHumanFromOther) {
    reason = "direct_mention";
    lane = "needs_me";
    priority += 95;
    why = "Mentioned you";
    actionable = true;
  } else if (latestHumanFromOther && involved) {
    reason = "human_reply";
    lane = "needs_me";
    priority += 40;
    why = `${latestEvent?.actorLogin ?? "Someone"} replied in a thread involving you`;
    actionable = true;
  } else if (priorityLabel && (isAuthor || isAssignee)) {
    reason = "priority_label";
    lane = "needs_me";
    priority += 50;
    why = "Priority label on your PR";
    actionable = true;
  } else if (isAuthor && pr.state === "open" && !pr.isDraft) {
    reason = "authored_waiting_review";
    lane = "waiting";
    priority += 35;
    why = "Your PR is waiting on review";
  } else if (triage.reviewSignal === "approved" || triage.reviewSignal === "changes_requested") {
    reason = "reviewed_waiting_author";
    lane = "waiting";
    priority += 40;
    why = "You are active in the review";
  } else if (actorIsBot) {
    reason = pr.checkState === "failing" ? "ci_activity" : "bot_activity";
    lane = "noise";
    priority -= pr.checkState === "failing" ? 10 : 50;
    why = pr.checkState === "failing" ? "CI needs attention in notifications" : "Only bots updated this";
  }

  const item = buildAttentionItem({
    id: attentionEntityId("pull_request", pr.repoId, pr.number),
    entityType: "pull_request",
    repoId: pr.repoId,
    repoFullName: pr.repoFullName ?? null,
    number: pr.number,
    title: pr.title,
    htmlUrl: pr.htmlUrl,
    lane,
    reason,
    why,
    latestEvent,
    actorLogin: latestEvent?.actorLogin ?? pr.authorLogin,
    actorIsBot,
    priority,
    actionable,
    blocking,
    updatedAt: reason === "review_draft_pending" ? (context.reviewDraft?.updatedAt ?? pr.updatedAt) : pr.updatedAt,
    lastSyncedAt: pr.lastSyncedAt,
    includeMyWork: activePullRequest,
    includeNotifications: activePullRequest,
    context
  });

  return item;
}

export function attentionForIssue(issue: IssueSummary, context: AttentionContext): AttentionItem {
  const triage = triageIssue(issue, context.login ?? undefined);
  const isAuthor = sameLogin(issue.authorLogin, context.login);
  const isAssignee = issue.assigneeLogins.some((assignee) => sameLogin(assignee, context.login));
  const mentioned = mentionsUser(issue.body, context.login);
  const priorityLabel = hasPriorityLabel(issue.labels);
  const latestEvent = context.latestEvent ?? syntheticIssueEvent(issue, context);
  const actorIsBot = latestEvent?.actorIsBot ?? isLikelyBotLogin(issue.authorLogin, context.botLoginPatterns);
  const policy = normalizedPolicy(context.settings);
  const latestHumanFromOther = isHumanEventFromOther(latestEvent, context.login);
  const directlyMentioned = mentioned || mentionsUser(latestEvent?.preview, context.login);
  const involved = isAuthor || isAssignee || mentioned;

  let reason: AttentionReason = "repo_activity";
  let lane: AttentionLane = "watching";
  let priority = triage.score;
  let why = "Recent issue activity";
  let actionable = false;
  let blocking = false;
  const activeIssue = issue.state === "open" && !issue.closedAt;

  if (!activeIssue) {
    reason = "repo_activity";
    lane = "watching";
    priority -= 25;
    why = "Issue already closed";
  } else if (isAssignee) {
    reason = "assigned_to_you";
    lane = "needs_me";
    priority += 80;
    why = "Assigned to you";
    actionable = true;
    blocking = priorityLabel;
  } else if (policy.promoteDirectMentions && directlyMentioned && latestHumanFromOther) {
    reason = "direct_mention";
    lane = "needs_me";
    priority += 95;
    why = "Mentioned you";
    actionable = true;
  } else if (latestHumanFromOther && involved) {
    reason = "human_reply";
    lane = "needs_me";
    priority += 40;
    why = `${latestEvent?.actorLogin ?? "Someone"} replied in a thread involving you`;
    actionable = true;
  } else if (priorityLabel && (isAuthor || isAssignee)) {
    reason = "priority_label";
    lane = "needs_me";
    priority += 50;
    why = "Priority issue involving you";
    actionable = true;
    blocking = true;
  } else if (isAuthor && issue.state === "open") {
    reason = "authored_waiting_review";
    lane = "waiting";
    priority += 35;
    why = "Your issue is waiting on response";
  } else if (actorIsBot) {
    reason = "bot_activity";
    lane = "noise";
    priority -= 50;
    why = "Only bots updated this";
  }

  return buildAttentionItem({
    id: attentionEntityId("issue", issue.repoId, issue.number),
    entityType: "issue",
    repoId: issue.repoId,
    repoFullName: issue.repoFullName ?? null,
    number: issue.number,
    title: issue.title,
    htmlUrl: issue.htmlUrl,
    lane,
    reason,
    why,
    latestEvent,
    actorLogin: latestEvent?.actorLogin ?? issue.authorLogin,
    actorIsBot,
    priority,
    actionable,
    blocking,
    updatedAt: issue.updatedAt,
    lastSyncedAt: issue.lastSyncedAt,
    includeMyWork: activeIssue && actionable,
    includeNotifications: activeIssue,
    context
  });
}

export function sortAttentionItems(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => {
    if (a.lane !== b.lane) return laneRank(a.lane) - laneRank(b.lane);
    if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;
    if (a.actionable !== b.actionable) return a.actionable ? -1 : 1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return timestamp(b.updatedAt) - timestamp(a.updatedAt);
  });
}

export function isLikelyBotLogin(login: string | null | undefined, extraPatterns: string[] = []): boolean {
  const normalized = login?.toLowerCase() ?? "";
  if (!normalized) return false;
  return ["\\[bot\\]$", "dependabot", "renovate", "github-actions", "vercel", "netlify", "codecov", ...extraPatterns].some((pattern) =>
    new RegExp(pattern, "i").test(normalized)
  );
}

export function attentionEntityId(entityType: AttentionEntityType, repoId: string, entityNumber: number | null): string {
  return `${entityType}:${repoId}:${entityNumber ?? "none"}`;
}

export function attentionStateId(input: Pick<AttentionLocalState, "entityType" | "repoId" | "entityNumber" | "accountLogin">): string {
  return `${input.accountLogin.toLowerCase()}:${attentionEntityId(input.entityType, input.repoId, input.entityNumber)}`;
}

function buildAttentionItem(input: {
  id: string;
  entityType: AttentionEntityType;
  repoId: string;
  repoFullName: string | null;
  number: number | null;
  title: string;
  htmlUrl: string | null;
  lane: AttentionLane;
  reason: AttentionReason;
  why: string;
  latestEvent: AttentionEventSummary | null;
  actorLogin: string | null;
  actorIsBot: boolean;
  priority: number;
  actionable: boolean;
  blocking: boolean;
  updatedAt: string | null;
  lastSyncedAt: string | null;
  includeMyWork: boolean;
  includeNotifications: boolean;
  context: AttentionContext;
}): AttentionItem {
  const state = input.context.localState ?? null;
  const now = timestamp(input.context.now);
  const snoozed = timestamp(state?.snoozedUntil) > now;
  const muted = timestamp(state?.mutedUntil) > now;
  const latestAt = input.latestEvent?.createdAt ?? input.updatedAt;
  const doneEffective = Boolean(state?.doneAt && !humanEventAfter(input.latestEvent, state.doneAt));
  const readAt = state?.readAt ?? state?.lastSeenAt ?? null;
  const unread = !readAt || timestamp(latestAt) > timestamp(readAt);
  const lane = muted ? "muted" : snoozed ? "snoozed" : doneEffective ? "done" : input.lane;
  const actionable = input.actionable && lane !== "done" && lane !== "snoozed" && lane !== "muted" && lane !== "noise";
  const whyRelevant = snoozed ? `Snoozed until ${state?.snoozedUntil}` : doneEffective ? "Marked done" : input.why;

  return {
    id: input.id,
    entityType: input.entityType,
    repoId: input.repoId,
    repoFullName: input.repoFullName,
    number: input.number,
    title: input.title,
    htmlUrl: input.htmlUrl,
    lane,
    surfaces: input.includeMyWork && lane !== "noise" ? ["my_work"] : input.includeNotifications ? ["notifications"] : [],
    reason: input.reason,
    reasonLabel: attentionReasonLabels[input.reason],
    why: whyRelevant,
    latestMeaningfulEvent: input.latestEvent,
    whatChanged: summarizeLatestEvent(input.latestEvent, input.updatedAt),
    whyRelevant,
    suggestedAction: suggestedActionFor(input.reason, lane, input.entityType),
    urgency: urgencyFor({ lane, actionable, blocking: input.blocking && !muted && !doneEffective, priority: input.priority }),
    actorLogin: input.actorLogin,
    actorIsBot: input.actorIsBot,
    priority: (state?.manualPriority ?? 0) + input.priority,
    unread,
    actionable,
    blocking: input.blocking && !muted && !doneEffective,
    snoozedUntil: snoozed ? (state?.snoozedUntil ?? null) : null,
    doneAt: doneEffective ? (state?.doneAt ?? null) : null,
    muted,
    updatedAt: input.updatedAt,
    lastSyncedAt: input.lastSyncedAt
  };
}

function summarizeLatestEvent(event: AttentionEventSummary | null, fallbackUpdatedAt: string | null): string {
  if (!event) return fallbackUpdatedAt ? "Cached GitHub state changed" : "Cached GitHub activity";
  if (event.actorLogin && !event.actorIsBot && !event.label.toLowerCase().includes(event.actorLogin.toLowerCase())) {
    return `${event.actorLogin}: ${event.label}`;
  }
  return event.label;
}

function suggestedActionFor(reason: AttentionReason, lane: AttentionLane, entityType: AttentionEntityType): string {
  if (lane === "done" || lane === "snoozed") return "Open";
  switch (reason) {
    case "explicit_review_request":
    case "team_review_unclaimed":
    case "new_commits_after_review":
      return "Review";
    case "direct_mention":
    case "human_reply":
      return "Reply";
    case "checks_failing":
    case "changes_requested":
    case "priority_label":
      return "Resolve";
    case "assigned_to_you":
      return entityType === "pull_request" ? "Resolve" : "Open";
    case "review_draft_pending":
      return "Resume";
    default:
      return "Open";
  }
}

function urgencyFor(input: { lane: AttentionLane; actionable: boolean; blocking: boolean; priority: number }): AttentionUrgency {
  if (input.lane === "noise" || input.lane === "muted" || input.lane === "done" || input.lane === "snoozed") return "low";
  if (input.blocking) return "critical";
  if (input.actionable || input.priority >= 80) return "high";
  if (input.lane === "waiting" || input.lane === "reviewing" || input.priority >= 35) return "normal";
  return "low";
}

function syntheticPullRequestEvent(pr: PullRequestSummary, context: AttentionContext): AttentionEventSummary {
  const kind = pr.checkState === "failing" ? "check_failed" : pr.checkState === "passing" ? "check_passed" : "state_change";
  return {
    id: `pr:${pr.repoId}:${pr.number}:${pr.headSha ?? pr.updatedAt ?? "state"}`,
    kind,
    label: pr.checkState === "failing" ? "Checks failed" : pr.checkState === "passing" ? "Checks passed" : "PR updated",
    preview: pr.body ? previewText(pr.body) : null,
    actorLogin: pr.authorLogin,
    actorIsBot: isLikelyBotLogin(pr.authorLogin, context.botLoginPatterns),
    createdAt: pr.updatedAt
  };
}

function isActivePullRequest(pr: PullRequestSummary): boolean {
  return pr.state === "open" && !pr.merged && !pr.mergedAt && !pr.closedAt;
}

function syntheticIssueEvent(issue: IssueSummary, context: AttentionContext): AttentionEventSummary {
  return {
    id: `issue:${issue.repoId}:${issue.number}:${issue.updatedAt ?? "state"}`,
    kind: issue.state === "closed" ? "state_change" : "comment",
    label: issue.state === "closed" ? "Issue closed" : "Issue updated",
    preview: issue.body ? previewText(issue.body) : null,
    actorLogin: issue.authorLogin,
    actorIsBot: isLikelyBotLogin(issue.authorLogin, context.botLoginPatterns),
    createdAt: issue.updatedAt
  };
}

function humanEventAfter(event: AttentionEventSummary | null, date: string | null | undefined): boolean {
  return Boolean(event && !event.actorIsBot && timestamp(event.createdAt) > timestamp(date));
}

function isHumanEventFromOther(event: AttentionEventSummary | null, login: string | null | undefined): boolean {
  return Boolean(event && !event.actorIsBot && (!login || !sameLogin(event.actorLogin, login)));
}

function olderThan(value: string | null | undefined, now: string, ageMs: number): boolean {
  const createdAt = timestamp(value);
  const nowAt = timestamp(now);
  return Boolean(createdAt && nowAt && nowAt - createdAt >= ageMs);
}

function normalizedPolicy(settings: AttentionPolicySettings | undefined): AttentionPolicySettings {
  return {
    collapseBotActivity: settings?.collapseBotActivity ?? true,
    promoteFailingChecks: settings?.promoteFailingChecks ?? true,
    promoteDirectMentions: settings?.promoteDirectMentions ?? true,
    promoteReviewRequests: settings?.promoteReviewRequests ?? true,
    quietPassingCi: settings?.quietPassingCi ?? true
  };
}

function laneRank(lane: AttentionLane): number {
  return {
    needs_me: 0,
    at_risk: 1,
    waiting: 2,
    assigned: 3,
    reviewing: 4,
    watching: 4,
    snoozed: 5,
    muted: 6,
    done: 7,
    noise: 8
  }[lane];
}

function mentionsUser(body: string | null | undefined, login: string | null | undefined): boolean {
  return Boolean(login && body?.toLowerCase().includes(`@${login.toLowerCase()}`));
}

function hasPriorityLabel(labels: string[]): boolean {
  return labels.some((label) => /^(p0|p1|priority|urgent|blocker|critical|security)$/i.test(label));
}

function sameLogin(value: string | null | undefined, login: string | null | undefined): boolean {
  return Boolean(value && login && value.toLowerCase() === login.toLowerCase());
}

function previewText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 160);
}

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
