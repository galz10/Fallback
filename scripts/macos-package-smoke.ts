import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar") as typeof import("@electron/asar");

const requireSigned = process.argv.includes("--require-signed");
const requireNotarized = process.argv.includes("--require-notarized");

if (process.platform !== "darwin") {
  throw new Error("macOS package smoke must run on macOS.");
}

const root = process.cwd();
const appPath = findPackagedApp(path.join(root, "release"));
if (!appPath) throw new Error("Could not find Fallback.app under release/. Run pnpm package:dir or pnpm package:mac first.");

console.log(`[smoke] found ${path.relative(root, appPath)}`);
verifyPackagedRenderer(appPath);

if (requireSigned) {
  execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], { stdio: "inherit" });
  console.log("[smoke] codesign verification ok");
}

if (requireNotarized) {
  execFileSync("spctl", ["--assess", "--type", "execute", "--verbose=2", appPath], { stdio: "inherit" });
  console.log("[smoke] Gatekeeper assessment ok");
}

await launchSmoke(appPath);

function verifyPackagedRenderer(appPath: string): void {
  const appAsarPath = path.join(appPath, "Contents", "Resources", "app.asar");
  if (!fs.existsSync(appAsarPath)) throw new Error(`Packaged app.asar missing: ${appAsarPath}`);
  const files = new Set(asar.listPackage(appAsarPath));
  const requiredFiles = ["/dist/index.html", "/dist-electron/electron/main/index.js", "/dist-electron/electron/preload/index.js"];
  for (const file of requiredFiles) {
    if (!files.has(file)) throw new Error(`Packaged artifact missing ${file}`);
  }
  const indexHtml = asar.extractFile(appAsarPath, "dist/index.html").toString("utf8");
  if (!indexHtml.includes(`script-src 'self'`)) throw new Error("Packaged renderer CSP must block remote scripts.");
  if (!indexHtml.includes('src="./assets/')) throw new Error("Packaged renderer must load local file assets.");
  const preload = asar.extractFile(appAsarPath, "dist-electron/electron/preload/index.js").toString("utf8");
  if (!preload.includes("fallback")) throw new Error("Packaged preload API bundle is missing fallback bridge code.");
  console.log("[smoke] packaged renderer, CSP, and preload checks ok");
}

function findPackagedApp(directory: string): string | null {
  if (!fs.existsSync(directory)) return null;
  const candidates: string[] = [];
  visit(directory, candidates);
  return candidates.sort((a, b) => scoreApp(b) - scoreApp(a))[0] ?? null;
}

function visit(directory: string, candidates: string[]): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name === "Fallback.app") {
      candidates.push(fullPath);
      continue;
    }
    if (entry.isDirectory()) visit(fullPath, candidates);
  }
}

function scoreApp(appPath: string): number {
  if (appPath.includes("mac-arm64")) return 100;
  if (appPath.includes("mac")) return 80;
  return 1;
}

function launchSmoke(appPath: string): Promise<void> {
  const executable = path.join(appPath, "Contents", "MacOS", "Fallback");
  if (!fs.existsSync(executable)) throw new Error(`Packaged executable missing: ${executable}`);
  console.log(`[smoke] launching ${path.relative(root, executable)}`);
  return new Promise((resolve, reject) => {
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
      reject(new Error("Packaged app smoke timed out after 30s."));
    }, 30_000);
    child.stdout.on("data", (chunk: Buffer) => processOutput(chunk));
    child.stderr.on("data", (chunk: Buffer) => processOutput(chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code && code !== 0) reject(new Error(`Packaged app exited with code ${code}.`));
      else resolve();
    });
  });
}

function processOutput(chunk: Buffer): void {
  for (const line of chunk.toString("utf8").split(/\r?\n/)) {
    if (line.includes("[perf]")) console.log(line);
  }
}
