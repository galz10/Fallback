import { execFile } from "node:child_process";
import { Worker } from "node:worker_threads";
import type { LocalChangeStatus, LocalStashFile } from "../../../src/shared/domain/local-git.js";
import { gitRaw } from "../git-command.js";

let localGitParserWorker: Worker | null = null;
let localGitParserWorkerRequestId = 0;
let localGitParserWorkerIdleTimer: NodeJS.Timeout | null = null;

export const parserWorkerThresholdBytes = 64_000;

export const parserWorkerIdleMs = 30_000;

export interface StatusEntry {
  path: string;
  previousPath: string | null;
  status: LocalChangeStatus;
  staged: boolean;
  unstaged: boolean;
}

export interface NumstatEntry {
  path: string;
  additions: number;
  deletions: number;
}

export async function gitStatus(cwd: string): Promise<StatusEntry[]> {
  const stdout = await gitRaw(cwd, ["status", "--porcelain=v1", "--untracked-files=all", "-z"]);
  if (stdout.length >= parserWorkerThresholdBytes) return parseWithLocalGitWorker<StatusEntry[]>("status", stdout);
  return parseGitStatus(stdout);
}

export async function gitRawWithInput(
  cwd: string,
  args: string[],
  input: string,
  timeout = 30_000,
  allowExitCodes = [0],
  signal?: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      ["-C", cwd, ...args],
      { encoding: "utf8", maxBuffer: 24 * 1024 * 1024, timeout, signal },
      (error, stdout, stderr) => {
        if (error && !allowExitCodes.includes(gitExitCode(error))) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stdout);
      }
    );
    child.stdin?.end(input);
  });
}

export function gitExitCode(error: unknown): number {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "number" ? error.code : -1;
}

export function parseGitStatus(stdout: string): StatusEntry[] {
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

export function statusKind(indexStatus: string, worktreeStatus: string): LocalChangeStatus {
  if (indexStatus === "?") return "untracked";
  if (indexStatus === "R" || worktreeStatus === "R") return "renamed";
  if (indexStatus === "C" || worktreeStatus === "C") return "copied";
  if (indexStatus === "A" || worktreeStatus === "A") return "added";
  if (indexStatus === "D" || worktreeStatus === "D") return "deleted";
  return "modified";
}

export async function gitNumstat(cwd: string, args: string[]): Promise<NumstatEntry[]> {
  const stdout = await gitRaw(cwd, args);
  if (stdout.length >= parserWorkerThresholdBytes) return parseWithLocalGitWorker<NumstatEntry[]>("numstat", stdout);
  return parseGitNumstat(stdout);
}

export function parseGitNumstat(stdout: string): NumstatEntry[] {
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

export const localGitParserWorkerRequests = new Map<
  number,
  {
    resolve(value: unknown): void;
    reject(error: Error): void;
  }
>();

export function parseWithLocalGitWorker<T>(task: "status" | "numstat", stdout: string): Promise<T> {
  const worker = ensureLocalGitParserWorker();
  const id = ++localGitParserWorkerRequestId;
  if (localGitParserWorkerIdleTimer) {
    clearTimeout(localGitParserWorkerIdleTimer);
    localGitParserWorkerIdleTimer = null;
  }

  return new Promise<T>((resolve, reject) => {
    localGitParserWorkerRequests.set(id, {
      resolve: (value) => resolve(value as T),
      reject
    });
    worker.postMessage({ id, task, stdout });
  });
}

export function ensureLocalGitParserWorker(): Worker {
  if (localGitParserWorker) return localGitParserWorker;
  localGitParserWorker = new Worker(new URL("../workers/local-git-parser.worker.js", import.meta.url));
  localGitParserWorker.on("message", (message: { id: number; value?: unknown; error?: string }) => {
    const request = localGitParserWorkerRequests.get(message.id);
    if (!request) return;
    localGitParserWorkerRequests.delete(message.id);
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(message.value);
    scheduleLocalGitParserWorkerDispose();
  });
  localGitParserWorker.on("error", (error) => {
    for (const request of localGitParserWorkerRequests.values()) request.reject(error);
    localGitParserWorkerRequests.clear();
    disposeLocalGitParserWorker();
  });
  localGitParserWorker.on("exit", () => {
    for (const request of localGitParserWorkerRequests.values()) request.reject(new Error("Local Git parser worker exited."));
    localGitParserWorkerRequests.clear();
    localGitParserWorker = null;
  });
  return localGitParserWorker;
}

export function scheduleLocalGitParserWorkerDispose(): void {
  if (localGitParserWorkerRequests.size > 0 || localGitParserWorkerIdleTimer) return;
  localGitParserWorkerIdleTimer = setTimeout(() => disposeLocalGitParserWorker(), parserWorkerIdleMs);
}

export function disposeLocalGitParserWorker(): void {
  if (localGitParserWorkerIdleTimer) {
    clearTimeout(localGitParserWorkerIdleTimer);
    localGitParserWorkerIdleTimer = null;
  }
  const worker = localGitParserWorker;
  localGitParserWorker = null;
  if (worker) void worker.terminate();
}

export function mergeStats(...groups: NumstatEntry[][]): Map<string, { additions: number; deletions: number }> {
  const stats = new Map<string, { additions: number; deletions: number }>();
  for (const entry of groups.flat()) {
    const current = stats.get(entry.path) ?? { additions: 0, deletions: 0 };
    stats.set(entry.path, {
      additions: current.additions + entry.additions,
      deletions: current.deletions + entry.deletions
    });
  }
  return stats;
}

export function normalizeNumstatPath(value: string): string {
  const braceRename = value.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (braceRename) return `${braceRename[1]}${braceRename[3]}${braceRename[4]}`;
  const arrowRename = value.match(/^.* => (.*)$/);
  return arrowRename?.[1] ?? value;
}

export function parseNameStatus(stdout: string): Array<Omit<LocalStashFile, "additions" | "deletions">> {
  return stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const [rawStatus = "", firstPath = "", secondPath] = line.split("\t");
      const statusCode = rawStatus[0] ?? "M";
      const status = nameStatusKind(statusCode);
      if ((statusCode === "R" || statusCode === "C") && secondPath) {
        return {
          path: secondPath,
          previousPath: firstPath,
          status
        };
      }
      return {
        path: firstPath,
        previousPath: null,
        status
      };
    });
}

export function parseNumstat(stdout: string): NumstatEntry[] {
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

export function nameStatusKind(statusCode: string): LocalStashFile["status"] {
  if (statusCode === "A") return "added";
  if (statusCode === "D") return "deleted";
  if (statusCode === "R") return "renamed";
  if (statusCode === "C") return "copied";
  return "modified";
}
