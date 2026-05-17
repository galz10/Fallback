import { createRequire } from "node:module";
import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const require = createRequire(import.meta.url);
const mode = process.argv[2] ?? "node";
const nativePackages = ["better-sqlite3", "keytar"];

if (mode === "clean") {
  for (const packageName of nativePackages) {
    const packageRoot = path.dirname(require.resolve(`${packageName}/package.json`));
    rmSync(path.join(packageRoot, "build"), { force: true, recursive: true });
    rmSync(path.join(packageRoot, "prebuilds"), { force: true, recursive: true });
  }
  run("pnpm", ["rebuild:node"]);
  process.exit(0);
}

if (mode !== "node") {
  throw new Error(`Unknown native runtime mode: ${mode}`);
}

const failures = nativePackages.flatMap((packageName) => {
  try {
    loadNativePackage(packageName);
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isNativeAbiError(message)) return [{ packageName, message }];
    if (packageName === "keytar" && /libsecret|keychain|Cannot find module/i.test(message)) return [];
    throw error;
  }
});

if (failures.length === 0) {
  process.exit(0);
}

console.warn(
  `Native module ABI mismatch for Node ${process.versions.node} (modules ${process.versions.modules}); rebuilding ${failures
    .map((failure) => failure.packageName)
    .join(", ")}.`
);
for (const failure of failures) removeNativeBuild(failure.packageName);
run("pnpm", ["rebuild:node"]);

for (const failure of failures) {
  try {
    require(failure.packageName);
    loadNativePackage(failure.packageName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Native module ${failure.packageName} still cannot load after rebuild: ${message}`, { cause: error });
  }
}

function loadNativePackage(packageName: string): void {
  const loaded = require(packageName);
  if (packageName === "better-sqlite3") {
    const db = new loaded(":memory:");
    db.close();
  }
}

function removeNativeBuild(packageName: string): void {
  const packageRoot = path.dirname(require.resolve(`${packageName}/package.json`));
  rmSync(path.join(packageRoot, "build"), { force: true, recursive: true });
}

function isNativeAbiError(message: string): boolean {
  return /NODE_MODULE_VERSION|Module did not self-register|was compiled against|invalid ELF header|mach-o file/i.test(message);
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
