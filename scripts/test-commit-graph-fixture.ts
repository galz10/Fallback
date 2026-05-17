import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DatabaseService } from "../electron/main/database-service.js";
import { CommitGraphService } from "../electron/main/commit-graph-service.js";

const execFileAsync = promisify(execFile);

async function run(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-commit-graph-test-"));
  const repoPath = path.join(tempDir, "repo");
  const databasePath = path.join(tempDir, "fallback.sqlite");
  const database = new DatabaseService(databasePath);

  try {
    await git(tempDir, ["init", "-b", "main", "repo"]);
    await git(repoPath, ["config", "user.email", "fallback@example.com"]);
    await git(repoPath, ["config", "user.name", "Fallback"]);
    await writeFile(path.join(repoPath, "README.md"), "one\n");
    await git(repoPath, ["add", "README.md"]);
    await git(repoPath, ["commit", "-m", "initial"]);
    await git(repoPath, ["checkout", "-b", "feature"]);
    await writeFile(path.join(repoPath, "feature.txt"), "feature\n");
    await git(repoPath, ["add", "feature.txt"]);
    await git(repoPath, ["commit", "-m", "feature work"]);
    await git(repoPath, ["checkout", "main"]);
    await writeFile(path.join(repoPath, "README.md"), "one\nmain\n");
    await git(repoPath, ["add", "README.md"]);
    await git(repoPath, ["commit", "-m", "main work"]);
    await git(repoPath, ["merge", "--no-ff", "feature", "-m", "merge feature"]);
    await writeFile(path.join(repoPath, "wip.txt"), "wip\n");
    await git(repoPath, ["stash", "push", "-u", "-m", "graph stash"]);

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

    const service = new CommitGraphService(database);
    const graph = await service.graph("octo-repo", { limit: 20, sinceDays: 365 });
    assert.equal(graph.status, "ok");
    assert.equal(graph.currentBranch, "main");
    const mergeNode = graph.nodes.find((node) => node.message === "merge feature");
    assert.ok(mergeNode);
    assert.equal(mergeNode.parentShas.length, 2);
    assert.ok(graph.maxLane >= 1);
    assert.ok(graph.nodes.some((node) => node.files.some((file) => file.path === "feature.txt")));
    assert.ok(graph.nodes.some((node) => node.files.some((file) => file.additions != null || file.deletions != null)));
    assert.ok(graph.nodes.some((node) => node.refs.some((ref) => ref.name === "HEAD")));
    assert.ok(graph.refs.some((ref) => ref.name === "feature"));
    assert.equal(graph.stashes.length, 1);

    const patch = await service.patch("octo-repo", mergeNode.sha);
    assert.equal(patch.parentSha, mergeNode.parentShas[0]);
    assert.match(patch.patch, /feature\.txt/);

    const capped = await service.graph("octo-repo", { limit: 2, sinceDays: 365 });
    assert.equal(capped.status, "capped");
    assert.equal(capped.capped, true);
    assert.equal(capped.nodes.length, 2);

    database.db.prepare("UPDATE repos SET local_path = NULL, watch_mode = 'metadata-only' WHERE id = 'octo-repo'").run();
    const stale = await service.graph("octo-repo", { limit: 20, sinceDays: 365 });
    assert.equal(stale.status, "stale");
    assert.equal(stale.source, "cache");
    assert.equal(stale.nodes.length, graph.nodes.length);
  } finally {
    database.close();
    await rm(tempDir, { force: true, recursive: true });
  }
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

await run();
console.log("Commit graph fixture tests ok");
