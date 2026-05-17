import type { AttentionLane } from "./attention.js";
import type { BranchIntegrityFinding, BranchIntegrityFindingKind } from "./domain/branch-integrity.js";
import type { PullRequestReviewDraft } from "./domain/github-work.js";
import type { OperationRecord } from "./domain/operation.js";
import type { RepoWorkspace } from "./domain/watched-repo.js";

export const productPositioning = {
  short: "Fallback keeps GitHub work, local changes, and branch state coherent when repo work gets messy.",
  long: "Fallback is a local-first GitHub workbench for professional repository work. It keeps PRs, issues, reviews, comments, checks, local changes, operation history, and branch safety context available locally so you can keep working, reviewing, and recovering even when GitHub, the network, or local Git state is unreliable."
} as const;

export const myWorkLaneOrder: AttentionLane[] = ["needs_me", "waiting", "at_risk", "snoozed", "muted", "done"];

export const myWorkLaneCopy: Record<AttentionLane, { label: string; emptyTitle: string; emptyDetail: string }> = {
  needs_me: {
    label: "Needs me",
    emptyTitle: "Nothing needs you right now.",
    emptyDetail: "Review requests, mentions, assignments, and blocked writeback will appear here."
  },
  waiting: {
    label: "Waiting",
    emptyTitle: "Nothing is waiting on someone else.",
    emptyDetail: "Authored PRs, review follow-ups, and questions you asked will collect here."
  },
  at_risk: {
    label: "At risk",
    emptyTitle: "No active repo risk.",
    emptyDetail: "Failing checks, stale review drafts, blocked sends, and branch safety findings appear here."
  },
  snoozed: {
    label: "Snoozed",
    emptyTitle: "No snoozed work.",
    emptyDetail: "Snoozed items return automatically at the time you chose."
  },
  muted: {
    label: "Muted",
    emptyTitle: "No muted threads.",
    emptyDetail: "Muted work stays quiet until you restore it from this lane."
  },
  done: {
    label: "Done",
    emptyTitle: "No completed work in this queue.",
    emptyDetail: "Items you mark done stay reversible here until new human activity brings them back."
  },
  assigned: {
    label: "Assigned",
    emptyTitle: "No assigned work.",
    emptyDetail: "Assigned issues and pull requests now roll into Needs me."
  },
  reviewing: {
    label: "Reviewing",
    emptyTitle: "No active reviews.",
    emptyDetail: "Review follow-ups now roll into Waiting."
  },
  watching: {
    label: "Watching",
    emptyTitle: "No watched activity.",
    emptyDetail: "Watched activity stays in Notifications unless it needs action."
  },
  noise: {
    label: "Muted",
    emptyTitle: "No quieted activity.",
    emptyDetail: "Bot and muted activity stays out of My Work unless you ask for it."
  }
};

export interface BranchSafetyFindingCopy {
  label: string;
  whatHappened: string;
  whyItMatters: string;
  suggestedRecovery: string;
  evidenceLabel: string;
  severityLabel: string;
}

const branchFindingLabels: Record<BranchIntegrityFindingKind, string> = {
  tested_tree_mismatch: "Merged code differs from tested code",
  expected_tree_mismatch: "Branch content differs from expected PR result",
  landed_diff_too_large: "Merged change was larger than expected",
  landed_diff_too_small: "Merged change was smaller than expected",
  possible_reversion: "A previous change may have been undone",
  missing_pr_content: "Expected PR content is missing",
  unexpected_direct_push: "Branch changed outside the usual PR flow",
  missing_merge_group_evidence: "No merge queue evidence was found",
  unknown_merge_source: "Fallback cannot identify how this change landed",
  checkpoint_gap: "Branch history changed across an unobserved gap"
};

export function branchSafetyFindingCopy(
  finding: Pick<BranchIntegrityFinding, "kind" | "severity" | "summary" | "recoveryPlan">
): BranchSafetyFindingCopy {
  const label = branchFindingLabels[finding.kind];
  return {
    label,
    whatHappened: branchFindingWhatHappened(finding.kind, finding.summary),
    whyItMatters: branchFindingWhyItMatters(finding.kind),
    suggestedRecovery: finding.recoveryPlan
      ? "Fallback can prepare a recovery branch with the preserved evidence."
      : branchFindingRecovery(finding.kind),
    evidenceLabel: branchFindingEvidenceLabel(finding.kind),
    severityLabel: severityLabel(finding.severity)
  };
}

export function branchSafetyReport(findings: BranchIntegrityFinding[]): string {
  const lines = ["Branch Watch report", ""];
  if (findings.length === 0) {
    lines.push("No suspicious branch changes are currently open.");
    return lines.join("\n");
  }
  for (const finding of findings) {
    const copy = branchSafetyFindingCopy(finding);
    lines.push(
      `${copy.label} (${finding.severity}, ${finding.confidence})`,
      `What happened: ${copy.whatHappened}`,
      `Why it matters: ${copy.whyItMatters}`,
      `Suggested recovery: ${copy.suggestedRecovery}`,
      `Branch: ${finding.branchName}`,
      `Landed SHA: ${finding.landedSha ?? "unknown"}`,
      `Expected SHA: ${finding.expectedSha ?? "not available"}`,
      `PRs: ${finding.prNumbers.length ? finding.prNumbers.map((number) => `#${number}`).join(", ") : "none parsed"}`,
      ""
    );
  }
  return lines.join("\n").trimEnd();
}

export interface ReviewContinuityCopy {
  hasWork: boolean;
  title: string;
  summary: string;
  headState: "current" | "stale" | "unknown";
  sendPreview: string;
  nextAction: string;
}

export function reviewContinuityCopy(input: {
  draft: PullRequestReviewDraft;
  currentHeadSha: string | null;
  online: boolean;
  accountLogin: string | null | undefined;
}): ReviewContinuityCopy {
  const commentCount = input.draft.comments.filter((comment) => comment.body.trim()).length;
  const reviewedCount = input.draft.reviewedFiles.length;
  const hasSummary = Boolean(input.draft.body.trim());
  const hasWork = hasSummary || commentCount > 0 || reviewedCount > 0;
  const stale =
    input.draft.outdated || Boolean(input.draft.headSha && input.currentHeadSha && input.draft.headSha !== input.currentHeadSha);
  const pieces = [
    commentCountLabel(commentCount, "draft comment"),
    reviewedCountLabel(reviewedCount),
    hasSummary ? "summary written" : null
  ].filter((piece): piece is string => Boolean(piece));
  const headCopy = stale
    ? "The PR has new commits since this draft started."
    : input.draft.headSha
      ? "Draft matches the current PR head."
      : "Draft head is not cached yet.";
  const account = input.accountLogin ? `as ${input.accountLogin}` : "after you connect GitHub";
  const result = input.online ? "send to GitHub now" : "queue locally until GitHub is reachable";
  return {
    hasWork,
    title: hasWork ? "Resume saved review" : "Review draft",
    summary: hasWork ? `${pieces.join(", ") || "Local review work saved"}. ${headCopy}` : `No saved review work yet. ${headCopy}`,
    headState: stale ? "stale" : input.draft.headSha ? "current" : "unknown",
    sendPreview: `Will ${result} ${account}: ${eventLabel(input.draft.event)}, ${commentCountLabel(commentCount, "inline comment")}.`,
    nextAction: stale ? "Show changes since draft" : hasWork ? "Continue from next unreviewed file" : "Start review"
  };
}

export interface OperationSafetyCopy {
  state: string;
  risk: string;
  action: string;
  result: string;
  recovery: string;
}

export function operationSafetyCopy(operation: OperationRecord): OperationSafetyCopy {
  const branch = operation.workspaceBranch ?? "unknown branch";
  const workspace = operation.workspacePath ?? "workspace unknown";
  const state = `${branch} in ${workspace}`;
  return {
    state,
    risk: operation.riskLevel === "low" ? "No special risk was recorded." : `${operation.riskLevel} risk recorded before the action.`,
    action: operation.commandSummary ?? operation.kind.replaceAll("_", " "),
    result: operation.resultSummary ?? statusResult(operation.status),
    recovery: operation.recoveryHint ?? operation.recoveryRef ?? "Inspect the operation record before retrying or undoing this action."
  };
}

export interface WorkspaceProductCopy {
  displayKind: "Primary workspace" | "Parallel workspace";
  origin: "user" | "agent" | "imported" | "unknown";
  cleanupStatus: "safe" | "dirty" | "locked" | "missing" | "manual_review" | "primary";
  cleanupLabel: string;
  cleanupDetail: string;
}

export function workspaceProductCopy(workspace: RepoWorkspace): WorkspaceProductCopy {
  const origin = inferWorkspaceOrigin(workspace);
  if (workspace.kind === "clone") {
    return {
      displayKind: "Primary workspace",
      origin,
      cleanupStatus: "primary",
      cleanupLabel: "Primary",
      cleanupDetail: "Primary clones stay registered; create a parallel workspace for isolated work."
    };
  }
  if (workspace.missing || workspace.prunable) {
    return {
      displayKind: "Parallel workspace",
      origin,
      cleanupStatus: "missing",
      cleanupLabel: "Prunable",
      cleanupDetail: workspace.pruneReason ?? "Git marks this workspace metadata as stale."
    };
  }
  if (workspace.locked) {
    return {
      displayKind: "Parallel workspace",
      origin,
      cleanupStatus: "locked",
      cleanupLabel: "Locked",
      cleanupDetail: workspace.lockReason ?? "Git locked this workspace; review it before cleanup."
    };
  }
  if (workspace.isDirty) {
    return {
      displayKind: "Parallel workspace",
      origin,
      cleanupStatus: "dirty",
      cleanupLabel: "Needs review",
      cleanupDetail: "Local changes exist. Commit, stash, or inspect the diff before removal."
    };
  }
  return {
    displayKind: "Parallel workspace",
    origin,
    cleanupStatus: "safe",
    cleanupLabel: "Safe to remove",
    cleanupDetail: "No local changes were detected during the latest workspace refresh."
  };
}

function branchFindingWhatHappened(kind: BranchIntegrityFindingKind, summary: string): string {
  if (summary.trim()) return summary;
  return `${branchFindingLabels[kind]}.`;
}

function branchFindingWhyItMatters(kind: BranchIntegrityFindingKind): string {
  switch (kind) {
    case "tested_tree_mismatch":
      return "The branch may contain code that did not pass the merge queue checks users trusted.";
    case "expected_tree_mismatch":
      return "The branch no longer matches the PR result Fallback expected from cached GitHub context.";
    case "landed_diff_too_large":
    case "landed_diff_too_small":
      return "The merged change shape does not match the review context people likely approved.";
    case "possible_reversion":
      return "Recently landed work may have disappeared from the branch.";
    case "missing_pr_content":
      return "The branch references PR work that Fallback cannot find in the landed commit.";
    case "unexpected_direct_push":
      return "A protected or shared branch changed without the usual PR evidence.";
    case "missing_merge_group_evidence":
      return "Fallback cannot prove the landed code passed through the merge queue.";
    case "unknown_merge_source":
      return "The branch changed, but the source of that change is not clear enough to trust blindly.";
    case "checkpoint_gap":
      return "Fallback missed part of the branch history, so the current state needs a human check.";
  }
}

function branchFindingRecovery(kind: BranchIntegrityFindingKind): string {
  switch (kind) {
    case "checkpoint_gap":
    case "missing_merge_group_evidence":
    case "unknown_merge_source":
      return "Inspect the landed diff and copy the report before deciding whether recovery is needed.";
    default:
      return "Inspect expected and landed diffs, then create a recovery branch if the branch content is wrong.";
  }
}

function branchFindingEvidenceLabel(kind: BranchIntegrityFindingKind): string {
  if (kind === "tested_tree_mismatch" || kind === "missing_merge_group_evidence") return "tested, expected, and landed state";
  if (kind === "landed_diff_too_large" || kind === "landed_diff_too_small") return "diff size evidence";
  return "branch history evidence";
}

function severityLabel(severity: BranchIntegrityFinding["severity"]): string {
  if (severity === "critical") return "Needs recovery review";
  if (severity === "high") return "Needs inspection";
  if (severity === "medium") return "Review when convenient";
  return "Informational";
}

function eventLabel(event: PullRequestReviewDraft["event"]): string {
  if (event === "APPROVE") return "approve";
  if (event === "REQUEST_CHANGES") return "request changes";
  return "comment";
}

function commentCountLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function reviewedCountLabel(count: number): string | null {
  if (count <= 0) return null;
  return `${count} reviewed ${count === 1 ? "file" : "files"}`;
}

function statusResult(status: OperationRecord["status"]): string {
  if (status === "succeeded") return "The action completed.";
  if (status === "failed") return "The action failed before completing.";
  if (status === "blocked") return "Fallback blocked the action before mutating Git state.";
  if (status === "cancelled") return "The action was cancelled.";
  return "The action is still in progress.";
}

function inferWorkspaceOrigin(workspace: RepoWorkspace): WorkspaceProductCopy["origin"] {
  const text = `${workspace.localPath} ${workspace.branch ?? ""}`.toLowerCase();
  if (text.includes("codex") || text.includes("agent")) return "agent";
  if (workspace.kind === "clone") return "imported";
  return "user";
}
