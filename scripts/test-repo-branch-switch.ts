import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { DatabaseService } from "../electron/main/database-service.js";
import type { GitHubClient } from "../electron/main/github-client.js";
import { SyncService } from "../electron/main/sync-service.js";
import type { RepoCodeSummary } from "../src/shared/domain/repo-code.js";
import { withSettingsWorkspace } from "../tests/fixtures/settings-workspace.js";
import { insertWatchedRepoFixture } from "./helpers/operation-record-fixtures.js";

const execFileAsync = promisify(execFile);
const repoId = "github.com/octo/repo";

await withSettingsWorkspace("fallback-repo-branch-switch-", async ({ tempDir, settings, workspace }) => {
  const database = new DatabaseService(settings.databasePath());
  const remotePath = path.join(tempDir, "remote.git");
  const seedPath = path.join(tempDir, "seed");
  const clonePath = path.join(tempDir, "clone");

  try {
    await git(tempDir, ["init", "--bare", remotePath]);
    await git(tempDir, ["init", "-b", "main", seedPath]);
    await git(seedPath, ["config", "user.email", "fallback@example.com"]);
    await git(seedPath, ["config", "user.name", "Fallback"]);
    await writeFile(path.join(seedPath, "README.md"), "main\n");
    await git(seedPath, ["add", "README.md"]);
    await git(seedPath, ["commit", "-m", "main"]);
    await git(seedPath, ["remote", "add", "origin", remotePath]);
    await git(seedPath, ["push", "-u", "origin", "main"]);
    await git(seedPath, ["checkout", "-b", "feature"]);
    await writeFile(path.join(seedPath, "feature.txt"), "feature\n");
    await git(seedPath, ["add", "feature.txt"]);
    await git(seedPath, ["commit", "-m", "feature"]);
    await git(seedPath, ["push", "-u", "origin", "feature"]);

    await git(tempDir, ["clone", remotePath, clonePath]);
    await git(clonePath, ["checkout", "main"]);

    insertWatchedRepoFixture(database, {
      id: repoId,
      owner: "octo",
      name: "repo",
      fullName: "octo/repo",
      localPath: clonePath,
      defaultBranch: "main"
    });
    database.localCache.repoMetadata.setRepoMetadataCache(repoId, "code-summary", codeSummary("main"));

    const github = {
      getRateLimit: () => null,
      paginate: async (apiPath: string) => {
        assert.equal(apiPath, "/repos/octo/repo/branches");
        return [{ name: "feature", commit: { sha: "feature-sha" }, protected: false }];
      }
    } as unknown as GitHubClient;
    const sync = new SyncService(database, workspace, github);

    const branches = await sync.listRepoBranches(repoId);
    assert.ok(
      branches.some((branch) => branch.name === "main"),
      "local main branch should remain switchable"
    );
    assert.ok(
      branches.some((branch) => branch.name === "feature"),
      "remote feature branch should be listed"
    );

    await sync.switchRepoBranch(repoId, "feature");
    assert.equal(await gitText(clonePath, ["branch", "--show-current"]), "feature");
    assert.equal(
      database.localCache.repoMetadata.getRepoMetadataCache<RepoCodeSummary>(repoId, "code-summary")?.payload.defaultBranch,
      "feature"
    );

    const restartedSync = new SyncService(database, workspace, github);
    assert.equal((await restartedSync.repoCodeSummary(repoId)).defaultBranch, "feature");
  } finally {
    database.close();
  }
});

console.log("Repo branch switch tests ok");

function codeSummary(defaultBranch: string): RepoCodeSummary {
  return {
    defaultBranch,
    latestCommit: null,
    commits: [],
    branchCount: 1,
    tagCount: 0,
    releaseCount: 0,
    contributorCount: 0,
    starCount: 0,
    forkCount: 0,
    watcherCount: 0,
    sizeKb: null,
    cachedBytes: 0,
    totalStoredBytes: null,
    licenseName: null,
    latestReleaseName: null
  };
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function gitText(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return stdout.trim();
}
