import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";

type PackageJson = {
  packageManager?: string;
  engines?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const trackedFiles = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .map((file) => file.trim())
  .filter(Boolean);
const deletedFiles = new Set(
  execFileSync("git", ["ls-files", "--deleted"], { encoding: "utf8" })
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean)
);

const failures: string[] = [];
const forbiddenTrackedFiles = [
  /^true(?:\.zwc)?$/,
  /(^|\/)\.env(?:$|\.)/,
  /\.zwc$/,
  /(^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|bun\.lockb?|deno\.lock)$/
];
const secretPatterns = [
  { name: "private key", pattern: /-----BEGIN (?:RSA |OPENSSH |DSA |EC |PGP )?PRIVATE KEY-----/ },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/ },
  { name: "classic GitHub token", pattern: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  { name: "npm token", pattern: /\bnpm_[A-Za-z0-9]{30,}\b/ },
  { name: "npm auth token config", pattern: /(?:^|\n)\s*(?:(?:(?:\/\/)?registry\.npmjs\.org\/)?:)?_authToken\s*=/ }
];
const exactSemverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

for (const file of trackedFiles) {
  if (deletedFiles.has(file)) continue;
  if (forbiddenTrackedFiles.some((pattern) => pattern.test(file))) failures.push(`Forbidden generated or local file is tracked: ${file}`);
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size > 1_000_000) continue;
  const body = readTextIfPossible(file);
  if (body == null) continue;
  for (const { name, pattern } of secretPatterns) {
    if (pattern.test(body)) failures.push(`Potential ${name} found in ${file}`);
  }
}

scanPackagePolicy();
scanPackageManagerPolicy();

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Repository hygiene scan ok");

function readTextIfPossible(file: string): string | null {
  const buffer = readFileSync(file);
  if (buffer.includes(0)) return null;
  return buffer.toString("utf8");
}

function scanPackagePolicy(): void {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;

  if (packageJson.packageManager !== "pnpm@10.33.2") failures.push("packageManager must stay pinned to pnpm@10.33.2.");
  if (packageJson.engines?.pnpm !== "10.33.x") failures.push("engines.pnpm must stay pinned to 10.33.x.");

  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const) {
    for (const [name, specifier] of Object.entries(packageJson[section] ?? {})) {
      if (!exactSemverPattern.test(specifier)) {
        failures.push(`${section}.${name} must use an exact registry version, not ${specifier}.`);
      }
      if (isExoticDependencySpecifier(specifier)) {
        failures.push(`${section}.${name} must resolve from the npm registry, not ${specifier}.`);
      }
    }
  }
}

function scanPackageManagerPolicy(): void {
  const npmrc = readFileSync(".npmrc", "utf8");
  const workspace = readFileSync("pnpm-workspace.yaml", "utf8");

  requireLine(npmrc, "allow-git=none", ".npmrc must block git dependencies for npm.");
  requireLine(npmrc, "min-release-age=14", ".npmrc must enforce a 14-day npm release cooldown.");

  requireLine(workspace, "minimumReleaseAge: 20160", "pnpm must enforce a 14-day release cooldown.");
  requireLine(workspace, "strictDepBuilds: true", "pnpm must fail on unreviewed lifecycle scripts.");
  requireLine(workspace, "blockExoticSubdeps: true", "pnpm must block exotic transitive dependency sources.");
  requireLine(workspace, "trustPolicy: no-downgrade", "pnpm must reject package trust downgrades.");

  for (const packageName of ["better-sqlite3", "electron", "electron-winstaller", "esbuild", "keytar"]) {
    requireLine(workspace, `  - ${packageName}`, `pnpm build-script allowlist is missing ${packageName}.`);
  }
}

function isExoticDependencySpecifier(specifier: string): boolean {
  return /^(?:git(?:\+|:)|https?:|github:|gitlab:|bitbucket:|file:|link:)/i.test(specifier);
}

function requireLine(body: string, expectedLine: string, message: string): void {
  if (!body.split(/\r?\n/).includes(expectedLine)) failures.push(message);
}
