import { parentPort } from "node:worker_threads";
import type { LocalChangeStatus } from "../../../src/shared/domain/local-git.js";

interface ParserRequest {
  id: number;
  task: "status" | "numstat";
  stdout: string;
}

interface StatusEntry {
  path: string;
  previousPath: string | null;
  status: LocalChangeStatus;
  staged: boolean;
  unstaged: boolean;
}

interface NumstatEntry {
  path: string;
  additions: number;
  deletions: number;
}

parentPort?.on("message", (message: ParserRequest) => {
  try {
    const value = message.task === "status" ? parseGitStatus(message.stdout) : parseNumstat(message.stdout);
    parentPort?.postMessage({ id: message.id, value });
  } catch (error) {
    parentPort?.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) });
  }
});

function parseGitStatus(stdout: string): StatusEntry[] {
  const parts = stdout.split("\0").filter(Boolean);
  const entries: StatusEntry[] = [];

  for (let i = 0; i < parts.length; i += 1) {
    const row = parts[i];
    const indexStatus = row[0] ?? " ";
    const worktreeStatus = row[1] ?? " ";
    const filePath = row.slice(3);
    const isRename = indexStatus === "R" || indexStatus === "C";
    const previousPath = isRename ? (parts[++i] ?? null) : null;
    const staged = indexStatus !== " " && indexStatus !== "?" && indexStatus !== "!";
    const unstaged = worktreeStatus !== " " || indexStatus === "?";
    entries.push({
      path: filePath,
      previousPath,
      status: statusKind(indexStatus, worktreeStatus),
      staged,
      unstaged
    });
  }

  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

function parseNumstat(stdout: string): NumstatEntry[] {
  return stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const [additions, deletions, filePath] = line.split("\t");
      return {
        path: normalizeNumstatPath(filePath ?? ""),
        additions: additions === "-" ? 0 : Number(additions) || 0,
        deletions: deletions === "-" ? 0 : Number(deletions) || 0
      };
    });
}

function statusKind(indexStatus: string, worktreeStatus: string): LocalChangeStatus {
  if (indexStatus === "?") return "untracked";
  if (indexStatus === "R" || worktreeStatus === "R") return "renamed";
  if (indexStatus === "C" || worktreeStatus === "C") return "copied";
  if (indexStatus === "A" || worktreeStatus === "A") return "added";
  if (indexStatus === "D" || worktreeStatus === "D") return "deleted";
  return "modified";
}

function normalizeNumstatPath(value: string): string {
  const braceRename = value.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (braceRename) return `${braceRename[1]}${braceRename[3]}${braceRename[4]}`;
  const arrowRename = value.match(/^.* => (.*)$/);
  return arrowRename?.[1] ?? value;
}
