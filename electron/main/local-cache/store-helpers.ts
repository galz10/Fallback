import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SCHEMA_VERSION } from "../../../db/schema.js";
import type { AttentionEntityType, AttentionLocalState, NotificationEventRecord } from "../../../src/shared/attention.js";
import type { GitHubAccountSession } from "../../../src/shared/domain/auth.js";
import type {
  BranchIntegrityFinding,
  BranchIntegrityFindingDraft,
  BranchIntegrityStatusSummary,
  BranchRecoveryPlan,
  BranchSnapshot,
  CompareCacheRecord,
  MergeEvidence,
  PullRequestCommitRecord
} from "../../../src/shared/domain/branch-integrity.js";
import type { CacheSummary } from "../../../src/shared/domain/cache.js";
import type {
  ActionCheckSummary,
  CheckRunSummary,
  IssueListInput,
  IssueSummary,
  PullRequestReviewDraft,
  PullRequestReviewDraftComment,
  PullRequestReviewEvent,
  PullRequestSummary,
  ReviewSummary,
  TimelineComment,
  WorkflowRunSummary
} from "../../../src/shared/domain/github-work.js";
import type { HealthMatrixRow, HealthProbeResult } from "../../../src/shared/domain/health.js";
import type { RepoGroup } from "../../../src/shared/domain/repo-group.js";
import type {
  RepoIdentity,
  RepoIdentityCheckStatus,
  RepoRemoteProtocol,
  RepoSigningMode
} from "../../../src/shared/domain/repo-identity.js";
import type { SyncJob } from "../../../src/shared/domain/sync.js";
import type { RepoWorkspace, WatchedRepo } from "../../../src/shared/domain/watched-repo.js";
import { nowIso } from "../path-utils.js";
import { hasStartupMark, isFirstUsableMarked } from "../performance.js";

export const performanceIndexSetMetadataKey = "performance_index_set_version";
export const performanceIndexSetVersion = "2026-05-12";
export const pullRequestSelect = `SELECT p.*, r.full_name AS repo_full_name,
    (
      SELECT GROUP_CONCAT(l.name, ',')
      FROM entity_labels el
      JOIN labels l ON l.id = el.label_id
      WHERE el.repo_id = p.repo_id
        AND el.entity_type = 'pull_request'
        AND el.entity_number = p.number
    ) AS label_names,
    COALESCE(reviews.review_state, p.review_state) AS computed_review_state,
    (
      SELECT COUNT(*)
      FROM check_runs cr
      WHERE cr.repo_id = p.repo_id AND cr.commit_sha = p.head_sha
    ) + (
      SELECT COUNT(*)
      FROM commit_statuses cs
      WHERE cs.repo_id = p.repo_id AND cs.commit_sha = p.head_sha
    ) AS check_total,
    (
      SELECT COUNT(*)
      FROM check_runs cr
      WHERE cr.repo_id = p.repo_id
        AND cr.commit_sha = p.head_sha
        AND (cr.status IS NULL OR cr.status != 'completed' OR cr.conclusion IS NULL)
    ) + (
      SELECT COUNT(*)
      FROM commit_statuses cs
      WHERE cs.repo_id = p.repo_id AND cs.commit_sha = p.head_sha AND cs.state = 'pending'
    ) AS check_pending,
    (
      SELECT COUNT(*)
      FROM check_runs cr
      WHERE cr.repo_id = p.repo_id
        AND cr.commit_sha = p.head_sha
        AND cr.conclusion IS NOT NULL
        AND cr.conclusion NOT IN ('success', 'neutral', 'skipped')
    ) + (
      SELECT COUNT(*)
      FROM commit_statuses cs
      WHERE cs.repo_id = p.repo_id AND cs.commit_sha = p.head_sha AND cs.state NOT IN ('success', 'pending')
    ) AS check_failed
  FROM pull_requests p
  LEFT JOIN repos r
    ON r.id = p.repo_id
  LEFT JOIN pr_review_state reviews
    ON reviews.repo_id = p.repo_id
   AND reviews.pr_number = p.number`;
export const issueSelect = `SELECT i.*, r.full_name AS repo_full_name,
    (
      SELECT GROUP_CONCAT(l.name, ',')
      FROM entity_labels el
      JOIN labels l ON l.id = el.label_id
      WHERE el.repo_id = i.repo_id
        AND el.entity_type = 'issue'
        AND el.entity_number = i.number
    ) AS label_names
  FROM issues i
  LEFT JOIN repos r
    ON r.id = i.repo_id`;

export interface RepoRow {
  id: string;
  github_repo_id: number;
  owner: string;
  name: string;
  full_name: string;
  description: string | null;
  owner_avatar_url: string | null;
  is_private: number;
  visibility: string | null;
  is_fork: number;
  archived: number;
  has_issues: number;
  is_template: number;
  language: string | null;
  permission_admin: number | null;
  permission_push: number | null;
  permission_pull: number | null;
  default_branch: string | null;
  html_url: string | null;
  local_path: string | null;
  watch_mode: "metadata-only" | "cloned";
  watch_priority: number;
  sync_status: WatchedRepo["syncStatus"];
  sync_error: string | null;
  sync_progress_message: string | null;
  clone_enabled: number;
  clone_status: string | null;
  open_pull_requests: number;
  open_issues: number;
  pushed_at: string | null;
  github_updated_at: string | null;
  last_synced_at: string | null;
  last_successful_sync_at: string | null;
  group_ids?: string | null;
  group_names?: string | null;
}

export interface PullRequestDiffCacheTarget {
  number: number;
  baseSha: string | null;
  headSha: string | null;
  baseBranch: string | null;
  headBranch: string | null;
}

export interface DiagnosticEventInput {
  source: string;
  level: "info" | "warn" | "error";
  code: string;
  message?: string | null;
}

export type CacheSummaryCounters = Omit<CacheSummary, "workspacePath" | "databasePath" | "totalBytes" | "databaseBytes" | "repos">;

export interface GitHubAccountInput {
  id: number | string;
  login: string | null;
  endpoint?: string | null;
  htmlUrl?: string | null;
  avatarUrl: string | null;
  avatarCachedUrl?: string | null;
  name?: string | null;
  accountType?: "User" | "Organization" | null;
  tokenSource?: "environment" | "keychain" | null;
  tokenScopes?: string[] | null;
  authStatus?: GitHubAccountSession["authStatus"];
  lastValidatedAt?: string | null;
  profileName?: string | null;
  profileColor?: string | null;
}

export interface SyncJobInput {
  priority?: number;
  reason?: string | null;
  notBefore?: string | null;
  dedupeKey?: string | null;
  accountId?: string | null;
  provider?: string | null;
}

export interface RepoIdentityInput {
  accountId?: string | null;
  endpoint?: string | null;
  gitName?: string | null;
  gitEmail?: string | null;
  signingMode?: RepoSigningMode;
  signingKeyHint?: string | null;
  remoteProtocol?: RepoRemoteProtocol;
  verifiedEmailStatus?: RepoIdentityCheckStatus;
  lastCheckedAt?: string | null;
  lastCheckStatus?: RepoIdentityCheckStatus;
}

export interface PullRequestReviewDraftInput {
  headSha?: string | null;
  event?: PullRequestReviewEvent;
  body?: string;
  comments?: PullRequestReviewDraftComment[];
  reviewedFiles?: string[];
}

export function hasOwn<T extends object>(value: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function primaryWorkspaceDraft(
  repoId: string,
  localPath: string,
  isActive: boolean
): Omit<RepoWorkspace, "createdAt" | "updatedAt"> {
  return {
    id: repoWorkspaceId(repoId, localPath),
    repoId,
    kind: "clone",
    localPath,
    gitCommonDir: null,
    gitDir: null,
    mainWorktreePath: localPath,
    branch: null,
    headSha: null,
    isActive,
    isDirty: null,
    locked: false,
    lockReason: null,
    prunable: false,
    pruneReason: null,
    detached: false,
    bare: false,
    missing: !fs.existsSync(localPath),
    lastSeenAt: nowIso()
  };
}

export function repoWorkspaceId(repoId: string, localPath: string): string {
  return `workspace:${repoId}:${createHash("sha1").update(canonicalPath(localPath)).digest("hex").slice(0, 16)}`;
}

export function canonicalPath(localPath: string): string {
  try {
    return fs.realpathSync(localPath);
  } catch {
    return path.resolve(localPath);
  }
}

export const repoTables = [
  "branch_integrity_findings",
  "pull_request_commits",
  "compare_cache",
  "merge_evidence",
  "branch_snapshots",
  "operations",
  "repo_workspaces",
  "pr_review_drafts",
  "repo_group_memberships",
  "repo_identities",
  "workflow_runs",
  "repo_metadata_cache",
  "github_page_cache",
  "issue_backfill_cursors",
  "user_issues",
  "user_pull_requests",
  "offline_actions",
  "local_check_runs",
  "health_probes",
  "sync_jobs",
  "commit_statuses",
  "check_runs",
  "entity_labels",
  "issue_field_options",
  "issue_types",
  "labels",
  "comments",
  "reviews",
  "issues",
  "pull_requests"
] as const;

export function mapRepo(row: RepoRow): WatchedRepo {
  return {
    id: row.id,
    githubRepoId: row.github_repo_id,
    owner: row.owner,
    name: row.name,
    fullName: row.full_name,
    description: row.description,
    ownerAvatarUrl: nullableString(row.owner_avatar_url),
    isPrivate: row.is_private === 1,
    visibility: nullableString(row.visibility),
    isFork: row.is_fork === 1,
    archived: row.archived === 1,
    hasIssues: row.has_issues === 1,
    isTemplate: row.is_template === 1,
    language: nullableString(row.language),
    permissions:
      row.permission_admin == null && row.permission_push == null && row.permission_pull == null
        ? null
        : {
            admin: row.permission_admin === 1,
            push: row.permission_push === 1,
            pull: row.permission_pull === 1
          },
    defaultBranch: row.default_branch,
    htmlUrl: row.html_url,
    localPath: row.local_path,
    cloneStatus: nullableString(row.clone_status),
    watchMode: row.watch_mode,
    watchPriority: row.watch_priority,
    syncStatus: row.sync_status,
    syncError: row.sync_error,
    syncProgressMessage: nullableString(row.sync_progress_message),
    openPullRequests: row.open_pull_requests,
    openIssues: row.open_issues,
    pushedAt: nullableString(row.pushed_at),
    githubUpdatedAt: nullableString(row.github_updated_at),
    lastSyncedAt: row.last_synced_at,
    lastSuccessfulSyncAt: row.last_successful_sync_at,
    groups: zipRepoGroups(row.group_ids, row.group_names)
  };
}

export function mapRepoWorkspace(row: Record<string, unknown>): RepoWorkspace {
  return {
    id: String(row.id),
    repoId: String(row.repo_id),
    kind: row.kind === "worktree" ? "worktree" : "clone",
    localPath: String(row.local_path),
    gitCommonDir: nullableString(row.git_common_dir),
    gitDir: nullableString(row.git_dir),
    mainWorktreePath: nullableString(row.main_worktree_path),
    branch: nullableString(row.branch),
    headSha: nullableString(row.head_sha),
    isActive: Boolean(row.is_active),
    isDirty: row.is_dirty == null ? null : Boolean(row.is_dirty),
    locked: Boolean(row.locked),
    lockReason: nullableString(row.lock_reason),
    prunable: Boolean(row.prunable),
    pruneReason: nullableString(row.prune_reason),
    detached: Boolean(row.detached),
    bare: Boolean(row.bare),
    missing: Boolean(row.missing),
    lastSeenAt: String(row.last_seen_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function mapRepoGroup(row: Record<string, unknown>, repoIds: string[]): RepoGroup {
  return {
    id: String(row.id),
    name: String(row.name),
    repoIds,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function zipRepoGroups(idsValue: unknown, namesValue: unknown): Array<{ id: string; name: string }> {
  const ids = splitUnitSeparator(nullableString(idsValue));
  const names = splitUnitSeparator(nullableString(namesValue));
  return ids.map((id, index) => ({ id, name: names[index] ?? id }));
}

export function splitUnitSeparator(value: string | null): string[] {
  return value ? value.split("\x1f").filter(Boolean) : [];
}

export function cleanRepoGroupName(value: string | null | undefined): string {
  const name = value?.trim();
  if (!name) throw new Error("Repository group name is required.");
  if (name.length > 80) throw new Error("Repository group name must be 80 characters or less.");
  return name;
}

export function mapSyncJob(row: Record<string, unknown>): SyncJob {
  return {
    id: String(row.id),
    repoId: row.repo_id ? String(row.repo_id) : null,
    accountId: nullableString(row.account_id),
    provider: nullableString(row.provider),
    jobType: String(row.job_type),
    status: String(row.status),
    priority: Number(row.priority ?? 0),
    reason: nullableString(row.reason),
    notBefore: nullableString(row.not_before),
    attemptCount: Number(row.attempt_count ?? 0),
    lastErrorCode: nullableString(row.last_error_code),
    dedupeKey: nullableString(row.dedupe_key),
    errorCode: nullableString(row.error_code),
    errorMessage: row.error_message ? String(row.error_message) : null,
    progressMessage: nullableString(row.progress_message),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    githubRateLimitRemaining: row.github_rate_limit_remaining == null ? null : Number(row.github_rate_limit_remaining),
    githubRateLimitResetAt: row.github_rate_limit_reset_at ? String(row.github_rate_limit_reset_at) : null
  };
}

export function mapPullRequest(row: Record<string, unknown>): PullRequestSummary {
  return {
    id: String(row.id),
    repoId: String(row.repo_id),
    number: Number(row.number),
    title: String(row.title),
    body: nullableString(row.body),
    authorLogin: nullableString(row.author_login),
    assigneeLogins: splitNames(row.assignee_logins),
    requestedReviewerLogins: splitNames(row.requested_reviewer_logins),
    state: String(row.state),
    isDraft: Number(row.is_draft) === 1,
    merged: Number(row.merged) === 1,
    repoFullName: nullableString(row.repo_full_name),
    headSha: nullableString(row.head_sha),
    baseSha: nullableString(row.base_sha),
    baseBranch: nullableString(row.base_branch),
    headBranch: nullableString(row.head_branch),
    additions: nullableNumber(row.additions),
    deletions: nullableNumber(row.deletions),
    changedFiles: nullableNumber(row.changed_files),
    commitsCount: nullableNumber(row.commits_count),
    commentsCount: nullableNumber(row.comments_count),
    reviewCommentsCount: nullableNumber(row.review_comments_count),
    reviewState: nullableString(row.computed_review_state),
    checkState: checkState(row),
    checkCount: Number(row.check_total ?? 0),
    labels: splitNames(row.label_names),
    htmlUrl: nullableString(row.html_url),
    createdAt: nullableString(row.created_at),
    updatedAt: nullableString(row.updated_at),
    closedAt: nullableString(row.closed_at),
    mergedAt: nullableString(row.merged_at),
    lastSyncedAt: nullableString(row.last_synced_at)
  };
}

export function mapIssue(row: Record<string, unknown>): IssueSummary {
  return {
    id: String(row.id),
    repoId: String(row.repo_id),
    number: Number(row.number),
    title: String(row.title),
    body: nullableString(row.body),
    authorLogin: nullableString(row.author_login),
    assigneeLogins: splitNames(row.assignee_logins),
    state: String(row.state),
    issueTypeName: nullableString(row.issue_type_name),
    repoFullName: nullableString(row.repo_full_name),
    commentsCount: nullableNumber(row.comments_count),
    labels: splitNames(row.label_names),
    htmlUrl: nullableString(row.html_url),
    createdAt: nullableString(row.created_at),
    updatedAt: nullableString(row.updated_at),
    closedAt: nullableString(row.closed_at),
    lastSyncedAt: nullableString(row.last_synced_at)
  };
}

export function logDbListTiming(
  name: string,
  rowCount: number,
  sqlMs: number,
  mapMs: number,
  details: Record<string, string | number> = {}
): void {
  const totalMs = sqlMs + mapMs;
  if (totalMs < 40 && process.env.FALLBACK_PERF_SMOKE !== "1") return;
  const detailText = Object.entries(details)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  console.info(
    `[perf] db ${name}: rows=${rowCount}${detailText ? ` ${detailText}` : ""} sql=${Math.round(sqlMs)}ms map=${Math.round(mapMs)}ms total=${Math.round(totalMs)}ms`
  );
}

export function logDbTiming(name: string, durationMs: number, details: Record<string, string | number> = {}): void {
  if (durationMs < 40 && process.env.FALLBACK_PERF_SMOKE !== "1") return;
  const detailText = Object.entries(details)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  console.info(`[perf] db ${name}: ${detailText ? `${detailText} ` : ""}total=${Math.round(durationMs)}ms`);
}

export function normalizeListLimit(value: number | null | undefined, fallback: number, max: number): number {
  const numeric = Number(value ?? fallback);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(Math.floor(numeric), max));
}

export function normalizeListOffset(value: number | null | undefined): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
}

export function issueStateClause(state: IssueListInput["state"] | undefined): string {
  return state === "open" || state === "closed" ? "AND i.state = ?" : "";
}

export function checkState(row: Record<string, unknown>): PullRequestSummary["checkState"] {
  const total = Number(row.check_total ?? 0);
  if (total <= 0) return "unknown";
  if (Number(row.check_failed ?? 0) > 0) return "failing";
  if (Number(row.check_pending ?? 0) > 0) return "pending";
  return "passing";
}

export function mapComment(row: Record<string, unknown>): TimelineComment {
  return {
    id: String(row.id),
    entityType: String(row.entity_type) as TimelineComment["entityType"],
    entityNumber: Number(row.entity_number),
    authorLogin: nullableString(row.author_login),
    body: nullableString(row.body),
    htmlUrl: nullableString(row.html_url),
    path: nullableString(row.path),
    position: nullableNumber(row.position),
    originalPosition: nullableNumber(row.original_position),
    diffHunk: nullableString(row.diff_hunk),
    createdAt: nullableString(row.created_at),
    updatedAt: nullableString(row.updated_at)
  };
}

export function mapReview(row: Record<string, unknown>): ReviewSummary {
  return {
    id: String(row.id),
    prNumber: Number(row.pr_number),
    authorLogin: nullableString(row.author_login),
    state: String(row.state),
    body: nullableString(row.body),
    htmlUrl: nullableString(row.html_url),
    submittedAt: nullableString(row.submitted_at)
  };
}

export function mapPullRequestReviewDraft(row: Record<string, unknown>, currentHeadSha: string | null): PullRequestReviewDraft {
  const headSha = nullableString(row.head_sha);
  return {
    repoId: String(row.repo_id),
    prNumber: Number(row.pr_number),
    headSha,
    currentHeadSha,
    outdated: currentHeadSha !== null && headSha !== currentHeadSha,
    event: reviewEvent(row.event),
    body: nullableString(row.body) ?? "",
    comments: parseReviewDraftComments(row.comments_json),
    reviewedFiles: parseStringArray(row.reviewed_files_json),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function mapCheckRun(row: Record<string, unknown>): CheckRunSummary {
  return {
    id: String(row.id),
    commitSha: String(row.commit_sha),
    name: String(row.name),
    status: nullableString(row.status),
    conclusion: nullableString(row.conclusion),
    htmlUrl: nullableString(row.html_url),
    detailsUrl: nullableString(row.details_url),
    startedAt: nullableString(row.started_at),
    completedAt: nullableString(row.completed_at)
  };
}

export function mapActionCheck(row: Record<string, unknown>): ActionCheckSummary {
  const state = nullableActionCheckState(row.state);
  return {
    id: String(row.id),
    repoId: String(row.repo_id),
    repoFullName: nullableString(row.repo_full_name),
    kind: row.kind === "commit_status" ? "commit_status" : "check_run",
    name: String(row.name),
    status: nullableString(row.status),
    conclusion: nullableString(row.conclusion),
    state,
    branch: nullableString(row.branch),
    commitSha: String(row.commit_sha),
    prNumber: nullableNumber(row.pr_number),
    prTitle: nullableString(row.pr_title),
    htmlUrl: nullableString(row.html_url),
    detailsUrl: nullableString(row.details_url),
    targetUrl: nullableString(row.target_url),
    description: nullableString(row.description),
    startedAt: nullableString(row.started_at),
    completedAt: nullableString(row.completed_at),
    updatedAt: nullableString(row.updated_at),
    lastSyncedAt: nullableString(row.last_synced_at)
  };
}

export function mapWorkflowRun(row: Record<string, unknown>): WorkflowRunSummary {
  return {
    id: String(row.id),
    repoId: String(row.repo_id),
    repoFullName: nullableString(row.repo_full_name),
    githubWorkflowRunId: Number(row.github_workflow_run_id),
    workflowName: nullableString(row.workflow_name),
    displayTitle: nullableString(row.display_title),
    runNumber: nullableNumber(row.run_number),
    runAttempt: nullableNumber(row.run_attempt),
    event: nullableString(row.event),
    status: nullableString(row.status),
    conclusion: nullableString(row.conclusion),
    state: workflowRunState(nullableString(row.status), nullableString(row.conclusion)),
    headBranch: nullableString(row.head_branch),
    headSha: nullableString(row.head_sha),
    htmlUrl: nullableString(row.html_url),
    actorLogin: nullableString(row.actor_login),
    path: nullableString(row.workflow_path),
    runStartedAt: nullableString(row.run_started_at),
    createdAt: nullableString(row.created_at),
    updatedAt: nullableString(row.updated_at),
    lastSyncedAt: nullableString(row.last_synced_at)
  };
}

export function nullableActionCheckState(value: unknown): ActionCheckSummary["state"] {
  return value === "passing" || value === "failing" || value === "pending" || value === "unknown" ? value : "unknown";
}

export function workflowRunState(status: string | null, conclusion: string | null): WorkflowRunSummary["state"] {
  if (conclusion === "success" || conclusion === "neutral" || conclusion === "skipped") return "passing";
  if (conclusion) return "failing";
  if (status === "queued" || status === "in_progress" || status === "waiting" || status === "requested" || status === "pending") {
    return "pending";
  }
  return "unknown";
}

export function mapGitHubAccount(row: Record<string, unknown>): GitHubAccountSession {
  return {
    id: String(row.id),
    githubUserId: nullableString(row.github_user_id),
    login: nullableString(row.github_login),
    endpoint: normalizeGitHubEndpoint(nullableString(row.github_endpoint)),
    htmlUrl: nullableString(row.github_html_url),
    avatarUrl: nullableString(row.github_avatar_url),
    avatarCachedUrl: nullableString(row.github_avatar_cached_url),
    name: nullableString(row.github_name),
    profileName: nullableString(row.profile_name),
    profileColor: nullableString(row.profile_color),
    accountType: nullableAccountType(row.github_account_type),
    tokenSource: nullableTokenSource(row.token_source),
    tokenScopes: splitNames(row.token_scopes),
    authStatus: nullableAuthStatus(row.auth_status),
    lastValidatedAt: nullableString(row.last_validated_at),
    lastSelectedAt: nullableString(row.profile_last_selected_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function mapRepoIdentity(row: Record<string, unknown>): RepoIdentity {
  return {
    repoId: String(row.repo_id),
    accountId: nullableString(row.account_id),
    accountLogin: nullableString(row.account_login),
    accountEndpoint: normalizeGitHubEndpoint(nullableString(row.account_endpoint) ?? nullableString(row.endpoint)),
    accountStatus: row.account_status ? nullableAuthStatus(row.account_status) : null,
    gitName: nullableString(row.git_name),
    gitEmail: nullableString(row.git_email),
    signingMode: signingMode(row.signing_mode),
    signingKeyHint: nullableString(row.signing_key_hint),
    remoteProtocol: remoteProtocol(row.remote_protocol),
    verifiedEmailStatus: identityCheckStatus(row.verified_email_status),
    lastCheckedAt: nullableString(row.last_checked_at),
    lastCheckStatus: identityCheckStatus(row.last_check_status),
    currentGitName: null,
    currentGitEmail: null,
    branch: null,
    remoteUrl: null,
    localPath: nullableString(row.local_path),
    mismatchReason: null,
    createdAt: nullableString(row.created_at),
    updatedAt: nullableString(row.updated_at)
  };
}

export function mapBranchSnapshot(row: Record<string, unknown>): BranchSnapshot {
  return {
    id: String(row.id),
    repoId: String(row.repo_id),
    branchName: String(row.branch_name),
    remoteName: String(row.remote_name),
    headSha: String(row.head_sha),
    treeSha: String(row.tree_sha),
    parentSha: nullableString(row.parent_sha),
    firstParentSha: nullableString(row.first_parent_sha),
    committedAt: nullableString(row.committed_at),
    observedAt: String(row.observed_at),
    source: branchSnapshotSource(row.source),
    checkpointRef: nullableString(row.checkpoint_ref),
    notes: nullableString(row.notes)
  };
}

export function mapMergeEvidence(row: Record<string, unknown>): MergeEvidence {
  return {
    id: String(row.id),
    repoId: String(row.repo_id),
    branchName: String(row.branch_name),
    landedSha: nullableString(row.landed_sha),
    landedTreeSha: nullableString(row.landed_tree_sha),
    landedParentSha: nullableString(row.landed_parent_sha),
    prNumbers: parseNumberArray(row.pr_numbers_json),
    mergeMethod: mergeMethod(row.merge_method),
    mergeSource: mergeSource(row.merge_source),
    expectedHeadSha: nullableString(row.expected_head_sha),
    expectedTreeSha: nullableString(row.expected_tree_sha),
    testedSha: nullableString(row.tested_sha),
    testedTreeSha: nullableString(row.tested_tree_sha),
    mergeGroupRef: nullableString(row.merge_group_ref),
    workflowRunId: nullableNumber(row.workflow_run_id),
    workflowRunUrl: nullableString(row.workflow_run_url),
    checkState: nullableString(row.check_state),
    observedAt: String(row.observed_at)
  };
}

export function mapPullRequestCommitRecord(row: Record<string, unknown>): PullRequestCommitRecord {
  return {
    repoId: String(row.repo_id),
    prNumber: Number(row.pr_number),
    sha: String(row.sha),
    treeSha: nullableString(row.tree_sha),
    message: nullableString(row.message),
    authoredAt: nullableString(row.authored_at),
    committedAt: nullableString(row.committed_at),
    lastSyncedAt: String(row.last_synced_at)
  };
}

export function mapCompareCacheRecord(row: Record<string, unknown>): CompareCacheRecord {
  return {
    repoId: String(row.repo_id),
    baseSha: String(row.base_sha),
    headSha: String(row.head_sha),
    status: nullableString(row.status),
    aheadBy: nullableNumber(row.ahead_by),
    behindBy: nullableNumber(row.behind_by),
    totalCommits: nullableNumber(row.total_commits),
    additions: nullableNumber(row.additions),
    deletions: nullableNumber(row.deletions),
    changedFiles: nullableNumber(row.changed_files),
    payload: parseObject(row.payload_json),
    lastSyncedAt: String(row.last_synced_at)
  };
}

export function mapBranchIntegrityFinding(row: Record<string, unknown>): BranchIntegrityFinding {
  return {
    id: String(row.id),
    repoId: String(row.repo_id),
    branchName: String(row.branch_name),
    severity: branchIntegritySeverity(row.severity),
    kind: branchIntegrityKind(row.kind),
    status: row.status === "resolved" ? "resolved" : "open",
    title: String(row.title),
    summary: String(row.summary),
    landedSha: nullableString(row.landed_sha),
    expectedSha: nullableString(row.expected_sha),
    landedTreeSha: nullableString(row.landed_tree_sha),
    expectedTreeSha: nullableString(row.expected_tree_sha),
    prNumbers: parseNumberArray(row.pr_numbers_json),
    evidence: parseObject(row.evidence_json),
    recoveryPlan: parseRecoveryPlan(row.recovery_plan_json),
    confidence: branchIntegrityConfidence(row.confidence),
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    resolvedAt: nullableString(row.resolved_at)
  };
}

export function branchSnapshotId(snapshot: BranchSnapshot): string {
  return `branch-snapshot:${snapshot.repoId}:${snapshot.branchName}:${snapshot.source}:${snapshot.headSha}`;
}

export function mergeEvidenceId(evidence: MergeEvidence): string {
  return `merge-evidence:${evidence.repoId}:${evidence.branchName}:${evidence.landedSha ?? evidence.observedAt}`;
}

export function branchFindingId(repoId: string, draft: BranchIntegrityFindingDraft): string {
  return [
    "branch-finding",
    repoId,
    draft.branchName,
    draft.kind,
    draft.landedSha ?? "no-sha",
    draft.expectedSha ?? draft.expectedTreeSha ?? "no-expected"
  ].join(":");
}

export function mapNotificationEvent(row: Record<string, unknown>): NotificationEventRecord {
  return {
    id: String(row.id),
    eventKey: String(row.event_key),
    entityType: attentionEntityType(row.entity_type),
    repoId: String(row.repo_id),
    entityNumber: nullableNumber(row.entity_number),
    eventKind: notificationEventKind(row.event_kind),
    actorLogin: nullableString(row.actor_login),
    actorIsBot: Boolean(row.actor_is_bot),
    title: String(row.title),
    bodyPreview: nullableString(row.body_preview),
    htmlUrl: nullableString(row.html_url),
    githubCreatedAt: nullableString(row.github_created_at),
    githubUpdatedAt: nullableString(row.github_updated_at),
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    importance: Number(row.importance ?? 0),
    promotesToMyWork: Boolean(row.promotes_to_my_work),
    collapseKey: nullableString(row.collapse_key),
    payload: parseObject(row.payload_json)
  };
}

export function mapAttentionState(row: Record<string, unknown>): AttentionLocalState {
  return {
    id: String(row.id),
    entityType: attentionEntityType(row.entity_type),
    repoId: String(row.repo_id),
    entityNumber: nullableNumber(row.entity_number),
    accountLogin: String(row.account_login),
    lastSeenEventId: nullableString(row.last_seen_event_id),
    lastSeenAt: nullableString(row.last_seen_at),
    readAt: nullableString(row.read_at),
    doneAt: nullableString(row.done_at),
    snoozedUntil: nullableString(row.snoozed_until),
    mutedUntil: nullableString(row.muted_until),
    pinnedAt: nullableString(row.pinned_at),
    manualPriority: nullableNumber(row.manual_priority),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function attentionStateRowId(state: AttentionLocalState): string {
  return `${state.accountLogin.toLowerCase()}:${attentionEntityId(state.entityType, state.repoId, state.entityNumber)}`;
}

export function attentionEntityId(entityType: AttentionEntityType, repoId: string, entityNumber: number | null): string {
  return `${entityType}:${repoId}:${entityNumber ?? "none"}`;
}

export function parseAttentionItemId(id: string): { entityType: AttentionEntityType; repoId: string; entityNumber: number | null } | null {
  const [entityType, repoId, rawNumber] = id.split(":");
  if (!entityType || !repoId) return null;
  return {
    entityType: attentionEntityType(entityType),
    repoId,
    entityNumber: rawNumber && rawNumber !== "none" ? Number(rawNumber) : null
  };
}

export function attentionEntityType(value: unknown): AttentionEntityType {
  return value === "pull_request" || value === "issue" || value === "check" || value === "workflow_run" || value === "bot_group"
    ? value
    : "pull_request";
}

export function notificationEventKind(value: unknown): NotificationEventRecord["eventKind"] {
  const known = [
    "comment",
    "review",
    "review_request",
    "commit_push",
    "check_failed",
    "check_passed",
    "workflow_failed",
    "workflow_passed",
    "assignment",
    "label",
    "state_change"
  ];
  return known.includes(String(value)) ? (String(value) as NotificationEventRecord["eventKind"]) : "state_change";
}

export function branchIntegrityMessage(status: BranchIntegrityStatusSummary["status"]): string {
  if (status === "incident") return "Critical branch integrity findings are open.";
  if (status === "at_risk") return "High severity branch integrity findings are open.";
  if (status === "warning") return "Branch integrity warnings need review.";
  if (status === "needs_audit") return "Branch history changed since the last full audit.";
  if (status === "monitoring") return "Monitoring branch snapshots and waiting for changed history.";
  if (status === "unavailable") return "Clone the repository locally to enable branch integrity checks.";
  return "No open branch integrity findings.";
}

export function branchSnapshotSource(value: unknown): BranchSnapshot["source"] {
  return value === "manual" || value === "pre_operation" || value === "post_operation" || value === "audit" ? value : "sync";
}

export function mergeMethod(value: unknown): MergeEvidence["mergeMethod"] {
  return value === "merge" || value === "squash" || value === "rebase" || value === "fast_forward" ? value : "unknown";
}

export function mergeSource(value: unknown): MergeEvidence["mergeSource"] {
  return value === "direct_push" || value === "pull_request" || value === "merge_queue" || value === "automation" || value === "manual"
    ? value
    : "unknown";
}

export function branchIntegritySeverity(value: unknown): BranchIntegrityFinding["severity"] {
  return value === "critical" || value === "high" || value === "medium" || value === "low" ? value : "low";
}

export function branchIntegrityKind(value: unknown): BranchIntegrityFinding["kind"] {
  const known = [
    "tested_tree_mismatch",
    "expected_tree_mismatch",
    "landed_diff_too_large",
    "landed_diff_too_small",
    "possible_reversion",
    "missing_pr_content",
    "unexpected_direct_push",
    "missing_merge_group_evidence",
    "unknown_merge_source",
    "checkpoint_gap"
  ];
  return known.includes(String(value)) ? (String(value) as BranchIntegrityFinding["kind"]) : "unknown_merge_source";
}

export function branchIntegrityConfidence(value: unknown): BranchIntegrityFinding["confidence"] {
  return value === "exact" || value === "strong" || value === "moderate" || value === "weak" ? value : "weak";
}

export function parseRecoveryPlan(value: unknown): BranchRecoveryPlan | null {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== "object") return null;
  return parsed as BranchRecoveryPlan;
}

export function signingMode(value: unknown): RepoSigningMode {
  return value === "unsigned" || value === "gpg" || value === "ssh" || value === "pixel" ? value : "unknown";
}

export function remoteProtocol(value: unknown): RepoRemoteProtocol {
  return value === "https" || value === "ssh" || value === "file" ? value : "unknown";
}

export function identityCheckStatus(value: unknown): RepoIdentityCheckStatus {
  return value === "ok" || value === "warning" || value === "failed" ? value : "unknown";
}

export function reviewEvent(value: unknown): PullRequestReviewEvent {
  return value === "APPROVE" || value === "REQUEST_CHANGES" ? value : "COMMENT";
}

export function parseReviewDraftComments(value: unknown): PullRequestReviewDraftComment[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isReviewDraftComment);
  } catch {
    return [];
  }
}

export function isReviewDraftComment(value: unknown): value is PullRequestReviewDraftComment {
  if (!value || typeof value !== "object") return false;
  const item = value as PullRequestReviewDraftComment;
  return (
    typeof item.id === "string" &&
    typeof item.fileId === "string" &&
    typeof item.path === "string" &&
    typeof item.body === "string" &&
    typeof item.line === "number" &&
    (item.side === "LEFT" || item.side === "RIGHT") &&
    (item.diffSide === "additions" || item.diffSide === "deletions")
  );
}

export function parseStringArray(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function parseNumberArray(value: unknown): number[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed.map(Number).filter((item) => Number.isSafeInteger(item) && item > 0) : [];
}

export function parseObject(value: unknown): Record<string, unknown> {
  const parsed = parseJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

export function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || !value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function mapHealthProbe(row: Record<string, unknown>): HealthProbeResult {
  return {
    repoId: nullableString(row.repo_id),
    repoFullName: nullableString(row.repo_full_name),
    surface: String(row.surface),
    status: String(row.status) as HealthProbeResult["status"],
    latencyMs: nullableNumber(row.latency_ms),
    httpStatus: nullableNumber(row.http_status),
    errorCode: nullableString(row.error_code),
    errorMessage: nullableString(row.error_message),
    checkedAt: String(row.checked_at)
  };
}

export function matrixRow(repoId: string | null, repoFullName: string, probes: HealthProbeResult[]): HealthMatrixRow {
  const bySurface = new Map(probes.map((probe) => [probe.surface, probe]));
  const at =
    probes
      .map((probe) => probe.checkedAt)
      .sort()
      .at(-1) ?? null;
  const worst = probes.find((probe) => probe.status !== "operational");
  return {
    repoId,
    repoFullName,
    git: bySurface.get("git")?.status ?? "unknown",
    api: bySurface.get("rest_api")?.status ?? bySurface.get("repo_metadata")?.status ?? "unknown",
    prs: bySurface.get("pull_requests")?.status ?? "unknown",
    issues: bySurface.get("issues")?.status ?? "unknown",
    comments: bySurface.get("comments")?.status ?? "unknown",
    checks: bySurface.get("checks")?.status ?? "unknown",
    actions: bySurface.get("actions")?.status ?? "unknown",
    checkedAt: at,
    message: worst?.errorMessage ?? null
  };
}

export function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export function nullableBooleanNumber(value: boolean | null | undefined): number | null {
  return value == null ? null : value ? 1 : 0;
}

export function nullableTokenSource(value: unknown): GitHubAccountSession["tokenSource"] {
  return value === "environment" || value === "keychain" ? value : null;
}

export function nullableAccountType(value: unknown): GitHubAccountSession["accountType"] {
  return value === "User" || value === "Organization" ? value : null;
}

export function nullableAuthStatus(value: unknown): GitHubAccountSession["authStatus"] {
  const status = nullableString(value);
  if (
    status === "connected" ||
    status === "expired" ||
    status === "revoked" ||
    status === "insufficient_scope" ||
    status === "org_sso_required" ||
    status === "rate_limited" ||
    status === "unknown_error"
  ) {
    return status;
  }
  return "connected";
}

export function normalizeGitHubEndpoint(endpoint: string | null | undefined): string {
  const value = endpoint?.trim() || "https://api.github.com";
  return value.replace(/\/+$/, "").toLowerCase();
}

export function githubAccountRowId(endpoint: string, githubUserId: string): string {
  return `github:${normalizeGitHubEndpoint(endpoint)}:${githubUserId}`;
}

let warnedStartupDirectorySize = false;

export function directorySize(rootPath: string | null, deadlineMs = Number.POSITIVE_INFINITY): number {
  if (!warnedStartupDirectorySize && hasStartupMark("process:start") && !isFirstUsableMarked()) {
    warnedStartupDirectorySize = true;
    console.warn("[perf] startup sync filesystem walk budget miss: directorySize called before first usable");
  }
  if (!rootPath || !fs.existsSync(rootPath)) return 0;
  const stat = fs.lstatSync(rootPath);
  if (!stat.isDirectory()) return stat.size;

  let total = 0;
  const stack = [rootPath];
  while (stack.length > 0) {
    if (Date.now() > deadlineMs) return total;
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (Date.now() > deadlineMs) return total;
      const entryPath = path.join(current, entry.name);
      const entryStat = fs.lstatSync(entryPath);
      total += entryStat.size;
      if (entry.isDirectory() && !entry.isSymbolicLink()) stack.push(entryPath);
    }
  }
  return total;
}

export function splitNames(value: unknown): string[] {
  return nullableString(value)?.split(",").filter(Boolean) ?? [];
}

export function escapeFtsQuery(query: string): string {
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `"${part.replaceAll('"', '""')}"`)
    .join(" ");
}

export function migrationFiles(): Array<{ version: string; name: string; sql: string }> {
  const migrationsDir = process.env.FALLBACK_MIGRATIONS_DIR
    ? path.resolve(process.env.FALLBACK_MIGRATIONS_DIR)
    : path.resolve(process.cwd(), "db", "migrations");
  if (!fs.existsSync(migrationsDir)) return [{ version: productionBaselineMigrationVersion(), name: "production_baseline", sql: "" }];
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort()
    .map((file) => ({
      version: file.split("_")[0] ?? file,
      name: file.replace(/^\d+_/, "").replace(/\.sql$/, ""),
      sql: fs.readFileSync(path.join(migrationsDir, file), "utf8")
    }));
}

export function productionBaselineMigrationVersion(): string {
  return SCHEMA_VERSION.padStart(4, "0");
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
