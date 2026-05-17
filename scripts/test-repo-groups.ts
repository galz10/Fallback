import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "../electron/main/database-service.js";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-repo-groups-test-"));
const databasePath = path.join(tempDir, "fallback.sqlite");
const database = new DatabaseService(databasePath);

try {
  insertRepo(database, "repo-a", "octo/api");
  insertRepo(database, "repo-b", "octo/web");

  const frontend = database.localCache.repoGroups.createRepoGroup({ name: "Frontend" });
  const urgent = database.localCache.repoGroups.createRepoGroup({ name: "Urgent" });
  const empty = database.localCache.repoGroups.createRepoGroup({ name: "Empty" });
  assert.equal(database.localCache.repoGroups.listRepoGroups().length, 3);
  assert.deepEqual(database.localCache.repoGroups.listRepoGroupsForActiveAccount().find((group) => group.id === empty.id)?.repoIds, []);

  database.localCache.repoGroups.setRepoGroupMemberships(frontend.id, ["repo-a", "repo-b"]);
  database.localCache.repoGroups.setRepoGroupMemberships(urgent.id, ["repo-b"]);

  const groups = database.localCache.repoGroups.listRepoGroups();
  assert.deepEqual(groups.find((group) => group.id === frontend.id)?.repoIds, ["repo-a", "repo-b"]);
  assert.deepEqual(groups.find((group) => group.id === urgent.id)?.repoIds, ["repo-b"]);

  const repos = database.localCache.repos.listWatchedRepos();
  assert.deepEqual(
    repos.find((repo) => repo.id === "repo-a")?.groups.map((group) => group.name),
    ["Frontend"]
  );
  assert.deepEqual(
    repos.find((repo) => repo.id === "repo-b")?.groups.map((group) => group.name),
    ["Frontend", "Urgent"]
  );

  const renamed = database.localCache.repoGroups.updateRepoGroup(frontend.id, { name: "Clients" });
  assert.equal(renamed.name, "Clients");

  database.localCache.repoGroups.deleteRepoGroup(frontend.id);
  assert.equal(database.localCache.repos.getRepo("repo-a")?.fullName, "octo/api");
  assert.deepEqual(
    database.localCache.repoGroups.listRepoGroups().map((group) => group.name),
    ["Empty", "Urgent"]
  );
  assert.deepEqual(
    database.localCache.repos.getRepo("repo-b")?.groups.map((group) => group.name),
    ["Urgent"]
  );
  database.close();

  const reopened = new DatabaseService(databasePath);
  assert.deepEqual(
    reopened.localCache.repoGroups.listRepoGroups().map((group) => group.name),
    ["Empty", "Urgent"]
  );
  assert.deepEqual(
    reopened.localCache.repos.getRepo("repo-b")?.groups.map((group) => group.name),
    ["Urgent"]
  );
  reopened.close();
} finally {
  try {
    database.close();
  } catch {
    // Already closed after persistence assertions.
  }
  await rm(tempDir, { force: true, recursive: true });
}

function insertRepo(db: DatabaseService, id: string, fullName: string): void {
  const [owner = "octo", name = "repo"] = fullName.split("/");
  db.db
    .prepare(
      `INSERT INTO repos (
        id, github_repo_id, owner, name, full_name, is_private, default_branch, html_url,
        workspace_path, local_path, watch_mode, clone_enabled, clone_status, watch_enabled,
        sync_status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, 0, 'main', ?,
        ?, null, 'metadata-only', 0, 'not_cloned', 1, 'fresh', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    )
    .run(id, id === "repo-a" ? 1 : 2, owner, name, fullName, `https://github.com/${fullName}`, tempDir);
}

console.log("Repo groups database tests ok");
