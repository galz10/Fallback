import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { withTempDir } from "./temp.js";

const execFileAsync = promisify(execFile);

export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return stdout;
}

export async function withTempGitRepo<T>(
  prefix: string,
  run: (input: { tempDir: string; repoPath: string; git: (args: string[]) => Promise<string> }) => Promise<T>
): Promise<T> {
  return withTempDir(prefix, async (tempDir) => {
    const repoPath = path.join(tempDir, "repo");
    await mkdir(repoPath, { recursive: true });
    await git(repoPath, ["init", "-b", "main"]);
    await git(repoPath, ["config", "user.email", "fallback@example.com"]);
    await git(repoPath, ["config", "user.name", "Fallback"]);
    return run({ tempDir, repoPath, git: (args) => git(repoPath, args) });
  });
}
