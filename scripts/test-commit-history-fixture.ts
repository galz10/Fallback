import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DatabaseService } from "../electron/main/database-service.js";
import { HistorySearchService } from "../electron/main/history-search-service.js";

const exec = promisify(execFile);
const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-commit-history-test-"));
const repoPath = path.join(tempDir, "repo");
const database = new DatabaseService(path.join(tempDir, "fallback.sqlite"));

try {
  await mkdir(path.join(repoPath, "src"), { recursive: true });
  await git(["init", "-b", "main"], repoPath);
  await git(["config", "user.name", "Pat Reviewer"], repoPath);
  await git(["config", "user.email", "pat@example.com"], repoPath);

  await writeFile(path.join(repoPath, "README.md"), "hello\n");
  await git(["add", "README.md"], repoPath);
  await git(["commit", "-m", "Initial docs"], repoPath, "2026-04-01T10:00:00Z");

  await writeFile(path.join(repoPath, "src/app.ts"), "export const button = true;\n");
  await git(["add", "src/app.ts"], repoPath);
  await git(["commit", "-m", "Fix button state"], repoPath, "2026-04-15T10:00:00Z");
  const buttonSha = (await git(["rev-parse", "HEAD"], repoPath)).stdout.trim();

  await git(["checkout", "-b", "feature/search"], repoPath);
  await writeFile(path.join(repoPath, "src/search.ts"), "export const search = true;\n");
  await git(["add", "src/search.ts"], repoPath);
  await git(["commit", "-m", "Add history search"], repoPath, "2026-05-01T10:00:00Z");

  insertRepo(database, "octo-repo", repoPath);
  insertRepo(database, "cached-repo", null);
  database.localCache.repoMetadata.setRepoMetadataCache("cached-repo", "code-summary", {
    defaultBranch: "main",
    latestCommit: null,
    commits: [
      {
        sha: "abc1234",
        message: "Cached metadata commit",
        authorLogin: "mona",
        authorName: "Mona",
        committedAt: "2026-04-20T10:00:00Z",
        htmlUrl: "https://github.com/octo/cached/commit/abc1234",
        verified: true
      }
    ],
    branchCount: 0,
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
  });
  const service = new HistorySearchService(database);

  let result = await service.searchCommits("octo-repo", { message: "button", limit: 10 });
  assert.equal(result.status, "ok");
  assert.equal(result.commits.length, 1);
  assert.equal(result.commits[0]?.sha, buttonSha);

  result = await service.searchCommits("octo-repo", { author: "Pat", after: "2026-04-10", before: "2026-04-30", limit: 10 });
  assert.equal(
    result.commits.some((commit) => commit.message === "Fix button state"),
    true
  );
  assert.equal(
    result.commits.some((commit) => commit.message === "Initial docs"),
    false
  );

  result = await service.searchCommits("octo-repo", { path: "src/app.ts", limit: 10 });
  assert.deepEqual(
    result.commits.map((commit) => commit.message),
    ["Fix button state"]
  );

  result = await service.searchCommits("octo-repo", { ref: "feature/search", message: "history", limit: 10 });
  assert.equal(result.commits[0]?.message, "Add history search");

  result = await service.searchCommits("octo-repo", { sha: buttonSha.slice(0, 8), limit: 10 });
  assert.equal(result.commits[0]?.sha, buttonSha);

  result = await service.searchCommits("cached-repo", { author: "mona" });
  assert.equal(result.source, "cache");
  assert.equal(result.commits[0]?.message, "Cached metadata commit");
} finally {
  database.close();
  await rm(tempDir, { force: true, recursive: true });
}

async function git(args: string[], cwd: string, date?: string): Promise<{ stdout: string; stderr: string }> {
  const env = date ? { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : process.env;
  return exec("git", args, { cwd, env });
}

function insertRepo(db: DatabaseService, id: string, localPath: string | null): void {
  db.db
    .prepare(
      `INSERT INTO repos (
        id, github_repo_id, owner, name, full_name, is_private, default_branch, html_url,
        workspace_path, local_path, watch_mode, clone_enabled, clone_status, watch_enabled,
        sync_status, created_at, updated_at
      )
      VALUES (?, ?, 'octo', ?, ?, 0, 'main', ?,
        ?, ?, ?, ?, ?, 1, 'fresh', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    )
    .run(
      id,
      id === "octo-repo" ? 1 : 2,
      id === "octo-repo" ? "repo" : "cached",
      id === "octo-repo" ? "octo/repo" : "octo/cached",
      id === "octo-repo" ? "https://github.com/octo/repo" : "https://github.com/octo/cached",
      localPath ? path.dirname(localPath) : tempDir,
      localPath,
      localPath ? "cloned" : "metadata-only",
      localPath ? 1 : 0,
      localPath ? "cloned" : "not_cloned"
    );
}

console.log("Commit history fixture search tests ok");
