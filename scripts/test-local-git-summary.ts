import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { LocalGitService } from "../electron/main/local-git-service.js";
import { git } from "../tests/fixtures/git.js";
import { withTempDatabase } from "../tests/fixtures/sqlite.js";

async function run(): Promise<void> {
  await withTempDatabase("fallback-local-summary-test-", async ({ tempDir, database }) => {
    const repoPath = path.join(tempDir, "repo");
    await git(tempDir, ["init", "-b", "main", "repo"]);
    await git(repoPath, ["config", "user.email", "fallback@example.com"]);
    await git(repoPath, ["config", "user.name", "Fallback"]);
    await writeFile(path.join(repoPath, "README.md"), "clean\n");
    await git(repoPath, ["add", "README.md"]);
    await git(repoPath, ["commit", "-m", "initial"]);
    await writeFile(path.join(repoPath, "README.md"), "clean\ndirty\n");
    await writeFile(path.join(repoPath, "new.txt"), "new\n");

    database.db
      .prepare(
        `INSERT INTO repos (
          id, github_repo_id, owner, name, full_name, is_private, default_branch, html_url,
          workspace_path, local_path, watch_mode, clone_enabled, clone_status, watch_enabled,
          sync_status, created_at, updated_at
        )
        VALUES ('octo-repo', 1, 'octo', 'repo', 'octo/repo', 0, 'main', 'https://github.com/octo/repo',
          ?, ?, 'cloned', 1, 'cloned', 1, 'fresh', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
      )
      .run(tempDir, repoPath);

    const localGit = new LocalGitService(database);
    const [summary] = await localGit.changesSummary(["octo-repo"]);
    assert.ok(summary);
    assert.equal(summary.repoId, "octo-repo");
    assert.equal(summary.isDirty, true);
    assert.equal(summary.fileCount, 2);
    assert.equal(summary.error, null);
    assert.ok(summary.additions >= 2);

    const metadataPath = path.join(tempDir, "metadata-only");
    await mkdir(metadataPath);
    database.db
      .prepare(
        `INSERT INTO repos (
          id, github_repo_id, owner, name, full_name, is_private, default_branch, html_url,
          workspace_path, local_path, watch_mode, clone_enabled, clone_status, watch_enabled,
          sync_status, created_at, updated_at
        )
        VALUES ('meta-repo', 2, 'octo', 'meta', 'octo/meta', 0, 'main', 'https://github.com/octo/meta',
          ?, ?, 'metadata-only', 0, 'metadata-only', 1, 'fresh', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
      )
      .run(tempDir, metadataPath);

    const overview = await localGit.changesOverview("meta-repo");
    assert.equal(overview.repoId, "meta-repo");
    assert.equal(overview.branch, "main");
    assert.equal(overview.isDirty, false);
    assert.deepEqual(overview.files, []);
  });
}

await run();
console.log("Local git summary tests ok");
