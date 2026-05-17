import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const releaseDir = path.join(root, "release");
const executable = findPackagedExecutable(releaseDir);

if (!executable) {
  console.error("Could not find packaged app executable under release/. Run pnpm package:dir first.");
  process.exit(1);
}

console.log(`[perf] launching packaged app: ${path.relative(root, executable)}`);

const child = spawn(executable, [], {
  cwd: root,
  env: {
    ...process.env,
    FALLBACK_PERF_SMOKE: "1"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

const timeout = setTimeout(() => {
  child.kill("SIGTERM");
  console.error("[perf] packaged smoke timed out after 30s");
  process.exitCode = 1;
}, 30_000);

child.stdout.on("data", (chunk: Buffer) => processOutput(chunk));
child.stderr.on("data", (chunk: Buffer) => processOutput(chunk));

child.on("exit", (code) => {
  clearTimeout(timeout);
  if (code && code !== 0) process.exitCode = code;
});

function processOutput(chunk: Buffer): void {
  for (const line of chunk.toString("utf8").split(/\r?\n/)) {
    if (!line.includes("[perf]")) continue;
    console.log(line);
  }
}

function findPackagedExecutable(directory: string): string | null {
  if (!fs.existsSync(directory)) return null;
  const candidates: string[] = [];
  visit(directory, candidates);
  return candidates.sort((a, b) => scoreExecutable(b) - scoreExecutable(a))[0] ?? null;
}

function visit(directory: string, candidates: string[]): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.endsWith(".app")) {
        const macExecutableDir = path.join(fullPath, "Contents", "MacOS");
        if (fs.existsSync(macExecutableDir)) {
          for (const appEntry of fs.readdirSync(macExecutableDir, { withFileTypes: true })) {
            if (appEntry.isFile()) candidates.push(path.join(macExecutableDir, appEntry.name));
          }
        }
      }
      visit(fullPath, candidates);
      continue;
    }
    if (entry.isFile() && (entry.name === "fallback" || entry.name === "Fallback" || entry.name.endsWith(".exe"))) {
      candidates.push(fullPath);
    }
  }
}

function scoreExecutable(filePath: string): number {
  if (filePath.includes(".app/Contents/MacOS/")) return 100;
  if (filePath.includes("linux-unpacked")) return 80;
  if (filePath.endsWith(".exe")) return 60;
  return 1;
}
