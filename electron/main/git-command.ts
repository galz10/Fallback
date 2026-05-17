import { execFile } from "node:child_process";
import path from "node:path";

const gitMaxBuffer = 24 * 1024 * 1024;

export async function gitRaw(cwd: string, args: string[], timeout = 30_000, allowExitCodes = [0], signal?: AbortSignal): Promise<string> {
  const startedAt = performance.now();
  return new Promise((resolve, reject) => {
    let timedOut = false;
    let aborted = false;
    let stopPromise: Promise<void> | null = null;
    const child = execFile("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: gitMaxBuffer }, (error, stdout, stderr) => {
      void settle(error, stdout, stderr);
    });
    const stopChild = () => {
      stopPromise ??= stopProcessTree(child.pid).finally(() => {
        child.kill();
      });
      return stopPromise;
    };
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      void stopChild();
    }, timeout);
    const abortHandler = () => {
      aborted = true;
      void stopChild();
    };
    signal?.addEventListener("abort", abortHandler, { once: true });
    if (signal?.aborted) abortHandler();

    async function settle(error: Error | null, stdout: string, stderr: string): Promise<void> {
      clearTimeout(timeoutHandle);
      signal?.removeEventListener("abort", abortHandler);
      if (stopPromise) await stopPromise;
      const durationMs = performance.now() - startedAt;
      if (durationMs >= 250) {
        console.warn(`[perf] slow git ${formatGitCommand(args)} in ${path.basename(cwd)}: ${Math.round(durationMs)}ms`);
      }
      if (timedOut) {
        reject(new Error(formatGitError(cwd, stderr.trim() || `Git command timed out after ${timeout}ms.`)));
        return;
      }
      if (aborted) {
        reject(new Error(formatGitError(cwd, stderr.trim() || "Git command was aborted.")));
        return;
      }
      if (error && !allowExitCodes.includes(gitExitCode(error))) {
        reject(new Error(formatGitError(cwd, stderr.trim() || error.message)));
        return;
      }
      resolve(stdout);
    }
  });
}

export async function gitText(cwd: string, args: string[], timeout = 30_000, signal?: AbortSignal): Promise<string> {
  return (await gitRaw(cwd, args, timeout, [0], signal)).trim();
}

export function gitExitCode(error: unknown): number {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "number" ? error.code : -1;
}

export function formatGitError(cwd: string, message: string): string {
  if (message.includes("index.lock")) {
    return `Git is busy in this repository. If no git operation is running, remove ${path.join(cwd, ".git", "index.lock")} and try again.`;
  }
  return message;
}

function formatGitCommand(args: string[]): string {
  return args.map((arg) => (arg.length > 80 ? `${arg.slice(0, 77)}...` : arg)).join(" ");
}

async function stopProcessTree(pid: number | undefined): Promise<void> {
  if (!pid) return;
  if (process.platform !== "win32") return;
  await new Promise<void>((resolve) => {
    execFile("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true }, () => resolve());
  });
}
