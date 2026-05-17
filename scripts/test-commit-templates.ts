import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DatabaseService } from "../electron/main/database-service.js";
import { LocalGitService } from "../electron/main/local-git-service.js";
import { SettingsService } from "../electron/main/settings-service.js";
import {
  commitDraftFromTemplate,
  commitTemplateContext,
  interpolateCommitTemplate,
  upsertCommitTemplate
} from "../src/shared/commit-templates.js";

const execFileAsync = promisify(execFile);

const context = commitTemplateContext({
  summary: "wire templates",
  branch: "feature/FB-123-commit-templates",
  repoFullName: "octo/repo",
  identity: {
    repoId: "repo-1",
    accountId: null,
    accountLogin: null,
    accountEndpoint: "https://api.github.com",
    accountStatus: null,
    gitName: "Mona",
    gitEmail: "mona@example.com",
    signingMode: "unsigned",
    signingKeyHint: null,
    remoteProtocol: "https",
    verifiedEmailStatus: "ok",
    lastCheckedAt: null,
    lastCheckStatus: "ok",
    currentGitName: "Mona",
    currentGitEmail: "mona@example.com",
    branch: "feature/FB-123-commit-templates",
    remoteUrl: null,
    localPath: null,
    mismatchReason: null,
    createdAt: null,
    updatedAt: null
  }
});

assert.equal(
  interpolateCommitTemplate("{ticket} {summary} on {branch} for {repo} by {author}", context),
  "FB-123 wire templates on feature/FB-123-commit-templates for octo/repo by Mona <mona@example.com>"
);

const draft = commitDraftFromTemplate(
  {
    body: "{ticket}: {summary}\n\nRepo: {repo}\n# comment from git template\nAuthor: {author}"
  },
  context
);
assert.equal(draft.summary, "FB-123: wire templates");
assert.equal(draft.description, "Repo: octo/repo\nAuthor: Mona <mona@example.com>");

const upserted = upsertCommitTemplate([], {
  id: "repo-template",
  name: "Repo template",
  body: "{summary}",
  repoId: "octo-repo"
});
assert.equal(upserted.length, 1);
assert.equal(upserted[0]?.repoId, "octo-repo");

const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-commit-templates-test-"));
const settings = new SettingsService();
settings.update({ workspacePath: tempDir, commitTemplates: upserted });
const database = new DatabaseService(settings.databasePath());
const localGit = new LocalGitService(database, settings);
const repoPath = path.join(tempDir, "repo");

try {
  await git(tempDir, ["init", "-b", "main", "repo"]);
  await writeFile(path.join(repoPath, ".gitmessage"), "git: {summary}\n\nBranch: {branch}\n");
  await git(repoPath, ["config", "commit.template", ".gitmessage"]);
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

  const templates = await localGit.commitTemplates("octo-repo");
  assert.equal(templates[0]?.source, "git");
  assert.equal(templates[0]?.body.includes("git: {summary}"), true);
  assert.ok(templates.some((template) => template.source === "fallback" && template.scope === "repo"));
  assert.ok(templates.some((template) => template.id === "builtin:conventional"));
} finally {
  database.close();
  await rm(tempDir, { force: true, recursive: true });
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

console.log("Commit template tests ok");
