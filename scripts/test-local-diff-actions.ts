import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DatabaseService } from "../electron/main/database-service.js";
import { LocalGitService } from "../electron/main/local-git-service.js";
import { SettingsService } from "../electron/main/settings-service.js";
import { hunkPatch, parseLocalPatch, selectedLinesPatch } from "../src/shared/local-diff-patches.js";

const execFileAsync = promisify(execFile);
const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-local-diff-actions-test-"));
const settings = new SettingsService();
settings.update({ workspacePath: tempDir });
const database = new DatabaseService(settings.databasePath());
const repoPath = path.join(tempDir, "repo");
const repoId = "github.com/octo/repo";

try {
  await git(tempDir, ["init", "-b", "main", "repo"]);
  await git(repoPath, ["config", "user.name", "Mona"]);
  await git(repoPath, ["config", "user.email", "mona@example.com"]);
  await writeFile(path.join(repoPath, "note.txt"), "one\ntwo\nthree\nfour\nfive\n");
  await writeFile(path.join(repoPath, "image.png"), tinyPng());
  await writeFile(path.join(repoPath, "bin.dat"), Buffer.from([0, 1, 2, 3]));
  await writeFile(path.join(repoPath, "large.bin"), Buffer.from([0]));
  await writeFile(path.join(repoPath, "pointer.txt"), lfsPointer("1".repeat(64)));
  await git(repoPath, ["add", "."]);
  await git(repoPath, ["commit", "-m", "Initial"]);

  database.db
    .prepare(
      `INSERT INTO repos (
         id, github_repo_id, owner, name, full_name, default_branch, is_private, is_fork, watch_enabled, local_path, sync_status, created_at, updated_at
       )
       VALUES (?, 1, 'octo', 'repo', 'octo/repo', 'main', 0, 0, 1, ?, 'idle', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    )
    .run(repoId, repoPath);

  const localGit = new LocalGitService(database, settings);
  await writeFile(path.join(repoPath, "note.txt"), "one\ntwo changed\nthree\nfour\nfive changed\n");

  const patch = await localGit.changePatch(repoId, "note.txt");
  assert.ok(patch.unstagedPatch?.includes("two changed"));
  const file = parseLocalPatch(patch.unstagedPatch ?? "")[0]!;
  const firstReplacement = file.hunks[0]!.changedLines.filter((line) => line.content === "two" || line.content === "two changed");
  const linePatch = selectedLinesPatch(
    file,
    firstReplacement.map((line) => line.id)
  )!;
  await localGit.applyLocalPatch(repoId, { action: "stage", path: "note.txt", patch: linePatch, selectionKind: "lines" });
  const cached = await gitText(repoPath, ["diff", "--cached", "--", "note.txt"]);
  assert.match(cached, /two changed/);
  assert.doesNotMatch(cached, /five changed/);

  const stagedPatch = await localGit.changePatch(repoId, "note.txt");
  const stagedFile = parseLocalPatch(stagedPatch.stagedPatch ?? "")[0]!;
  await localGit.applyLocalPatch(repoId, {
    action: "unstage",
    path: "note.txt",
    patch: selectedLinesPatch(
      stagedFile,
      stagedFile.hunks[0]!.changedLines.map((line) => line.id),
      { applyMode: "reverse" }
    )!,
    selectionKind: "lines"
  });
  assert.equal((await gitText(repoPath, ["diff", "--cached", "--name-only"])).trim(), "");

  const unstagedForHunkStage = await localGit.changePatch(repoId, "note.txt");
  const hunkStageFile = parseLocalPatch(unstagedForHunkStage.unstagedPatch ?? "")[0]!;
  await localGit.applyLocalPatch(repoId, {
    action: "stage",
    path: "note.txt",
    patch: hunkPatch(hunkStageFile, hunkStageFile.hunks[0]!.id)!,
    selectionKind: "hunk"
  });
  assert.match(await gitText(repoPath, ["diff", "--cached", "--", "note.txt"]), /five changed/);

  const stagedHunkPatch = await localGit.changePatch(repoId, "note.txt");
  const stagedHunkFile = parseLocalPatch(stagedHunkPatch.stagedPatch ?? "")[0]!;
  await localGit.applyLocalPatch(repoId, {
    action: "unstage",
    path: "note.txt",
    patch: hunkPatch(stagedHunkFile, stagedHunkFile.hunks[0]!.id)!,
    selectionKind: "hunk"
  });
  assert.equal((await gitText(repoPath, ["diff", "--cached", "--name-only"])).trim(), "");

  const unstagedAgain = await localGit.changePatch(repoId, "note.txt");
  const discardFile = parseLocalPatch(unstagedAgain.unstagedPatch ?? "")[0]!;
  await localGit.applyLocalPatch(repoId, {
    action: "discard",
    path: "note.txt",
    patch: hunkPatch(discardFile, discardFile.hunks[0]!.id)!,
    selectionKind: "hunk"
  });
  assert.equal(await readNote(repoPath), "one\ntwo\nthree\nfour\nfive\n");

  await writeFile(path.join(repoPath, "note.txt"), "one\ntwo changed\nthree\nfour\nfive changed\n");
  const lineDiscardPatch = await localGit.changePatch(repoId, "note.txt");
  const lineDiscardFile = parseLocalPatch(lineDiscardPatch.unstagedPatch ?? "")[0]!;
  const discardReplacement = lineDiscardFile.hunks[0]!.changedLines.filter(
    (line) => line.content === "two" || line.content === "two changed"
  ).map((line) => line.id);
  await localGit.applyLocalPatch(repoId, {
    action: "discard",
    path: "note.txt",
    patch: selectedLinesPatch(lineDiscardFile, discardReplacement, { applyMode: "reverse" })!,
    selectionKind: "lines"
  });
  assert.equal(await readNote(repoPath), "one\ntwo\nthree\nfour\nfive changed\n");

  const remainingPatch = await localGit.changePatch(repoId, "note.txt");
  const remainingFile = parseLocalPatch(remainingPatch.unstagedPatch ?? "")[0]!;
  await localGit.applyLocalPatch(repoId, {
    action: "discard",
    path: "note.txt",
    patch: hunkPatch(remainingFile, remainingFile.hunks[0]!.id)!,
    selectionKind: "hunk"
  });
  assert.equal(await readNote(repoPath), "one\ntwo\nthree\nfour\nfive\n");

  const history = await localGit.fileHistory(repoId, "note.txt");
  assert.equal(history.entries[0]?.subject, "Initial");
  assert.match(history.renameCaveat ?? "", /--follow/);

  const blame = await localGit.fileBlame(repoId, "note.txt");
  assert.equal(blame.lines.length, 5);
  assert.equal(blame.lines[0]?.content, "one");

  await git(repoPath, ["mv", "note.txt", "renamed-note.txt"]);
  await writeFile(path.join(repoPath, "renamed-note.txt"), "one\ntwo\nTHREE\nfour\nfive\n");
  const renamedHistory = await localGit.fileHistory(repoId, "renamed-note.txt");
  assert.equal(renamedHistory.entries[0]?.subject, "Initial");
  assert.match(renamedHistory.renameCaveat ?? "", /not committed yet/);
  const renamedBlame = await localGit.fileBlame(repoId, "renamed-note.txt");
  assert.equal(renamedBlame.lines.length, 5);
  assert.equal(renamedBlame.lines[2]?.content, "THREE");

  await writeFile(path.join(repoPath, "image.png"), tinyPng("changed"));
  const imagePatch = await localGit.changePatch(repoId, "image.png");
  assert.equal(imagePatch.preview?.kind, "image");
  assert.match(imagePatch.preview?.currentDataUrl ?? "", /^data:image\/png;base64,/);
  assert.match(imagePatch.preview?.previousDataUrl ?? "", /^data:image\/png;base64,/);

  await writeFile(path.join(repoPath, "bin.dat"), Buffer.from([0, 1, 2, 4]));
  const binaryPatch = await localGit.changePatch(repoId, "bin.dat");
  assert.equal(binaryPatch.preview?.kind, "binary");
  assert.equal(binaryPatch.preview?.isBinary, true);

  await writeFile(path.join(repoPath, "pointer.txt"), lfsPointer("2".repeat(64)));
  const lfsPatch = await localGit.changePatch(repoId, "pointer.txt");
  assert.equal(lfsPatch.preview?.kind, "lfs");
  assert.equal(lfsPatch.preview?.isLfsPointer, true);

  await writeFile(path.join(repoPath, "large.bin"), Buffer.alloc(1_000_001, 0));
  const largePatch = await localGit.changePatch(repoId, "large.bin");
  assert.equal(largePatch.preview?.kind, "too_large");
  assert.equal(largePatch.preview?.isTooLarge, true);

  const outsideSecret = path.join(tempDir, "outside-secret.txt");
  await writeFile(outsideSecret, "outside secret\n");
  await symlink(outsideSecret, path.join(repoPath, "secret-link.txt"));
  const symlinkPatch = await localGit.changePatch(repoId, "secret-link.txt");
  assert.equal(symlinkPatch.preview?.kind, "permission_error");
  assert.equal(symlinkPatch.preview?.currentDataUrl, null);
  assert.match(symlinkPatch.preview?.message ?? "", /Symlink targets are not read/);
  assert.doesNotMatch(symlinkPatch.patch, /outside secret/);

  console.log("Local diff action tests ok");
} finally {
  database.close();
  await rm(tempDir, { force: true, recursive: true });
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function gitText(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return result.stdout;
}

async function readNote(cwd: string): Promise<string> {
  return (await import("node:fs/promises")).readFile(path.join(cwd, "note.txt"), "utf8");
}

function tinyPng(seed = ""): Buffer {
  return Buffer.from(
    seed
      ? "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l7m6WQAAAABJRU5ErkJggg=="
      : "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
    "base64"
  );
}

function lfsPointer(oid: string): string {
  return `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 123\n`;
}
