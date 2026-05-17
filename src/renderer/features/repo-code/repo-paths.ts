import type { RepoFileEntry } from "../../../shared/domain/repo-code";

export function sortRepoFiles(a: RepoFileEntry, b: RepoFileEntry): number {
  if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
  return a.name.localeCompare(b.name);
}

export function parentPath(value: string): string {
  const parts = value.split("/");
  parts.pop();
  return parts.join("/");
}
