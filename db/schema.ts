export const SCHEMA_VERSION = "15";

export const INITIAL_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS app_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    convex_user_id TEXT,
    github_user_id TEXT,
    github_login TEXT,
    github_avatar_url TEXT,
    github_avatar_cached_url TEXT,
    github_endpoint TEXT NOT NULL DEFAULT 'https://api.github.com',
    github_html_url TEXT,
    github_name TEXT,
    github_account_type TEXT,
    profile_name TEXT,
    profile_color TEXT,
    profile_last_selected_at TEXT,
    profile_hidden INTEGER NOT NULL DEFAULT 0,
    token_source TEXT,
    token_scopes TEXT,
    auth_status TEXT NOT NULL DEFAULT 'connected',
    last_validated_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(github_endpoint, github_user_id)
  );

  CREATE TABLE IF NOT EXISTS repo_accounts (
    repo_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    endpoint TEXT NOT NULL DEFAULT 'https://api.github.com',
    watch_enabled INTEGER NOT NULL DEFAULT 0,
    permission_admin INTEGER,
    permission_push INTEGER,
    permission_pull INTEGER,
    last_synced_at TEXT,
    last_successful_sync_at TEXT,
    sync_status TEXT,
    sync_error TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (repo_id, account_id),
    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS repo_identities (
    repo_id TEXT PRIMARY KEY,
    account_id TEXT,
    endpoint TEXT NOT NULL DEFAULT 'https://api.github.com',
    git_name TEXT,
    git_email TEXT,
    signing_mode TEXT NOT NULL DEFAULT 'unknown',
    signing_key_hint TEXT,
    remote_protocol TEXT NOT NULL DEFAULT 'unknown',
    verified_email_status TEXT NOT NULL DEFAULT 'unknown',
    last_checked_at TEXT,
    last_check_status TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS repos (
    id TEXT PRIMARY KEY,
    github_repo_id INTEGER NOT NULL UNIQUE,
    provider TEXT DEFAULT 'github.com',
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    full_name TEXT NOT NULL UNIQUE,
    description TEXT,
    owner_avatar_url TEXT,
    is_private INTEGER NOT NULL DEFAULT 0,
    is_fork INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    has_issues INTEGER NOT NULL DEFAULT 1,
    is_template INTEGER NOT NULL DEFAULT 0,
    language TEXT,
    permission_admin INTEGER,
    permission_push INTEGER,
    permission_pull INTEGER,
    default_branch TEXT,
    html_url TEXT,
    clone_url TEXT,
    ssh_url TEXT,
    visibility TEXT,
    pushed_at TEXT,
    github_updated_at TEXT,
    workspace_path TEXT,
    local_path TEXT,
    watch_mode TEXT DEFAULT 'metadata-only',
    clone_enabled INTEGER NOT NULL DEFAULT 0,
    clone_status TEXT DEFAULT 'not_cloned',
    last_git_fetch_at TEXT,
    watch_enabled INTEGER NOT NULL DEFAULT 0,
    watch_priority INTEGER NOT NULL DEFAULT 0,
    last_synced_at TEXT,
    last_successful_sync_at TEXT,
    sync_status TEXT NOT NULL DEFAULT 'never_synced',
    sync_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS repo_workspaces (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'clone',
    local_path TEXT NOT NULL,
    git_common_dir TEXT,
    git_dir TEXT,
    main_worktree_path TEXT,
    branch TEXT,
    head_sha TEXT,
    is_active INTEGER NOT NULL DEFAULT 0,
    is_dirty INTEGER,
    locked INTEGER NOT NULL DEFAULT 0,
    lock_reason TEXT,
    prunable INTEGER NOT NULL DEFAULT 0,
    prune_reason TEXT,
    detached INTEGER NOT NULL DEFAULT 0,
    bare INTEGER NOT NULL DEFAULT 0,
    missing INTEGER NOT NULL DEFAULT 0,
    last_seen_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    UNIQUE(repo_id, local_path)
  );

  CREATE TABLE IF NOT EXISTS pull_requests (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL,
    github_pr_id INTEGER NOT NULL,
    number INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    author_login TEXT,
    assignee_logins TEXT,
    requested_reviewer_logins TEXT,
    state TEXT NOT NULL,
    is_draft INTEGER NOT NULL DEFAULT 0,
    locked INTEGER NOT NULL DEFAULT 0,
    merged INTEGER NOT NULL DEFAULT 0,
    mergeable INTEGER,
    mergeable_state TEXT,
    base_branch TEXT,
    head_branch TEXT,
    base_sha TEXT,
    head_sha TEXT,
    additions INTEGER,
    deletions INTEGER,
    changed_files INTEGER,
    comments_count INTEGER,
    review_comments_count INTEGER,
    review_state TEXT,
    commits_count INTEGER,
    html_url TEXT,
    diff_url TEXT,
    patch_url TEXT,
    created_at TEXT,
    updated_at TEXT,
    closed_at TEXT,
    merged_at TEXT,
    last_synced_at TEXT,
    FOREIGN KEY (repo_id) REFERENCES repos(id),
    UNIQUE(repo_id, number)
  );

  CREATE TABLE IF NOT EXISTS repo_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS repo_group_memberships (
    group_id TEXT NOT NULL,
    repo_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (group_id, repo_id),
    FOREIGN KEY (group_id) REFERENCES repo_groups(id) ON DELETE CASCADE,
    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS issues (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL,
    github_issue_id INTEGER NOT NULL,
    number INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    author_login TEXT,
    assignee_logins TEXT,
    state TEXT NOT NULL,
    issue_type_name TEXT,
    locked INTEGER NOT NULL DEFAULT 0,
    comments_count INTEGER,
    html_url TEXT,
    created_at TEXT,
    updated_at TEXT,
    closed_at TEXT,
    last_synced_at TEXT,
    is_pull_request INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (repo_id) REFERENCES repos(id),
    UNIQUE(repo_id, number)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_number INTEGER NOT NULL,
    github_comment_id INTEGER NOT NULL,
    author_login TEXT,
    body TEXT,
    html_url TEXT,
    path TEXT,
    position INTEGER,
    original_position INTEGER,
    commit_id TEXT,
    original_commit_id TEXT,
    diff_hunk TEXT,
    created_at TEXT,
    updated_at TEXT,
    last_synced_at TEXT,
    FOREIGN KEY (repo_id) REFERENCES repos(id),
    UNIQUE(repo_id, entity_type, github_comment_id)
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL,
    pr_number INTEGER NOT NULL,
    github_review_id INTEGER NOT NULL,
    author_login TEXT,
    state TEXT NOT NULL,
    body TEXT,
    html_url TEXT,
    commit_id TEXT,
    submitted_at TEXT,
    last_synced_at TEXT,
    FOREIGN KEY (repo_id) REFERENCES repos(id),
    UNIQUE(repo_id, github_review_id)
  );

  CREATE TABLE IF NOT EXISTS pr_review_drafts (
    repo_id TEXT NOT NULL,
    pr_number INTEGER NOT NULL,
    head_sha TEXT NOT NULL,
    event TEXT NOT NULL DEFAULT 'COMMENT',
    body TEXT,
    comments_json TEXT NOT NULL DEFAULT '[]',
    reviewed_files_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (repo_id, pr_number, head_sha),
    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS labels (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL,
    github_label_id INTEGER,
    name TEXT NOT NULL,
    color TEXT,
    description TEXT,
    FOREIGN KEY (repo_id) REFERENCES repos(id),
    UNIQUE(repo_id, name)
  );

  CREATE TABLE IF NOT EXISTS issue_types (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL,
    github_issue_type_id INTEGER,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT,
    updated_at TEXT,
    last_synced_at TEXT,
    FOREIGN KEY (repo_id) REFERENCES repos(id),
    UNIQUE(repo_id, name)
  );

  CREATE TABLE IF NOT EXISTS issue_field_options (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL,
    field_name TEXT NOT NULL,
    option_id INTEGER,
    option_name TEXT NOT NULL,
    color TEXT,
    description TEXT,
    last_synced_at TEXT,
    FOREIGN KEY (repo_id) REFERENCES repos(id),
    UNIQUE(repo_id, field_name, option_name)
  );

  CREATE TABLE IF NOT EXISTS entity_labels (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_number INTEGER NOT NULL,
    label_id TEXT NOT NULL,
    FOREIGN KEY (repo_id) REFERENCES repos(id),
    FOREIGN KEY (label_id) REFERENCES labels(id),
    UNIQUE(repo_id, entity_type, entity_number, label_id)
  );

  CREATE TABLE IF NOT EXISTS user_pull_requests (
    repo_id TEXT NOT NULL,
    pr_number INTEGER NOT NULL,
    github_user_login TEXT NOT NULL,
    relation TEXT NOT NULL,
    last_synced_at TEXT NOT NULL,
    PRIMARY KEY (repo_id, pr_number, github_user_login),
    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_issues (
    repo_id TEXT NOT NULL,
    issue_number INTEGER NOT NULL,
    github_user_login TEXT NOT NULL,
    relation TEXT NOT NULL,
    last_synced_at TEXT NOT NULL,
    PRIMARY KEY (repo_id, issue_number, github_user_login),
    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS issue_backfill_cursors (
    repo_id TEXT NOT NULL,
    state TEXT NOT NULL,
    next_page INTEGER NOT NULL DEFAULT 1,
    completed_at TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (repo_id, state),
    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS github_page_cache (
    repo_id TEXT NOT NULL,
    cache_key TEXT NOT NULL,
    etag TEXT,
    last_modified TEXT,
    payload TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (repo_id, cache_key),
    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS check_runs (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL,
    pr_number INTEGER,
    commit_sha TEXT NOT NULL,
    github_check_run_id INTEGER,
    name TEXT NOT NULL,
    status TEXT,
    conclusion TEXT,
    started_at TEXT,
    completed_at TEXT,
    html_url TEXT,
    details_url TEXT,
    last_synced_at TEXT,
    FOREIGN KEY (repo_id) REFERENCES repos(id),
    UNIQUE(repo_id, github_check_run_id)
  );

  CREATE TABLE IF NOT EXISTS commit_statuses (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL,
    commit_sha TEXT NOT NULL,
    context TEXT NOT NULL,
    state TEXT NOT NULL,
    description TEXT,
    target_url TEXT,
    created_at TEXT,
    updated_at TEXT,
    last_synced_at TEXT,
    FOREIGN KEY (repo_id) REFERENCES repos(id),
    UNIQUE(repo_id, commit_sha, context)
  );

  CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL,
    github_workflow_run_id INTEGER NOT NULL,
    workflow_name TEXT,
    display_title TEXT,
    run_number INTEGER,
    run_attempt INTEGER,
    event TEXT,
    status TEXT,
    conclusion TEXT,
    head_branch TEXT,
    head_sha TEXT,
    html_url TEXT,
    actor_login TEXT,
    workflow_path TEXT,
    run_started_at TEXT,
    created_at TEXT,
    updated_at TEXT,
    last_synced_at TEXT,
    FOREIGN KEY (repo_id) REFERENCES repos(id),
    UNIQUE(repo_id, github_workflow_run_id)
  );

  CREATE TABLE IF NOT EXISTS sync_jobs (
    id TEXT PRIMARY KEY,
    repo_id TEXT,
    account_id TEXT,
    provider TEXT DEFAULT 'github.com',
    job_type TEXT NOT NULL,
    status TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    not_before TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error_code TEXT,
    dedupe_key TEXT,
    started_at TEXT,
    completed_at TEXT,
    error_code TEXT,
    error_message TEXT,
    progress_message TEXT,
    github_rate_limit_remaining INTEGER,
    github_rate_limit_reset_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (repo_id) REFERENCES repos(id)
  );

  CREATE TABLE IF NOT EXISTS operations (
    id TEXT PRIMARY KEY,
    repo_id TEXT,
    workspace_id TEXT,
    workspace_path TEXT,
    workspace_branch TEXT,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    risk_level TEXT NOT NULL DEFAULT 'normal',
    command_summary TEXT,
    redacted_command TEXT,
    recovery_head_sha TEXT,
    recovery_branch TEXT,
    recovery_is_dirty INTEGER,
    recovery_file_count INTEGER,
    recovery_stash_refs TEXT,
    recovery_hint TEXT,
    recovery_reflog_hint TEXT,
    recovery_ref TEXT,
    result_summary TEXT,
    result_stash_refs TEXT,
    started_at TEXT,
    completed_at TEXT,
    duration_ms INTEGER,
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE SET NULL,
    FOREIGN KEY (workspace_id) REFERENCES repo_workspaces(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS health_probes (
    id TEXT PRIMARY KEY,
    repo_id TEXT,
    surface TEXT NOT NULL,
    status TEXT NOT NULL,
    latency_ms INTEGER,
    http_status INTEGER,
    error_code TEXT,
    error_message TEXT,
    checked_at TEXT NOT NULL,
    FOREIGN KEY (repo_id) REFERENCES repos(id)
  );

  CREATE TABLE IF NOT EXISTS diagnostic_events (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    level TEXT NOT NULL,
    code TEXT NOT NULL,
    message TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS offline_actions (
    id TEXT PRIMARY KEY,
    account_id TEXT,
    repo_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_number INTEGER NOT NULL,
    title TEXT,
    body TEXT NOT NULL,
    payload_json TEXT,
    status TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    last_attempt_at TEXT,
    upstream_last_seen_sha TEXT,
    upstream_last_seen_updated_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    posted_at TEXT,
    last_error_code TEXT,
    last_error TEXT,
    FOREIGN KEY (repo_id) REFERENCES repos(id),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS local_check_runs (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL,
    command TEXT NOT NULL,
    working_directory TEXT,
    branch TEXT,
    commit_sha TEXT,
    status TEXT NOT NULL,
    exit_code INTEGER,
    stdout_path TEXT,
    stderr_path TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (repo_id) REFERENCES repos(id)
  );

  CREATE TABLE IF NOT EXISTS branch_snapshots (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL,
    branch_name TEXT NOT NULL,
    remote_name TEXT NOT NULL DEFAULT 'origin',
    head_sha TEXT NOT NULL,
    tree_sha TEXT NOT NULL,
    parent_sha TEXT,
    first_parent_sha TEXT,
    committed_at TEXT,
    observed_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'sync',
    checkpoint_ref TEXT,
    notes TEXT,
    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    UNIQUE(repo_id, branch_name, head_sha, source)
  );

  CREATE TABLE IF NOT EXISTS merge_evidence (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL,
    branch_name TEXT NOT NULL,
    landed_sha TEXT,
    landed_tree_sha TEXT,
    landed_parent_sha TEXT,
    pr_numbers_json TEXT NOT NULL DEFAULT '[]',
    merge_method TEXT NOT NULL DEFAULT 'unknown',
    merge_source TEXT NOT NULL DEFAULT 'unknown',
    expected_head_sha TEXT,
    expected_tree_sha TEXT,
    tested_sha TEXT,
    tested_tree_sha TEXT,
    merge_group_ref TEXT,
    workflow_run_id INTEGER,
    workflow_run_url TEXT,
    check_state TEXT,
    observed_at TEXT NOT NULL,
    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS branch_integrity_findings (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL,
    branch_name TEXT NOT NULL,
    severity TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    landed_sha TEXT,
    expected_sha TEXT,
    landed_tree_sha TEXT,
    expected_tree_sha TEXT,
    pr_numbers_json TEXT NOT NULL DEFAULT '[]',
    evidence_json TEXT NOT NULL DEFAULT '{}',
    recovery_plan_json TEXT,
    confidence TEXT NOT NULL DEFAULT 'weak',
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    resolved_at TEXT,
    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS pull_request_commits (
    repo_id TEXT NOT NULL,
    pr_number INTEGER NOT NULL,
    sha TEXT NOT NULL,
    tree_sha TEXT,
    message TEXT,
    authored_at TEXT,
    committed_at TEXT,
    last_synced_at TEXT NOT NULL,
    PRIMARY KEY (repo_id, pr_number, sha),
    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS compare_cache (
    repo_id TEXT NOT NULL,
    base_sha TEXT NOT NULL,
    head_sha TEXT NOT NULL,
    status TEXT,
    ahead_by INTEGER,
    behind_by INTEGER,
    total_commits INTEGER,
    additions INTEGER,
    deletions INTEGER,
    changed_files INTEGER,
    payload_json TEXT,
    last_synced_at TEXT NOT NULL,
    PRIMARY KEY (repo_id, base_sha, head_sha),
    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS attention_states (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    repo_id TEXT NOT NULL,
    entity_number INTEGER,
    account_login TEXT NOT NULL,
    last_seen_event_id TEXT,
    last_seen_at TEXT,
    read_at TEXT,
    done_at TEXT,
    snoozed_until TEXT,
    muted_until TEXT,
    pinned_at TEXT,
    manual_priority INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    UNIQUE(entity_type, repo_id, entity_number, account_login)
  );

  CREATE TABLE IF NOT EXISTS notification_events (
    id TEXT PRIMARY KEY,
    event_key TEXT NOT NULL UNIQUE,
    entity_type TEXT NOT NULL,
    repo_id TEXT NOT NULL,
    entity_number INTEGER,
    event_kind TEXT NOT NULL,
    actor_login TEXT,
    actor_is_bot INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    body_preview TEXT,
    html_url TEXT,
    github_created_at TEXT,
    github_updated_at TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    importance INTEGER NOT NULL DEFAULT 0,
    promotes_to_my_work INTEGER NOT NULL DEFAULT 0,
    collapse_key TEXT,
    payload_json TEXT,
    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
    entity_id UNINDEXED,
    repo_id UNINDEXED,
    entity_type UNINDEXED,
    entity_number UNINDEXED,
    title,
    body,
    author_login,
    state,
    labels,
    created_at UNINDEXED,
    updated_at UNINDEXED
  );

  CREATE VIEW IF NOT EXISTS label_names AS
    SELECT
      el.repo_id,
      el.entity_type,
      el.entity_number,
      GROUP_CONCAT(l.name, ',') AS names
    FROM entity_labels el
    JOIN labels l ON l.id = el.label_id
    GROUP BY el.repo_id, el.entity_type, el.entity_number;

  CREATE VIEW IF NOT EXISTS pr_review_state AS
    SELECT
      repo_id,
      pr_number,
      CASE
        WHEN SUM(CASE WHEN state = 'CHANGES_REQUESTED' THEN 1 ELSE 0 END) > 0 THEN 'changes requested'
        WHEN SUM(CASE WHEN state = 'APPROVED' THEN 1 ELSE 0 END) > 0 THEN 'approved'
        WHEN COUNT(*) > 0 THEN 'reviewed'
        ELSE NULL
      END AS review_state
    FROM reviews
    GROUP BY repo_id, pr_number;

  CREATE INDEX IF NOT EXISTS idx_pull_requests_repo_updated_number
    ON pull_requests(repo_id, updated_at DESC, number DESC);

  CREATE INDEX IF NOT EXISTS idx_pull_requests_repo_number
    ON pull_requests(repo_id, number);

  CREATE INDEX IF NOT EXISTS idx_issues_repo_kind_updated_number
    ON issues(repo_id, is_pull_request, updated_at DESC, number DESC);
  CREATE INDEX IF NOT EXISTS idx_issues_repo_kind_state_updated_number
    ON issues(repo_id, is_pull_request, state, updated_at DESC, number DESC);

  CREATE INDEX IF NOT EXISTS idx_issues_repo_number
    ON issues(repo_id, number);

  CREATE INDEX IF NOT EXISTS idx_entity_labels_lookup
    ON entity_labels(repo_id, entity_type, entity_number);

  CREATE INDEX IF NOT EXISTS idx_reviews_repo_pr_state
    ON reviews(repo_id, pr_number, state);

  CREATE INDEX IF NOT EXISTS idx_check_runs_repo_sha
    ON check_runs(repo_id, commit_sha);

  CREATE INDEX IF NOT EXISTS idx_commit_statuses_repo_sha
    ON commit_statuses(repo_id, commit_sha);

  CREATE INDEX IF NOT EXISTS idx_repo_accounts_account_watch
    ON repo_accounts(account_id, watch_enabled, repo_id);

  CREATE INDEX IF NOT EXISTS idx_repos_watch_priority_name
    ON repos(watch_enabled, watch_priority DESC, full_name ASC);

  CREATE INDEX IF NOT EXISTS idx_sync_jobs_status_repo_created
    ON sync_jobs(status, repo_id, created_at);

  CREATE INDEX IF NOT EXISTS idx_repo_group_memberships_repo_group
    ON repo_group_memberships(repo_id, group_id);

  CREATE INDEX IF NOT EXISTS idx_comments_repo_updated_created
    ON comments(repo_id, updated_at DESC, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_workflow_runs_repo_started_updated
    ON workflow_runs(repo_id, run_started_at DESC, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_check_runs_repo_pr_commit
    ON check_runs(repo_id, pr_number, commit_sha);

  CREATE INDEX IF NOT EXISTS idx_commit_statuses_repo_commit_updated
    ON commit_statuses(repo_id, commit_sha, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_branch_snapshots_repo_branch_observed
    ON branch_snapshots(repo_id, branch_name, observed_at DESC);

  CREATE INDEX IF NOT EXISTS idx_branch_snapshots_repo_tree
    ON branch_snapshots(repo_id, tree_sha);

  CREATE INDEX IF NOT EXISTS idx_merge_evidence_repo_landed
    ON merge_evidence(repo_id, landed_sha);

  CREATE INDEX IF NOT EXISTS idx_merge_evidence_repo_branch_observed
    ON merge_evidence(repo_id, branch_name, observed_at DESC);

  CREATE INDEX IF NOT EXISTS idx_branch_integrity_findings_repo_status
    ON branch_integrity_findings(repo_id, status, severity, last_seen_at DESC);

  CREATE INDEX IF NOT EXISTS idx_pull_request_commits_repo_pr
    ON pull_request_commits(repo_id, pr_number);

  CREATE INDEX IF NOT EXISTS idx_compare_cache_repo_synced
    ON compare_cache(repo_id, last_synced_at DESC);

  CREATE INDEX IF NOT EXISTS idx_attention_states_lookup
    ON attention_states(entity_type, repo_id, entity_number, account_login);

  CREATE INDEX IF NOT EXISTS idx_notification_events_entity
    ON notification_events(repo_id, entity_type, entity_number);

  CREATE INDEX IF NOT EXISTS idx_notification_events_updated
    ON notification_events(github_updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_notification_events_collapse
    ON notification_events(collapse_key);

  CREATE INDEX IF NOT EXISTS idx_notification_events_promoted
    ON notification_events(promotes_to_my_work, github_updated_at DESC);
`;
