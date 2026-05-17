import type { ColumnType, Generated } from "kysely";

export type Timestamp = ColumnType<string, string | undefined, string>;

export interface RepoTable {
  id: string;
  github_repo_id: number;
  provider: string | null;
  owner: string;
  name: string;
  full_name: string;
  description: string | null;
  owner_avatar_url: string | null;
  is_private: number;
  is_fork: number;
  default_branch: string | null;
  html_url: string | null;
  clone_url: string | null;
  ssh_url: string | null;
  visibility: string | null;
  pushed_at: string | null;
  github_updated_at: string | null;
  workspace_path: string | null;
  local_path: string | null;
  watch_mode: string | null;
  clone_enabled: number;
  clone_status: string | null;
  last_git_fetch_at: string | null;
  watch_enabled: number;
  watch_priority: number;
  last_synced_at: string | null;
  last_successful_sync_at: string | null;
  sync_status: string;
  sync_error: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SyncJobTable {
  id: string;
  repo_id: string | null;
  account_id: string | null;
  provider: string | null;
  job_type: string;
  status: string;
  priority: number;
  reason: string | null;
  not_before: string | null;
  attempt_count: number;
  last_error_code: string | null;
  dedupe_key: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  github_rate_limit_remaining: number | null;
  github_rate_limit_reset_at: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface RepoAccountTable {
  repo_id: string;
  account_id: string;
  endpoint: string;
  watch_enabled: number;
  permission_admin: number | null;
  permission_push: number | null;
  permission_pull: number | null;
  last_synced_at: string | null;
  last_successful_sync_at: string | null;
  sync_status: string | null;
  sync_error: string | null;
  updated_at: Timestamp;
}

export interface WorkflowRunTable {
  id: string;
  repo_id: string;
  github_workflow_run_id: number;
  workflow_name: string | null;
  display_title: string | null;
  run_number: number | null;
  run_attempt: number | null;
  event: string | null;
  status: string | null;
  conclusion: string | null;
  head_branch: string | null;
  head_sha: string | null;
  html_url: string | null;
  actor_login: string | null;
  workflow_path: string | null;
  run_started_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  last_synced_at: string | null;
}

export interface AppMetadataTable {
  key: string;
  value: string;
  updated_at: Timestamp;
}

export interface DiagnosticEventTable {
  id: string;
  source: string;
  level: string;
  code: string;
  message: string | null;
  created_at: Timestamp;
}

export interface RepoIdentityTable {
  repo_id: string;
  account_id: string | null;
  endpoint: string;
  git_name: string | null;
  git_email: string | null;
  signing_mode: string;
  signing_key_hint: string | null;
  remote_protocol: string;
  verified_email_status: string;
  last_checked_at: string | null;
  last_check_status: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface OperationTable {
  id: string;
  repo_id: string | null;
  workspace_id: string | null;
  workspace_path: string | null;
  workspace_branch: string | null;
  kind: string;
  status: string;
  risk_level: string;
  command_summary: string | null;
  redacted_command: string | null;
  recovery_head_sha: string | null;
  recovery_branch: string | null;
  recovery_is_dirty: number | null;
  recovery_file_count: number | null;
  recovery_stash_refs: string | null;
  recovery_hint: string | null;
  recovery_reflog_hint: string | null;
  recovery_ref: string | null;
  result_summary: string | null;
  result_stash_refs: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  error_code: string | null;
  error_message: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface RepoWorkspaceTable {
  id: string;
  repo_id: string;
  kind: string;
  local_path: string;
  git_common_dir: string | null;
  git_dir: string | null;
  main_worktree_path: string | null;
  branch: string | null;
  head_sha: string | null;
  is_active: number;
  is_dirty: number | null;
  locked: number;
  lock_reason: string | null;
  prunable: number;
  prune_reason: string | null;
  detached: number;
  bare: number;
  missing: number;
  last_seen_at: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface BranchSnapshotTable {
  id: string;
  repo_id: string;
  branch_name: string;
  remote_name: string;
  head_sha: string;
  tree_sha: string;
  parent_sha: string | null;
  first_parent_sha: string | null;
  committed_at: string | null;
  observed_at: string;
  source: string;
  checkpoint_ref: string | null;
  notes: string | null;
}

export interface MergeEvidenceTable {
  id: string;
  repo_id: string;
  branch_name: string;
  landed_sha: string | null;
  landed_tree_sha: string | null;
  landed_parent_sha: string | null;
  pr_numbers_json: string;
  merge_method: string;
  merge_source: string;
  expected_head_sha: string | null;
  expected_tree_sha: string | null;
  tested_sha: string | null;
  tested_tree_sha: string | null;
  merge_group_ref: string | null;
  workflow_run_id: number | null;
  workflow_run_url: string | null;
  check_state: string | null;
  observed_at: string;
}

export interface BranchIntegrityFindingTable {
  id: string;
  repo_id: string;
  branch_name: string;
  severity: string;
  kind: string;
  status: string;
  title: string;
  summary: string;
  landed_sha: string | null;
  expected_sha: string | null;
  landed_tree_sha: string | null;
  expected_tree_sha: string | null;
  pr_numbers_json: string;
  evidence_json: string;
  recovery_plan_json: string | null;
  confidence: string;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
}

export interface PullRequestCommitTable {
  repo_id: string;
  pr_number: number;
  sha: string;
  tree_sha: string | null;
  message: string | null;
  authored_at: string | null;
  committed_at: string | null;
  last_synced_at: string;
}

export interface CompareCacheTable {
  repo_id: string;
  base_sha: string;
  head_sha: string;
  status: string | null;
  ahead_by: number | null;
  behind_by: number | null;
  total_commits: number | null;
  additions: number | null;
  deletions: number | null;
  changed_files: number | null;
  payload_json: string | null;
  last_synced_at: string;
}

export interface AttentionStateTable {
  id: string;
  entity_type: string;
  repo_id: string;
  entity_number: number | null;
  account_login: string;
  last_seen_event_id: string | null;
  last_seen_at: string | null;
  read_at: string | null;
  done_at: string | null;
  snoozed_until: string | null;
  muted_until: string | null;
  pinned_at: string | null;
  manual_priority: number | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationEventTable {
  id: string;
  event_key: string;
  entity_type: string;
  repo_id: string;
  entity_number: number | null;
  event_kind: string;
  actor_login: string | null;
  actor_is_bot: number;
  title: string;
  body_preview: string | null;
  html_url: string | null;
  github_created_at: string | null;
  github_updated_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  importance: number;
  promotes_to_my_work: number;
  collapse_key: string | null;
  payload_json: string | null;
}

export interface FallbackDatabase {
  app_metadata: AppMetadataTable;
  attention_states: AttentionStateTable;
  branch_integrity_findings: BranchIntegrityFindingTable;
  branch_snapshots: BranchSnapshotTable;
  notification_events: NotificationEventTable;
  diagnostic_events: DiagnosticEventTable;
  merge_evidence: MergeEvidenceTable;
  operations: OperationTable;
  compare_cache: CompareCacheTable;
  pull_request_commits: PullRequestCommitTable;
  repo_identities: RepoIdentityTable;
  repo_workspaces: RepoWorkspaceTable;
  repo_accounts: RepoAccountTable;
  repos: RepoTable;
  sync_jobs: SyncJobTable;
  workflow_runs: WorkflowRunTable;
  search_index: {
    rowid: Generated<number>;
    entity_id: string;
    repo_id: string;
    entity_type: string;
    entity_number: number;
    title: string | null;
    body: string | null;
    author_login: string | null;
    state: string | null;
    labels: string | null;
    created_at: string | null;
    updated_at: string | null;
  };
  label_names: {
    repo_id: string;
    entity_type: string;
    entity_number: number;
    names: string | null;
  };
  pr_review_state: {
    repo_id: string;
    pr_number: number;
    review_state: string | null;
  };
}
