import path from "node:path";
import { homedir } from "node:os";

export function defaultWorkspacePath(): string {
  return path.join(homedir(), "Fallback");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function repoIdFromFullName(fullName: string): string {
  return `github.com/${fullName.toLowerCase()}`;
}

export function normalizeRepoFullName(input: string): { owner: string; name: string; fullName: string } {
  const fullName = input
    .trim()
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\.git$/, "");
  const [owner, name, ...rest] = fullName.split("/");
  if (!owner || !name || rest.length > 0) {
    throw new Error("Repository must be in owner/name format.");
  }
  return { owner, name, fullName: `${owner}/${name}` };
}
