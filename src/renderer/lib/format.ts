import type { RepoCodeSummary, RepoCommitSummary } from "../../shared/domain/repo-code";
import type { LocalChangesState } from "../../shared/domain/local-git";

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function formatRelative(value: string): string {
  const diff = Date.now() - Date.parse(value);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days > 1 ? "s" : ""} ago`;
  return formatDate(value);
}

export function compactCount(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}

export function countLabel(value: number | undefined, more = false): string {
  if (value === undefined) return "-";
  return `${compactCount(value)}${more ? "+" : ""}`;
}

export function localChangesSidebarLabel(changes: LocalChangesState): string {
  if (changes.isDirty) {
    const parts = [];
    if (changes.additions > 0) parts.push(`+${compactCount(changes.additions)}`);
    if (changes.deletions > 0) parts.push(`-${compactCount(changes.deletions)}`);
    return parts.join(" ") || compactCount(changes.files.length);
  }
  return `${compactCount(changes.stashes.length)}`;
}

export function revertCommitSummary(commit: RepoCommitSummary): string {
  const subject = commit.message.split("\n")[0]?.trim() || shortSha(commit.sha);
  return subject.startsWith("Revert ") ? subject : `Revert "${subject}"`;
}

export function shortSha(value: string): string {
  return value.slice(0, 7);
}

export function shortHash(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").slice(-7) || "cached";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[u]}`;
}

export function repoSizeTitle(codeSummary?: RepoCodeSummary): string {
  if (!codeSummary) return "Repository code size plus cached Fallback data.";
  const codeBytes = codeSummary.sizeKb == null ? null : codeSummary.sizeKb * 1024;
  const parts = [
    codeBytes == null ? "Code size: unknown" : `Code size: ${formatBytes(codeBytes)}`,
    `Cached data: ${formatBytes(codeSummary.cachedBytes)}`
  ];
  if (codeSummary.totalStoredBytes != null) parts.push(`Total: ${formatBytes(codeSummary.totalStoredBytes)}`);
  return parts.join("\n");
}

export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function endpointLabel(endpoint?: string | null): string {
  if (!endpoint || endpoint === "https://api.github.com") return "GitHub.com";
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}
