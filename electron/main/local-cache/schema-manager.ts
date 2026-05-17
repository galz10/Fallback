import type Database from "better-sqlite3";
import fs from "node:fs";
import { INITIAL_SCHEMA_SQL, SCHEMA_VERSION } from "../../../db/schema.js";
import { nowIso } from "../path-utils.js";
import type { LocalCacheStores } from "./index.js";
import {
  errorMessage,
  migrationFiles,
  performanceIndexSetMetadataKey,
  performanceIndexSetVersion,
  primaryWorkspaceDraft,
  productionBaselineMigrationVersion
} from "./store-helpers.js";

type SqliteDatabase = ReturnType<typeof Database>;

export class LocalCacheSchemaManager {
  constructor(
    private readonly databasePath: string,
    private readonly db: SqliteDatabase,
    private readonly stores: LocalCacheStores
  ) {}

  migrateWithBackup(): void {
    const backupPath = this.createPreMigrationBackupIfNeeded();
    try {
      this.migrate();
    } catch (error) {
      const hint = backupPath ? ` A pre-migration backup was preserved at ${backupPath}.` : "";
      this.recordMigrationFailureDiagnostic(error, backupPath);
      throw new Error(`${errorMessage(error)}${hint}`, { cause: error });
    }
  }

  private recordMigrationFailureDiagnostic(error: unknown, backupPath: string | null): void {
    try {
      this.db.exec(INITIAL_SCHEMA_SQL);
      this.stores.diagnostics.recordDiagnosticEvent({
        source: "database",
        level: "error",
        code: "schema_migration_failed",
        message: `${errorMessage(error)}${backupPath ? ` Backup: ${backupPath}.` : ""}`
      });
    } catch {
      // If the database cannot accept diagnostics, preserving the original error
      // and backup path is still the actionable failure mode.
    }
  }

  schemaReadyForStartup(): boolean {
    try {
      if (!this.tableExists("app_metadata")) return false;
      if (this.stores.appMetadata.schemaVersion() !== SCHEMA_VERSION) return false;
      if (!this.appliedSchemaMigrationVersions().includes(productionBaselineMigrationVersion())) return false;
      if (!this.requiredCurrentSchemaObjectsExist()) return false;
      return this.stores.appMetadata.getAppMetadata(performanceIndexSetMetadataKey) === performanceIndexSetVersion;
    } catch {
      return false;
    }
  }

  private migrate(): void {
    this.ensureInitialSchemaIndexPrerequisites();
    this.db.exec(INITIAL_SCHEMA_SQL);
    const currentVersion = this.stores.appMetadata.schemaVersion();
    this.ensureColumns("pull_requests", {
      assignee_logins: "TEXT",
      requested_reviewer_logins: "TEXT",
      review_state: "TEXT"
    });
    this.ensureColumns("issues", { assignee_logins: "TEXT", issue_type_name: "TEXT" });
    this.ensureColumns("repos", {
      owner_avatar_url: "TEXT",
      archived: "INTEGER NOT NULL DEFAULT 0",
      has_issues: "INTEGER NOT NULL DEFAULT 1",
      is_template: "INTEGER NOT NULL DEFAULT 0",
      language: "TEXT",
      permission_admin: "INTEGER",
      permission_push: "INTEGER",
      permission_pull: "INTEGER"
    });
    this.ensureColumns("sync_jobs", {
      account_id: "TEXT",
      provider: "TEXT DEFAULT 'github.com'",
      progress_message: "TEXT",
      priority: "INTEGER NOT NULL DEFAULT 0",
      reason: "TEXT",
      not_before: "TEXT",
      attempt_count: "INTEGER NOT NULL DEFAULT 0",
      last_error_code: "TEXT",
      dedupe_key: "TEXT"
    });
    this.ensureRepoMetadataCache();
    this.ensureUserPullRequests();
    this.ensureUserIssues();
    this.ensureIssueMetadataCatalogs();
    this.ensureIssueBackfillCursors();
    this.ensureGitHubPageCache();
    this.ensureWorkflowRuns();
    this.ensureBranchIntegrityTables();
    this.ensureAttentionTables();
    this.ensureAccountColumns();
    this.ensureRepoAccounts();
    this.ensureRepoIdentities();
    this.ensureRepoWorkspaces();
    this.ensureRepoGroups();
    this.ensureOperations();
    this.ensureOfflineActions();
    this.ensurePullRequestReviewDrafts();
    this.ensureSearchIndexColumns();
    this.ensureSummarySnapshotTables();
    this.ensurePerformanceIndexes();
    this.ensureSchemaMigrations(currentVersion);
    this.db
      .prepare(
        `INSERT INTO app_metadata (key, value, updated_at)
             VALUES ('schema_version', ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(SCHEMA_VERSION, nowIso());
    if (currentVersion !== SCHEMA_VERSION) {
      this.stores.diagnostics.recordDiagnosticEvent({
        source: "database",
        level: "info",
        code: "schema_migrated",
        message: `Schema migrated from ${currentVersion} to ${SCHEMA_VERSION}.`
      });
    }
  }

  private createPreMigrationBackupIfNeeded(): string | null {
    if (!fs.existsSync(this.databasePath) || fs.statSync(this.databasePath).size === 0) return null;
    const version = this.tableExists("app_metadata") ? this.stores.appMetadata.schemaVersion() : "unknown";
    if (version === SCHEMA_VERSION && this.appliedSchemaMigrationVersions().includes(productionBaselineMigrationVersion())) return null;
    const backupPath = `${this.databasePath}.pre-migration-${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
    fs.copyFileSync(this.databasePath, backupPath);
    return backupPath;
  }

  private ensureSchemaMigrations(previousVersion: string): void {
    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
              version TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              applied_at TEXT NOT NULL
            )`
      )
      .run();
    const applied = new Set(this.appliedSchemaMigrationVersions());
    for (const migration of migrationFiles()) {
      if (applied.has(migration.version)) continue;
      const applyMigration = this.db.transaction(() => {
        if (migration.sql.trim()) this.db.exec(migration.sql);
        this.db
          .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
          .run(migration.version, migration.name, nowIso());
      });
      applyMigration();
    }
    if (previousVersion !== SCHEMA_VERSION) {
      this.stores.appMetadata.setAppMetadata("schema_migration_backup_policy", "pre-migration database copy before schema changes");
    }
  }

  private appliedSchemaMigrationVersions(): string[] {
    if (!this.tableExists("schema_migrations")) return [];
    return (this.db.prepare("SELECT version FROM schema_migrations ORDER BY version ASC").all() as Array<{ version: string }>).map(
      (row) => row.version
    );
  }

  private tableExists(table: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    return Boolean(row);
  }

  private requiredCurrentSchemaObjectsExist(): boolean {
    return this.tableExists("issue_types") && this.tableExists("issue_field_options") && this.columnExists("issues", "issue_type_name");
  }

  private columnExists(table: string, column: string): boolean {
    if (!this.tableExists(table)) return false;
    return (this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((row) => row.name === column);
  }

  private ensureAccountColumns(): void {
    this.ensureColumns("accounts", {
      github_endpoint: "TEXT NOT NULL DEFAULT 'https://api.github.com'",
      github_avatar_cached_url: "TEXT",
      github_html_url: "TEXT",
      github_name: "TEXT",
      github_account_type: "TEXT",
      profile_name: "TEXT",
      profile_color: "TEXT",
      profile_last_selected_at: "TEXT",
      profile_hidden: "INTEGER NOT NULL DEFAULT 0",
      token_source: "TEXT",
      token_scopes: "TEXT",
      auth_status: "TEXT NOT NULL DEFAULT 'connected'",
      last_validated_at: "TEXT"
    });
  }

  private ensureRepoAccounts(): void {
    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS repo_accounts (
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
            )`
      )
      .run();
    this.ensureColumns("repo_accounts", {
      watch_enabled: "INTEGER NOT NULL DEFAULT 0",
      last_synced_at: "TEXT",
      last_successful_sync_at: "TEXT",
      sync_status: "TEXT",
      sync_error: "TEXT"
    });
    this.migrateAccountScopedRepoWatches();
  }

  private migrateAccountScopedRepoWatches(): void {
    const activeAccountId = this.stores.appMetadata.getAppMetadata("active_github_account_id");
    const watchedRepos = this.db.prepare("SELECT id FROM repos WHERE watch_enabled = 1").all() as Array<{ id: string }>;
    if (watchedRepos.length === 0) return;
    const timestamp = nowIso();
    const activeAccount = activeAccountId ? this.stores.accounts.getGitHubAccountById(activeAccountId) : null;
    const accountCount = Number(
      (
        this.db
          .prepare("SELECT COUNT(*) AS count FROM accounts WHERE github_user_id IS NOT NULL AND COALESCE(profile_hidden, 0) = 0")
          .get() as { count: number }
      ).count
    );
    const updateBinding = this.db.prepare(
      "UPDATE repo_accounts SET watch_enabled = 1, updated_at = ? WHERE repo_id = ? AND account_id = ?"
    );
    const insertBinding = this.db.prepare(
      `INSERT OR IGNORE INTO repo_accounts (repo_id, account_id, endpoint, watch_enabled, updated_at)
           VALUES (?, ?, ?, 1, ?)`
    );
    for (const repo of watchedRepos) {
      const watchedBinding = this.db.prepare("SELECT 1 FROM repo_accounts WHERE repo_id = ? AND watch_enabled = 1 LIMIT 1").get(repo.id);
      if (watchedBinding) continue;
      const bindings = this.db.prepare("SELECT account_id FROM repo_accounts WHERE repo_id = ?").all(repo.id) as Array<{
        account_id: string;
      }>;
      if (activeAccount && (bindings.length === 0 || bindings.some((binding) => binding.account_id === activeAccount.id))) {
        insertBinding.run(repo.id, activeAccount.id, activeAccount.endpoint, timestamp);
        updateBinding.run(timestamp, repo.id, activeAccount.id);
        continue;
      }
      if (accountCount <= 1 && bindings.length === 1) {
        updateBinding.run(timestamp, repo.id, bindings[0].account_id);
      }
    }
  }

  private ensureSearchIndexColumns(): void {
    const columns = (this.db.prepare("PRAGMA table_info(search_index)").all() as Array<{ name: string }>).map((column) => column.name);
    if (columns.includes("state")) return;
    this.db.prepare("DROP TABLE IF EXISTS search_index").run();
    this.db.exec(INITIAL_SCHEMA_SQL);
  }

  private ensureColumns(table: string, columns: Record<string, string>): void {
    const existing = new Set(
      (this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name)
    );
    for (const [name, definition] of Object.entries(columns)) {
      if (!existing.has(name)) this.db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run();
    }
  }

  private ensureInitialSchemaIndexPrerequisites(): void {
    if (this.tableExists("repos")) {
      this.ensureColumns("repos", {
        watch_enabled: "INTEGER NOT NULL DEFAULT 0",
        watch_priority: "INTEGER NOT NULL DEFAULT 0"
      });
    }
    if (this.tableExists("repo_accounts")) {
      this.ensureColumns("repo_accounts", {
        watch_enabled: "INTEGER NOT NULL DEFAULT 0"
      });
    }
  }

  private ensureRepoMetadataCache(): void {
    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS repo_metadata_cache (
              repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
              cache_key TEXT NOT NULL,
              payload TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (repo_id, cache_key)
            )`
      )
      .run();
  }

  private ensureUserPullRequests(): void {
    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS user_pull_requests (
              repo_id TEXT NOT NULL,
              pr_number INTEGER NOT NULL,
              github_user_login TEXT NOT NULL,
              relation TEXT NOT NULL,
              last_synced_at TEXT NOT NULL,
              PRIMARY KEY (repo_id, pr_number, github_user_login),
              FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
            )`
      )
      .run();
  }

  private ensureUserIssues(): void {
    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS user_issues (
              repo_id TEXT NOT NULL,
              issue_number INTEGER NOT NULL,
              github_user_login TEXT NOT NULL,
              relation TEXT NOT NULL,
              last_synced_at TEXT NOT NULL,
              PRIMARY KEY (repo_id, issue_number, github_user_login),
              FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
            )`
      )
      .run();
  }

  private ensureIssueBackfillCursors(): void {
    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS issue_backfill_cursors (
              repo_id TEXT NOT NULL,
              state TEXT NOT NULL,
              next_page INTEGER NOT NULL DEFAULT 1,
              completed_at TEXT,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (repo_id, state),
              FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
            )`
      )
      .run();
  }

  private ensureIssueMetadataCatalogs(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS issue_types (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        github_issue_type_id INTEGER,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT,
        updated_at TEXT,
        last_synced_at TEXT,
        FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
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
        FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
        UNIQUE(repo_id, field_name, option_name)
      );
    `);
  }

  private ensureGitHubPageCache(): void {
    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS github_page_cache (
              repo_id TEXT NOT NULL,
              cache_key TEXT NOT NULL,
              etag TEXT,
              last_modified TEXT,
              payload TEXT,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (repo_id, cache_key),
              FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
            )`
      )
      .run();
  }

  private ensureWorkflowRuns(): void {
    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS workflow_runs (
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
            )`
      )
      .run();
    this.ensureColumns("workflow_runs", {
      run_attempt: "INTEGER",
      actor_login: "TEXT",
      workflow_path: "TEXT"
    });
  }

  private ensureBranchIntegrityTables(): void {
    this.db.exec(`
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
        `);
    this.ensureColumns("branch_integrity_findings", {
      confidence: "TEXT NOT NULL DEFAULT 'weak'"
    });
  }

  private ensureAttentionTables(): void {
    this.db.exec(`
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
        `);
  }

  private ensureRepoIdentities(): void {
    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS repo_identities (
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
            )`
      )
      .run();
  }

  private ensureRepoWorkspaces(): void {
    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS repo_workspaces (
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
            )`
      )
      .run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_repo_workspaces_repo_active ON repo_workspaces(repo_id, is_active)").run();
    const repos = this.db.prepare("SELECT id, local_path FROM repos WHERE local_path IS NOT NULL").all() as Array<{
      id: string;
      local_path: string | null;
    }>;
    for (const repo of repos) {
      if (!repo.local_path) continue;
      const exists = this.db.prepare("SELECT 1 FROM repo_workspaces WHERE repo_id = ? LIMIT 1").get(repo.id);
      if (!exists) this.stores.repoWorkspaces.upsertRepoWorkspace(primaryWorkspaceDraft(repo.id, repo.local_path, true));
    }
  }

  private ensureOperations(): void {
    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS operations (
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
            )`
      )
      .run();
    this.ensureColumns("operations", {
      workspace_id: "TEXT",
      workspace_path: "TEXT",
      workspace_branch: "TEXT",
      recovery_is_dirty: "INTEGER",
      recovery_file_count: "INTEGER",
      recovery_reflog_hint: "TEXT",
      result_summary: "TEXT",
      result_stash_refs: "TEXT"
    });
  }

  private ensurePullRequestReviewDrafts(): void {
    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS pr_review_drafts (
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
            )`
      )
      .run();
  }

  private ensureOfflineActions(): void {
    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS offline_actions (
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
            )`
      )
      .run();
    this.ensureColumns("offline_actions", {
      account_id: "TEXT",
      title: "TEXT",
      priority: "INTEGER NOT NULL DEFAULT 0",
      attempt_count: "INTEGER NOT NULL DEFAULT 0",
      next_attempt_at: "TEXT",
      last_attempt_at: "TEXT",
      last_error_code: "TEXT"
    });
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_offline_actions_status_next_attempt ON offline_actions(status, next_attempt_at)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_offline_actions_entity ON offline_actions(repo_id, entity_type, entity_number)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_offline_actions_account_status ON offline_actions(account_id, status)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_offline_actions_updated_at ON offline_actions(updated_at)").run();
  }

  private ensureRepoGroups(): void {
    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS repo_groups (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL UNIQUE,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            )`
      )
      .run();
    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS repo_group_memberships (
              group_id TEXT NOT NULL,
              repo_id TEXT NOT NULL,
              created_at TEXT NOT NULL,
              PRIMARY KEY (group_id, repo_id),
              FOREIGN KEY (group_id) REFERENCES repo_groups(id) ON DELETE CASCADE,
              FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
            )`
      )
      .run();
  }

  private ensurePerformanceIndexes(): void {
    this.db.exec(`
          CREATE INDEX IF NOT EXISTS idx_pull_requests_repo_state ON pull_requests(repo_id, state);
          CREATE INDEX IF NOT EXISTS idx_pull_requests_repo_updated ON pull_requests(repo_id, updated_at DESC, number DESC);
          CREATE INDEX IF NOT EXISTS idx_pull_requests_repo_head_sha ON pull_requests(repo_id, head_sha, number);
          CREATE INDEX IF NOT EXISTS idx_issues_repo_state_pull_request ON issues(repo_id, state, is_pull_request);
          CREATE INDEX IF NOT EXISTS idx_issues_repo_ispr_updated ON issues(repo_id, is_pull_request, updated_at DESC, number DESC);
          CREATE INDEX IF NOT EXISTS idx_issues_repo_ispr_state_updated ON issues(repo_id, is_pull_request, state, updated_at DESC, number DESC);
          CREATE INDEX IF NOT EXISTS idx_issues_user_author_updated ON issues(is_pull_request, author_login, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_issues_open_updated ON issues(is_pull_request, state, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_sync_jobs_repo_status_created ON sync_jobs(repo_id, status, created_at);
          CREATE INDEX IF NOT EXISTS idx_sync_jobs_status_repo_created ON sync_jobs(status, repo_id, created_at);
          CREATE INDEX IF NOT EXISTS idx_repo_accounts_account_watch ON repo_accounts(account_id, watch_enabled, repo_id);
          CREATE INDEX IF NOT EXISTS idx_repos_watch_priority_name ON repos(watch_enabled, watch_priority DESC, full_name ASC);
          CREATE INDEX IF NOT EXISTS idx_repo_group_memberships_repo_id ON repo_group_memberships(repo_id);
          CREATE INDEX IF NOT EXISTS idx_repo_group_memberships_repo_group ON repo_group_memberships(repo_id, group_id);
          CREATE INDEX IF NOT EXISTS idx_user_pull_requests_login_relation ON user_pull_requests(github_user_login, relation, repo_id, pr_number);
          CREATE INDEX IF NOT EXISTS idx_user_issues_login_relation ON user_issues(github_user_login, relation, repo_id, issue_number);
          CREATE INDEX IF NOT EXISTS idx_reviews_author_pr ON reviews(author_login, repo_id, pr_number);
          CREATE INDEX IF NOT EXISTS idx_comments_repo_updated_created ON comments(repo_id, updated_at DESC, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_notification_events_recent ON notification_events(repo_id, actor_is_bot, event_kind, github_updated_at, github_created_at, last_seen_at);
          CREATE INDEX IF NOT EXISTS idx_attention_states_account ON attention_states(account_login);
          CREATE INDEX IF NOT EXISTS idx_health_probes_checked_surface ON health_probes(checked_at, surface);
          CREATE INDEX IF NOT EXISTS idx_health_probes_latest ON health_probes(repo_id, surface, checked_at);
          CREATE INDEX IF NOT EXISTS idx_check_runs_repo_commit ON check_runs(repo_id, commit_sha, status, conclusion);
          CREATE INDEX IF NOT EXISTS idx_check_runs_repo_pr_commit ON check_runs(repo_id, pr_number, commit_sha);
          CREATE INDEX IF NOT EXISTS idx_check_runs_repo_recent ON check_runs(repo_id, completed_at, started_at, last_synced_at);
          CREATE INDEX IF NOT EXISTS idx_commit_statuses_repo_commit ON commit_statuses(repo_id, commit_sha, state);
          CREATE INDEX IF NOT EXISTS idx_commit_statuses_repo_commit_updated ON commit_statuses(repo_id, commit_sha, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_commit_statuses_repo_recent ON commit_statuses(repo_id, updated_at, created_at, last_synced_at);
          CREATE INDEX IF NOT EXISTS idx_workflow_runs_repo_started_updated ON workflow_runs(repo_id, run_started_at DESC, updated_at DESC);
        `);
    this.stores.appMetadata.setAppMetadata(performanceIndexSetMetadataKey, performanceIndexSetVersion);
  }

  private ensureSummarySnapshotTables(): void {
    this.db.exec(`
          CREATE TABLE IF NOT EXISTS cache_summary_snapshots (
            id TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS attention_summary_snapshots (
            account_login TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS health_history_snapshots (
            id TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `);
  }
}
