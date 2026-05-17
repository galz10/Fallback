export {
  assertGitBranchName,
  assertGitCommitSha,
  assertGitRefName,
  assertGitRemoteName,
  assertGitStashRef,
  assertRepoRelativePath
} from "../git-input-validation.js";

export function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

export function assertOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return assertString(value, label);
}

export function assertStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`${label} must be a list of non-empty strings.`);
  }
  return value;
}

export function assertNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

export function assertOptionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return assertNumber(value, label);
}

export function assertHttpsUrl(value: unknown): string {
  const url = new URL(assertString(value, "URL"));
  if (url.protocol !== "https:") throw new Error("Only HTTPS URLs can be opened.");
  return url.toString();
}

export function assertLocalPath(value: unknown): string {
  const targetPath = assertString(value, "Path");
  if (targetPath.includes("\0")) throw new Error("Path contains an invalid character.");
  return targetPath;
}

export function assertBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`);
  return value;
}
