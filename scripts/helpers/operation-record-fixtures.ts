import { DatabaseService } from "../../electron/main/database-service.js";
import { OperationService } from "../../electron/main/operation-service.js";
import type { OperationRecordInput } from "../../electron/main/local-cache/operation-record-store.js";
import type { OperationRecord } from "../../src/shared/domain/operation.js";
import type { SyncStatus } from "../../src/shared/domain/sync.js";

interface WatchedRepoFixtureInput {
  id?: string;
  githubRepoId?: number;
  owner?: string;
  name?: string;
  fullName?: string;
  isPrivate?: boolean;
  defaultBranch?: string | null;
  htmlUrl?: string | null;
  workspacePath?: string | null;
  localPath?: string | null;
  watchMode?: "metadata-only" | "cloned";
  cloneEnabled?: boolean;
  cloneStatus?: string | null;
  watchEnabled?: boolean;
  syncStatus?: SyncStatus;
}

interface RepoWorkspaceFixtureInput {
  id?: string;
  repoId?: string;
  localPath: string;
  branch?: string | null;
  headSha?: string | null;
  isActive?: boolean;
}

export function insertWatchedRepoFixture(database: DatabaseService, input: WatchedRepoFixtureInput = {}): string {
  const fullName = input.fullName ?? `${input.owner ?? "octo"}/${input.name ?? "repo"}`;
  const [owner, name] = fullName.split("/");
  const repoId = input.id ?? `${owner}-${name}`;
  const watchMode = input.watchMode ?? (input.localPath ? "cloned" : "metadata-only");
  const cloneEnabled = input.cloneEnabled ?? Boolean(input.localPath);
  const cloneStatus = input.cloneStatus ?? (input.localPath ? "cloned" : null);
  database.db
    .prepare(
      `INSERT INTO repos (
        id, github_repo_id, owner, name, full_name, is_private, default_branch, html_url,
        workspace_path, local_path, watch_mode, clone_enabled, clone_status, watch_enabled,
        sync_status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    )
    .run(
      repoId,
      input.githubRepoId ?? 1,
      input.owner ?? owner,
      input.name ?? name,
      fullName,
      input.isPrivate ? 1 : 0,
      input.defaultBranch ?? "main",
      input.htmlUrl ?? `https://github.com/${fullName}`,
      input.workspacePath ?? input.localPath ?? null,
      input.localPath ?? null,
      watchMode,
      cloneEnabled ? 1 : 0,
      cloneStatus,
      input.watchEnabled === false ? 0 : 1,
      input.syncStatus ?? "fresh"
    );
  return repoId;
}

export function upsertRepoWorkspaceFixture(database: DatabaseService, input: RepoWorkspaceFixtureInput): string {
  const workspaceId = input.id ?? "workspace-1";
  database.localCache.repoWorkspaces.upsertRepoWorkspace({
    id: workspaceId,
    repoId: input.repoId ?? "octo-repo",
    kind: "clone",
    localPath: input.localPath,
    gitCommonDir: null,
    gitDir: null,
    mainWorktreePath: null,
    branch: input.branch ?? "main",
    headSha: input.headSha ?? "abc123",
    isActive: input.isActive ?? true,
    isDirty: false,
    locked: false,
    lockReason: null,
    prunable: false,
    pruneReason: null,
    detached: false,
    bare: false,
    missing: false,
    lastSeenAt: "2026-01-01T00:00:00.000Z"
  });
  return workspaceId;
}

export function createOperationServiceFixture(database: DatabaseService): OperationService {
  return new OperationService({
    records: database.operationRecords,
    repoContext: {
      activeRepoWorkspace: (repoId) => database.localCache.repoWorkspaces.activeRepoWorkspace(repoId),
      requireRepoVisibleToActiveAccount: (repoId) => database.localCache.repos.requireRepoVisibleToActiveAccount(repoId),
      listWatchedReposForActiveAccount: () => database.localCache.repos.listWatchedReposForActiveAccount()
    },
    diagnostics: database.localCache.diagnostics
  });
}

export function createOperationRecordFixture(database: DatabaseService, input: OperationRecordInput): OperationRecord {
  return database.operationRecords.create(input);
}
