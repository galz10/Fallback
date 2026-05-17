import { spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const electronBin = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");

console.log("[perf] launching production renderer smoke: electron .");

const child = spawn(electronBin, ["."], {
  cwd: root,
  env: {
    ...process.env,
    FALLBACK_LOAD_PRODUCTION: "1",
    FALLBACK_PERF_SMOKE: "1"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

const timeout = setTimeout(() => {
  child.kill("SIGTERM");
  console.error("[perf] production renderer smoke timed out after 30s");
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
