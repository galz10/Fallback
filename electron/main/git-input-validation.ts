import path from "node:path";

const invalidVisibleRefChars = /[ ~^:?*[\\]/;

export function assertGitBranchName(value: unknown, label = "Branch name"): string {
  const clean = assertNonEmptyString(value, label).trim();
  if (clean.startsWith("-")) throw new Error(`${label} must not start with '-'.`);
  assertGitRefNameShape(clean, label);
  if (clean === "HEAD") throw new Error(`${label} must name a branch, not HEAD.`);
  return clean;
}

export function assertGitRemoteName(value: unknown, label = "Remote"): string {
  const clean = assertNonEmptyString(value, label).trim();
  if (clean.startsWith("-")) throw new Error(`${label} must not start with '-'.`);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(clean) || clean.includes(":")) throw new Error(`${label} must be a configured remote name.`);
  assertGitRefNameShape(clean, label);
  return clean;
}

export function assertGitRefName(value: unknown, label = "Git ref"): string {
  const clean = assertNonEmptyString(value, label).trim();
  if (clean.startsWith("-")) throw new Error(`${label} must not start with '-'.`);
  assertGitRefNameShape(clean, label);
  return clean;
}

export function assertGitCommitSha(value: unknown, label = "Commit SHA"): string {
  const clean = assertNonEmptyString(value, label).trim();
  if (!/^[0-9a-f]{7,64}$/i.test(clean)) throw new Error(`${label} must be a hexadecimal commit SHA.`);
  return clean;
}

export function assertGitStashRef(value: unknown, label = "Stash ref"): string {
  const clean = assertNonEmptyString(value, label).trim();
  if (!/^stash@\{\d+\}$/.test(clean)) throw new Error(`${label} must look like stash@{0}.`);
  return clean;
}

export function assertRepoRelativePath(value: unknown, label = "Path", options: { allowRoot?: boolean } = {}): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  if (options.allowRoot && value === "") return "";
  const clean = assertNonEmptyString(value, label);
  if (clean.includes("\0")) throw new Error(`${label} contains an invalid character.`);
  if (path.isAbsolute(clean)) throw new Error(`${label} must be relative to the repository.`);
  const unixPath = clean.replaceAll("\\", "/");
  if (unixPath.split("/").includes("..")) throw new Error(`${label} must stay inside the repository.`);
  const normalized = path.posix.normalize(unixPath);
  if (!options.allowRoot && (normalized === "." || normalized === "")) throw new Error(`${label} must name a file.`);
  return normalized === "." ? "" : normalized;
}

function assertGitRefNameShape(value: string, label: string): void {
  if (value.includes("..")) throw new Error(`${label} must not contain '..'.`);
  if (value.includes("@{")) throw new Error(`${label} must not contain '@{'.`);
  if (value.includes("//")) throw new Error(`${label} must not contain empty path segments.`);
  if (value.endsWith("/") || value.endsWith(".")) throw new Error(`${label} must not end with '/' or '.'.`);
  if (hasControlCharacter(value) || invalidVisibleRefChars.test(value)) throw new Error(`${label} contains invalid Git ref characters.`);
  for (const segment of value.split("/")) {
    if (!segment || segment.startsWith(".") || segment.endsWith(".lock")) {
      throw new Error(`${label} contains an invalid Git ref segment.`);
    }
  }
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty string.`);
  return value;
}
