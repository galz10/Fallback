import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseService } from "../electron/main/database-service.js";
import type { GitHubClient } from "../electron/main/github-client.js";
import { SyncService } from "../electron/main/sync-service.js";
import { insertWatchedRepoFixture } from "./helpers/operation-record-fixtures.js";
import { withSettingsWorkspace } from "../tests/fixtures/settings-workspace.js";

const repoId = "github.com/octo/repo";

await withSettingsWorkspace("fallback-repo-file-preview-test-", async ({ tempDir, settings, workspace }) => {
  const database = new DatabaseService(settings.databasePath());
  const repoPath = path.join(tempDir, "octo", "repo");
  try {
    await mkdir(repoPath, { recursive: true });
    execFileSync("git", ["init"], { cwd: repoPath, stdio: "ignore" });
    await writeFile(path.join(repoPath, ".gitignore"), "/true\n/true.zwc\n*.zwc\n");
    await writeFile(path.join(repoPath, "small.txt"), "hello\n");
    await writeFile(path.join(repoPath, "binary.dat"), Buffer.from([0, 1, 2, 3]));
    await writeFile(path.join(repoPath, "large.txt"), Buffer.alloc(2 * 1024 * 1024 + 1, "a"));
    await writeFile(path.join(repoPath, "true"), "accidental shell output\n");
    await writeFile(path.join(repoPath, "true.zwc"), Buffer.from([0, 1, 2, 3]));
    insertWatchedRepoFixture(database, {
      id: repoId,
      owner: "octo",
      name: "repo",
      fullName: "octo/repo",
      localPath: repoPath
    });

    const sync = new SyncService(database, workspace, {} as GitHubClient);
    const rootFiles = await sync.listRepoFiles(repoId);
    assert.ok(rootFiles.some((file) => file.name === "small.txt"));
    assert.ok(!rootFiles.some((file) => file.name === "true"));
    assert.ok(!rootFiles.some((file) => file.name === "true.zwc"));

    const small = await sync.readRepoFile(repoId, "small.txt");
    assert.equal(small.contents, "hello\n");
    assert.equal(small.isBinary, false);
    assert.equal(small.isTooLarge, undefined);

    const binary = await sync.readRepoFile(repoId, "binary.dat");
    assert.equal(binary.contents, null);
    assert.equal(binary.isBinary, true);
    assert.equal(binary.isTooLarge, undefined);

    const large = await sync.readRepoFile(repoId, "large.txt");
    assert.equal(large.contents, null);
    assert.equal(large.isBinary, true);
    assert.equal(large.isTooLarge, true);
    assert.equal(large.size, 2 * 1024 * 1024 + 1);

    console.log("Repo file preview tests ok");
  } finally {
    database.close();
  }
});
