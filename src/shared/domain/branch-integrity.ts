export type BranchIntegritySeverity = "critical" | "high" | "medium" | "low";

export type BranchIntegrityConfidence = "exact" | "strong" | "moderate" | "weak";

export type BranchIntegrityFindingStatus = "open" | "resolved";

export type BranchIntegrityFindingKind =
  | "tested_tree_mismatch"
  | "expected_tree_mismatch"
  | "landed_diff_too_large"
  | "landed_diff_too_small"
  | "possible_reversion"
  | "missing_pr_content"
  | "unexpected_direct_push"
  | "missing_merge_group_evidence"
  | "unknown_merge_source"
  | "checkpoint_gap";

export interface BranchSnapshotInput {
  repoId: string;
  branch?: string;
  remote?: string;
  source?: "sync" | "manual" | "pre_operation" | "post_operation" | "audit";
}

export interface BranchSnapshot {
  id?: string;
  repoId: string;
  branchName: string;
  remoteName: string;
  headSha: string;
  treeSha: string;
  parentSha: string | null;
  firstParentSha: string | null;
  committedAt: string | null;
  observedAt: string;
  source: NonNullable<BranchSnapshotInput["source"]>;
  checkpointRef: string | null;
  notes: string | null;
}

export interface BranchCommitFileObservation {
  path: string;
  previousPath: string | null;
  additions: number;
  deletions: number;
  status: string;
}

export interface BranchCommitObservation {
  sha: string;
  treeSha: string;
  parentShas: string[];
  parentSha: string | null;
  firstParentSha: string | null;
  subject: string;
  body: string;
  authorName: string | null;
  authorEmail: string | null;
  committedAt: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  files: BranchCommitFileObservation[];
  prNumbers: number[];
}

export interface BranchIntegrityAuditOptions {
  branch?: string;
  remote?: string;
  since?: string;
  until?: string;
  limit?: number;
  mode?: "snapshot" | "full";
}

export interface MergeEvidence {
  id?: string;
  repoId: string;
  branchName: string;
  landedSha: string | null;
  landedTreeSha: string | null;
  landedParentSha: string | null;
  prNumbers: number[];
  mergeMethod: "merge" | "squash" | "rebase" | "fast_forward" | "unknown";
  mergeSource: "direct_push" | "pull_request" | "merge_queue" | "automation" | "manual" | "unknown";
  expectedHeadSha: string | null;
  expectedTreeSha: string | null;
  testedSha: string | null;
  testedTreeSha: string | null;
  mergeGroupRef: string | null;
  workflowRunId: number | null;
  workflowRunUrl: string | null;
  checkState: string | null;
  observedAt: string;
  additions?: number | null;
  deletions?: number | null;
  changedFiles?: number | null;
}

export interface BranchIntegrityFindingDraft {
  repoId?: string;
  branchName: string;
  severity: BranchIntegritySeverity;
  kind: BranchIntegrityFindingKind;
  title: string;
  summary: string;
  landedSha: string | null;
  expectedSha: string | null;
  landedTreeSha: string | null;
  expectedTreeSha: string | null;
  prNumbers: number[];
  confidence: BranchIntegrityConfidence;
  evidence: Record<string, unknown>;
  recoveryPlan?: BranchRecoveryPlan | null;
}

export interface BranchIntegrityFinding extends BranchIntegrityFindingDraft {
  id: string;
  repoId: string;
  status: BranchIntegrityFindingStatus;
  recoveryPlan: BranchRecoveryPlan | null;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
}

export interface BranchRecoveryStep {
  type:
    | "create_safety_ref"
    | "create_branch"
    | "revert_commit"
    | "cherry_pick"
    | "restore_tree"
    | "commit_recovery"
    | "open_pull_request"
    | "manual_instruction";
  title: string;
  command?: string;
  body?: string;
}

export interface BranchRecoveryPlan {
  repoId: string;
  branchName: string;
  findingIds: string[];
  strategy: "revert_bad_commit" | "reapply_prs" | "restore_tested_tree" | "manual";
  baseSha: string;
  targetTreeSha?: string;
  recoveryBranchName: string;
  steps: BranchRecoveryStep[];
  risks: string[];
}

export interface BranchRecoveryResult {
  repoId: string;
  branchName: string;
  recoveryBranchName: string;
  strategy: BranchRecoveryPlan["strategy"];
  safetyRef: string | null;
  baseSha: string;
  stagedFiles: number;
  additions: number;
  deletions: number;
  message: string;
}

export interface BranchRecoveryPullRequest {
  repoId: string;
  number: number;
  htmlUrl: string | null;
  headBranch: string;
  baseBranch: string;
}

export interface PullRequestCommitRecord {
  repoId: string;
  prNumber: number;
  sha: string;
  treeSha: string | null;
  message: string | null;
  authoredAt: string | null;
  committedAt: string | null;
  lastSyncedAt: string;
}

export interface CompareCacheRecord {
  repoId: string;
  baseSha: string;
  headSha: string;
  status: string | null;
  aheadBy: number | null;
  behindBy: number | null;
  totalCommits: number | null;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  payload: Record<string, unknown> | null;
  lastSyncedAt: string;
}

export interface BranchIntegrityAuditResult {
  repoId: string;
  branchName: string;
  auditedAt: string;
  snapshot: BranchSnapshot | null;
  commitsAudited: number;
  safetyRefsAvailable: boolean;
  findings: BranchIntegrityFinding[];
}

export interface BranchIntegrityAuditSummary {
  auditedAt: string;
  repoCount: number;
  findings: BranchIntegrityFinding[];
  failures: Array<{ repoId: string; message: string }>;
}

export interface BranchIntegrityStatusSummary {
  repoId: string;
  status: "clean" | "monitoring" | "needs_audit" | "warning" | "at_risk" | "incident" | "unavailable";
  branchName: string | null;
  headSha: string | null;
  treeSha: string | null;
  observedAt: string | null;
  lastAuditAt: string | null;
  openFindings: number;
  criticalFindings: number;
  highFindings: number;
  mediumFindings: number;
  lowFindings: number;
  message: string | null;
}
