import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { promisify } from "node:util";
import packageJson from "../package.json" with { type: "json" };

const execFileAsync = promisify(execFile);
const linuxConfig = packageJson.build?.linux;
const debConfig = packageJson.build?.deb;
const requireArtifacts = process.argv.includes("--require-artifacts");
assert.ok(linuxConfig, "electron-builder linux config is required");
assert.equal(linuxConfig.category, "Development");
assert.match(linuxConfig.synopsis ?? "", /Local-first GitHub/);
assert.match(linuxConfig.maintainer ?? "", /^Fallback <[^@\s]+@[^@\s]+\.[^@\s]+>$/, "Linux package maintainer email is required");
assert.ok(linuxConfig.desktop?.entry?.StartupWMClass, "Linux desktop StartupWMClass is required");
assert.deepEqual(linuxConfig.target?.map((target) => target.target).sort(), ["AppImage", "deb"].sort());
assert.ok(debConfig?.depends?.includes("git"), "deb package must depend on git");
assert.ok(debConfig?.depends?.includes("libsecret-1-0"), "deb package must depend on libsecret");
assert.ok(debConfig?.depends?.includes("xdg-utils"), "deb package must depend on xdg-utils");

if (process.platform !== "linux") {
  console.log("Linux package config smoke ok; boot smoke skipped on non-Linux host");
  process.exit(0);
}

const artifacts = await readdir("release").catch(() => []);
const appImage = artifacts.find((name) => name.endsWith(".AppImage"));
const deb = artifacts.find((name) => name.endsWith(".deb"));
if (!requireArtifacts && (!appImage || !deb)) {
  console.log("Linux package config smoke ok; boot smoke skipped because package artifacts are not present");
  process.exit(0);
}
assert.ok(appImage, "Build an AppImage with pnpm package:linux before Linux boot smoke");
assert.ok(deb, "Build a deb with pnpm package:linux before Linux boot smoke");
await access(`release/${deb}`);

const xvfb = await commandExists("xvfb-run");
const runner = xvfb ? ["xvfb-run", "-a", `release/${appImage}`, "--no-sandbox"] : [`release/${appImage}`, "--no-sandbox"];
await launchSmoke(runner);

console.log("Linux package boot smoke ok");

function launchSmoke(runner: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(runner[0]!, runner.slice(1), {
      cwd: process.cwd(),
      env: {
        ...process.env,
        FALLBACK_PERF_SMOKE: "1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Linux packaged app smoke timed out after 30s."));
    }, 30_000);
    child.stdout.on("data", (chunk: Buffer) => processOutput(chunk));
    child.stderr.on("data", (chunk: Buffer) => processOutput(chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code && code !== 0) reject(new Error(`Linux packaged app exited with code ${code}.`));
      else resolve();
    });
  });
}

function processOutput(chunk: Buffer): void {
  for (const line of chunk.toString("utf8").split(/\r?\n/)) {
    if (line.includes("[perf]")) console.log(line);
  }
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync("sh", ["-lc", `command -v ${command}`], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}
