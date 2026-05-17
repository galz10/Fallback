import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { INITIAL_SCHEMA_SQL, SCHEMA_VERSION } from "../db/schema.js";
import { DatabaseService } from "../electron/main/database-service.js";
import {
  performanceIndexSetMetadataKey,
  performanceIndexSetVersion,
  productionBaselineMigrationVersion
} from "../electron/main/local-cache/store-helpers.js";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-repo-migration-test-"));
const databasePath = path.join(tempDir, "fallback.sqlite");

try {
  const legacy = new Database(databasePath);
  legacy.exec(`
    CREATE TABLE app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('schema_version', 'legacy', '2026-01-01T00:00:00.000Z');

    CREATE TABLE repos (
      id TEXT PRIMARY KEY,
      github_repo_id INTEGER NOT NULL UNIQUE,
      provider TEXT DEFAULT 'github.com',
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      full_name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_private INTEGER NOT NULL DEFAULT 0,
      is_fork INTEGER NOT NULL DEFAULT 0,
      default_branch TEXT,
      html_url TEXT,
      clone_url TEXT,
      ssh_url TEXT,
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

    CREATE TABLE sync_jobs (
      id TEXT PRIMARY KEY,
      repo_id TEXT,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL,
      error_code TEXT,
      error_message TEXT,
      started_at TEXT,
      completed_at TEXT,
      github_rate_limit_remaining INTEGER,
      github_rate_limit_reset_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      github_user_id TEXT,
      github_login TEXT,
      github_avatar_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE repo_accounts (
      repo_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      endpoint TEXT NOT NULL DEFAULT 'https://api.github.com',
      permission_admin INTEGER,
      permission_push INTEGER,
      permission_pull INTEGER,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (repo_id, account_id)
    );
  `);
  legacy.close();

  const database = new DatabaseService(databasePath);
  const migrationRows = database.db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: string }>;
  assert.ok(
    migrationRows.some((row) => row.version === "0014"),
    "expected production baseline migration to be recorded"
  );
  assert.ok(
    database.localCache.appMetadata.getAppMetadata("schema_migration_backup_policy")?.includes("pre-migration"),
    "expected migration backup policy metadata"
  );
  assert.ok((await readdir(tempDir)).some((file) => file.startsWith("fallback.sqlite.pre-migration-") && file.endsWith(".bak")));
  const repoColumns = tableColumns(database, "repos");
  for (const column of [
    "owner_avatar_url",
    "archived",
    "has_issues",
    "is_template",
    "language",
    "permission_admin",
    "permission_push",
    "permission_pull"
  ]) {
    assert.ok(repoColumns.has(column), `expected repos.${column} to be migrated`);
  }

  const syncJobColumns = tableColumns(database, "sync_jobs");
  for (const column of ["priority", "reason", "not_before", "attempt_count", "last_error_code", "dedupe_key"]) {
    assert.ok(syncJobColumns.has(column), `expected sync_jobs.${column} to be migrated`);
  }

  assert.ok(tableColumns(database, "accounts").has("github_avatar_cached_url"));
  const repoAccountColumns = tableColumns(database, "repo_accounts");
  for (const column of ["watch_enabled", "permission_pull", "last_synced_at", "last_successful_sync_at", "sync_status", "sync_error"]) {
    assert.ok(repoAccountColumns.has(column), `expected repo_accounts.${column} to be migrated`);
  }
  assert.ok(tableColumns(database, "repo_identities").has("git_email"));
  assert.ok(tableColumns(database, "pr_review_drafts").has("comments_json"));
  assert.ok(tableColumns(database, "repo_groups").has("name"));
  assert.ok(tableColumns(database, "repo_group_memberships").has("repo_id"));
  const operationColumns = tableColumns(database, "operations");
  for (const column of [
    "workspace_id",
    "workspace_path",
    "workspace_branch",
    "recovery_head_sha",
    "recovery_is_dirty",
    "recovery_file_count",
    "recovery_reflog_hint"
  ]) {
    assert.ok(operationColumns.has(column), `expected operations.${column} to be migrated`);
  }
  assert.ok(tableColumns(database, "repo_workspaces").has("git_common_dir"));
  assert.ok(tableColumns(database, "issues").has("issue_type_name"));
  assert.ok(tableColumns(database, "issue_types").has("name"));
  assert.ok(tableColumns(database, "issue_field_options").has("option_name"));

  for (const table of [
    "branch_snapshots",
    "merge_evidence",
    "branch_integrity_findings",
    "pull_request_commits",
    "compare_cache",
    "attention_states",
    "notification_events"
  ]) {
    assert.ok(tableColumns(database, table).size > 0, `expected ${table} to be migrated`);
  }
  for (const column of ["run_attempt", "actor_login", "workflow_path"]) {
    assert.ok(tableColumns(database, "workflow_runs").has(column), `expected workflow_runs.${column} to be migrated`);
  }

  const now = "2026-05-04T00:00:00.000Z";
  database.db
    .prepare(
      `INSERT INTO repos (
        id, github_repo_id, owner, name, full_name, default_branch, local_path, watch_mode, clone_status,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run("octo-repo", 1, "octo", "repo", "octo/repo", "main", tempDir, "cloned", "cloned", now, now);
  const workspaces = database.localCache.repoWorkspaces.listRepoWorkspaces("octo-repo");
  assert.equal(workspaces.length, 1);
  assert.equal(workspaces[0]?.kind, "clone");
  assert.equal(workspaces[0]?.isActive, true);
  assert.equal(workspaces[0]?.localPath, tempDir);

  const firstSnapshot = database.localCache.branchIntegrity.upsertBranchSnapshot({
    repoId: "octo-repo",
    branchName: "main",
    remoteName: "origin",
    headSha: "a".repeat(40),
    treeSha: "b".repeat(40),
    parentSha: null,
    firstParentSha: null,
    committedAt: now,
    observedAt: now,
    source: "sync",
    checkpointRef: null,
    notes: null
  });
  const updatedSnapshot = database.localCache.branchIntegrity.upsertBranchSnapshot({
    ...firstSnapshot,
    observedAt: "2026-05-04T00:01:00.000Z",
    notes: "updated"
  });
  assert.equal(database.localCache.branchIntegrity.listBranchSnapshots("octo-repo", "main").length, 1);
  assert.equal(updatedSnapshot.notes, "updated");

  database.localCache.branchIntegrity.upsertMergeEvidence({
    repoId: "octo-repo",
    branchName: "main",
    landedSha: "c".repeat(40),
    landedTreeSha: "d".repeat(40),
    landedParentSha: "a".repeat(40),
    prNumbers: [123],
    mergeMethod: "merge",
    mergeSource: "merge_queue",
    expectedHeadSha: "e".repeat(40),
    expectedTreeSha: "f".repeat(40),
    testedSha: "e".repeat(40),
    testedTreeSha: "f".repeat(40),
    mergeGroupRef: "refs/fallback/merge-groups/123",
    workflowRunId: 456,
    workflowRunUrl: "https://example.com/runs/456",
    checkState: "success",
    observedAt: now
  });
  assert.equal(database.localCache.branchIntegrity.listMergeEvidence("octo-repo", "main")[0]?.prNumbers[0], 123);

  const finding = database.localCache.branchIntegrity.upsertBranchIntegrityFinding("octo-repo", {
    branchName: "main",
    severity: "critical",
    kind: "tested_tree_mismatch",
    title: "Tested tree mismatch",
    summary: "The landed tree differs from the tested tree.",
    landedSha: "c".repeat(40),
    expectedSha: "e".repeat(40),
    landedTreeSha: "d".repeat(40),
    expectedTreeSha: "f".repeat(40),
    prNumbers: [123],
    confidence: "exact",
    evidence: { testedTreeSha: "f".repeat(40) }
  });
  assert.equal(database.localCache.branchIntegrity.listBranchIntegrityFindings("octo-repo").length, 1);
  assert.equal(database.localCache.branchIntegrity.markBranchIntegrityFindingResolved(finding.id)?.status, "resolved");

  database.localCache.notifications.upsertNotificationEvent({
    eventKey: "comment:octo-repo:issue:1:1",
    entityType: "issue",
    repoId: "octo-repo",
    entityNumber: 1,
    eventKind: "comment",
    actorLogin: "mona",
    actorIsBot: false,
    title: "Mona commented",
    bodyPreview: "Can you look?",
    htmlUrl: "https://example.com/comment",
    githubCreatedAt: now,
    githubUpdatedAt: now,
    importance: 40,
    promotesToMyWork: true,
    collapseKey: null,
    payload: { source: "test" }
  });
  assert.equal(database.localCache.notifications.listNotificationEvents({ filter: "human" }).length, 1);
  database.localCache.attention.markAttentionRead(["issue:octo-repo:1"], "mona", now);
  database.localCache.attention.patchAttentionState("issue", "octo-repo", 1, "mona", {
    doneAt: now,
    snoozedUntil: "2026-05-05T09:00:00.000Z"
  });
  const attentionState = database.localCache.attention.getAttentionState("issue", "octo-repo", 1, "mona");
  assert.equal(attentionState?.readAt, now);
  assert.equal(attentionState?.doneAt, now);
  assert.equal(attentionState?.snoozedUntil, "2026-05-05T09:00:00.000Z");
  database.close();

  await assertSqlMigrationsExecute(tempDir);
  await assertCurrentVersionMissingCatalogsMigrates(tempDir);
  await assertFailedMigrationPreservesBackup(tempDir);

  console.log("Repository schema migration tests ok");
} finally {
  delete process.env.FALLBACK_MIGRATIONS_DIR;
  await rm(tempDir, { force: true, recursive: true });
}

function tableColumns(database: DatabaseService, table: string): Set<string> {
  return new Set((database.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name));
}

async function assertSqlMigrationsExecute(parentDir: string): Promise<void> {
  const migrationsDir = path.join(parentDir, "sql-migrations");
  await mkdir(migrationsDir);
  await writeFile(path.join(migrationsDir, "0014_production_baseline.sql"), "-- test baseline\n");
  await writeFile(path.join(migrationsDir, "0015_test_execution.sql"), "CREATE TABLE migration_execution_probe (id TEXT PRIMARY KEY);\n");
  process.env.FALLBACK_MIGRATIONS_DIR = migrationsDir;

  const migrationDatabasePath = path.join(parentDir, "migration-execution.sqlite");
  const migrated = new DatabaseService(migrationDatabasePath);
  assert.ok(tableColumns(migrated, "migration_execution_probe").has("id"));
  const migrationRows = migrated.db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: string }>;
  assert.ok(migrationRows.some((row) => row.version === "0015"));
  migrated.close();
  delete process.env.FALLBACK_MIGRATIONS_DIR;
}

async function assertCurrentVersionMissingCatalogsMigrates(parentDir: string): Promise<void> {
  const currentDatabasePath = path.join(parentDir, "current-missing-catalogs.sqlite");
  const current = new Database(currentDatabasePath);
  current.exec(INITIAL_SCHEMA_SQL);
  current
    .prepare(
      `INSERT INTO app_metadata (key, value, updated_at)
       VALUES (?, ?, '2026-01-01T00:00:00.000Z')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run("schema_version", SCHEMA_VERSION);
  current
    .prepare(
      `INSERT INTO app_metadata (key, value, updated_at)
       VALUES (?, ?, '2026-01-01T00:00:00.000Z')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(performanceIndexSetMetadataKey, performanceIndexSetVersion);
  current.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  current
    .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, 'production baseline', '2026-01-01T00:00:00.000Z')")
    .run(productionBaselineMigrationVersion());
  current.exec("DROP TABLE issue_field_options; DROP TABLE issue_types;");
  current.close();

  const migrated = new DatabaseService(currentDatabasePath);
  assert.ok(tableColumns(migrated, "issue_types").has("name"));
  assert.ok(tableColumns(migrated, "issue_field_options").has("option_name"));
  migrated.close();
}

async function assertFailedMigrationPreservesBackup(parentDir: string): Promise<void> {
  const migrationsDir = path.join(parentDir, "failing-migrations");
  await mkdir(migrationsDir);
  await writeFile(path.join(migrationsDir, "0014_production_baseline.sql"), "-- test baseline\n");
  await writeFile(path.join(migrationsDir, "0015_broken.sql"), "CREATE TABLE broken_table (;\n");
  process.env.FALLBACK_MIGRATIONS_DIR = migrationsDir;

  const failingDatabasePath = path.join(parentDir, "failing-migration.sqlite");
  const legacy = new Database(failingDatabasePath);
  legacy.exec(`
    CREATE TABLE app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('schema_version', 'legacy', '2026-01-01T00:00:00.000Z');
  `);
  legacy.close();

  assert.throws(() => new DatabaseService(failingDatabasePath), /pre-migration backup was preserved/);
  assert.ok(fs.readdirSync(parentDir).some((file) => file.startsWith("failing-migration.sqlite.pre-migration-") && file.endsWith(".bak")));
  const failed = new Database(failingDatabasePath, { readonly: true });
  const diagnostic = failed
    .prepare("SELECT code, message FROM diagnostic_events WHERE code = 'schema_migration_failed' ORDER BY created_at DESC LIMIT 1")
    .get() as { code: string; message: string } | undefined;
  assert.equal(diagnostic?.code, "schema_migration_failed");
  assert.match(diagnostic?.message ?? "", /Backup:/);
  failed.close();
  delete process.env.FALLBACK_MIGRATIONS_DIR;
}
