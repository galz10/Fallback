import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { WorkspaceService } from "../electron/main/workspace-service.js";
import { defaultCommandPaletteKeybindings, type AppSettings } from "../src/shared/domain/settings.js";

const execFileAsync = promisify(execFile);

const settings = (workspacePath: string): AppSettings => ({
  workspacePath,
  defaultWatchMode: "cloned",
  cloneReposByDefault: true,
  createRepoFoldersOnWatch: true,
  openRepoFolderAfterWatch: false,
  restoreWindowsOnLaunch: false,
  syncFrequencyMinutes: 15,
  closedIssueRetentionDays: 365,
  shell: {
    preferredEditorCommand: null,
    preferredTerminalCommand: null
  },
  branchIntegrity: {
    enabled: true,
    fetchSafetyRefs: true,
    automaticAuditAfterSync: false,
    alertThreshold: "high",
    largeDiffRatioThreshold: 5,
    largeDiffAbsoluteThreshold: 500,
    requireExactMergeGroupTreeForReleases: true
  },
  attention: {
    collapseBotActivity: true,
    promoteFailingChecks: true,
    promoteDirectMentions: true,
    promoteReviewRequests: true,
    quietPassingCi: true,
    workingHoursStart: "09:00",
    workingHoursEnd: "17:00"
  },
  keybindings: {
    commandPalette: { ...defaultCommandPaletteKeybindings }
  },
  commitTemplates: []
});

async function run(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-branch-refresh-"));
  const remotePath = path.join(tempDir, "remote.git");
  const seedPath = path.join(tempDir, "seed");
  const dirtyWorkspace = path.join(tempDir, "dirty-workspace");
  const cleanWorkspace = path.join(tempDir, "clean-workspace");

  try {
    await git(tempDir, ["init", "--bare", remotePath]);
    await git(tempDir, ["init", "-b", "main", seedPath]);
    await git(seedPath, ["config", "user.email", "fallback@example.com"]);
    await git(seedPath, ["config", "user.name", "Fallback"]);
    await writeFile(path.join(seedPath, "README.md"), "one\n");
    await git(seedPath, ["add", "README.md"]);
    await git(seedPath, ["commit", "-m", "initial"]);
    await git(seedPath, ["remote", "add", "origin", remotePath]);
    await git(seedPath, ["push", "-u", "origin", "main"]);
    await git(remotePath, ["symbolic-ref", "HEAD", "refs/heads/main"]);

    const cleanService = new WorkspaceService(() => settings(cleanWorkspace));
    const cleanClone = await cleanService.ensureRepoClone("octo", "repo", remotePath, "main");
    const initialHead = await gitText(cleanClone, ["rev-parse", "HEAD"]);

    await writeFile(path.join(seedPath, "README.md"), "two\n");
    await git(seedPath, ["commit", "-am", "remote update"]);
    await git(seedPath, ["push"]);
    const remoteHead = await gitText(seedPath, ["rev-parse", "HEAD"]);

    await cleanService.ensureRepoClone("octo", "repo", remotePath, "main");
    assert.equal(await gitText(cleanClone, ["rev-parse", "HEAD"]), remoteHead);
    assert.notEqual(initialHead, remoteHead);

    const dirtyService = new WorkspaceService(() => settings(dirtyWorkspace));
    const dirtyClone = await dirtyService.ensureRepoClone("octo", "repo", remotePath, "main");
    await writeFile(path.join(dirtyClone, "README.md"), "local edit\n");

    await writeFile(path.join(seedPath, "README.md"), "three\n");
    await git(seedPath, ["commit", "-am", "second remote update"]);
    await git(seedPath, ["push"]);
    const nextRemoteHead = await gitText(seedPath, ["rev-parse", "HEAD"]);

    await dirtyService.ensureRepoClone("octo", "repo", remotePath, "main");
    assert.equal(await gitText(dirtyClone, ["rev-parse", "HEAD"]), remoteHead);
    assert.equal(await gitText(dirtyClone, ["rev-parse", "origin/main"]), nextRemoteHead);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function gitText(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return stdout.trim();
}

await run();
console.log("Workspace branch refresh tests ok");
