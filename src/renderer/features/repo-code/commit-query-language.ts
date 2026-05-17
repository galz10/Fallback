import type { WatchedRepo } from "../../../shared/domain/watched-repo";
import type {
  CommitGraphNode,
  CommitGraphViewModel,
  CommitSearchHit,
  CommitSearchInput,
  CommitSearchResult,
  RepoCommitSummary
} from "../../../shared/domain/repo-code";

export interface CommitQuerySuggestion {
  value: string;
  description: string;
}

export function buildCommitFilterSuggestions(
  query: string,
  values: { authors: string[]; refs: string[]; paths: string[]; shas: string[] }
): CommitQuerySuggestion[] {
  const token = currentCommitQueryToken(query);
  const qualifierMatch = token.match(/^([a-z-]+):(.*)$/i);
  if (!qualifierMatch) {
    return filterCommitSuggestions(
      [
        { value: "author:", description: "Author" },
        { value: "branch:", description: "Branch or ref" },
        { value: "path:", description: "Changed path" },
        { value: "sha:", description: "Commit SHA" },
        { value: "message:", description: "Commit message" },
        { value: "after:", description: "Since date" },
        { value: "before:", description: "Until date" }
      ],
      token
    );
  }

  const key = qualifierMatch[1]!.toLowerCase();
  const typed = qualifierMatch[2] ?? "";
  if (key === "author") return filterCommitSuggestions(commitValueSuggestions("author", values.authors, "Author"), typed);
  if (key === "branch" || key === "ref") return filterCommitSuggestions(commitValueSuggestions(key, values.refs, "Branch"), typed);
  if (key === "path" || key === "file") return filterCommitSuggestions(commitValueSuggestions(key, values.paths, "Path"), typed);
  if (key === "sha") return filterCommitSuggestions(commitValueSuggestions("sha", values.shas, "SHA"), typed);
  if (key === "after" || key === "since") return filterCommitSuggestions(relativeDateSuggestions(key, "Since"), typed);
  if (key === "before" || key === "until") return filterCommitSuggestions(relativeDateSuggestions(key, "Until"), typed);
  return [];
}

function commitValueSuggestions(key: string, values: string[], description: string): CommitQuerySuggestion[] {
  return values.map((value) => ({
    value: `${key}:${quoteCommitQueryValue(value)}`,
    description
  }));
}

function relativeDateSuggestions(key: string, description: string): CommitQuerySuggestion[] {
  return ["7.days.ago", "2.weeks.ago", "1.month.ago", "3.months.ago"].map((value) => ({
    value: `${key}:${quoteCommitQueryValue(value)}`,
    description
  }));
}

function filterCommitSuggestions(suggestions: CommitQuerySuggestion[], typed: string): CommitQuerySuggestion[] {
  const needle = typed.replace(/^["']|["']$/g, "").toLowerCase();
  return suggestions.filter((suggestion) => suggestion.value.toLowerCase().includes(needle)).slice(0, 8);
}

function currentCommitQueryToken(query: string): string {
  const match = query.match(/\S+$/);
  return match ? match[0] : "";
}

export function applyCommitQuerySuggestion(query: string, suggestion: string): string {
  const match = query.match(/\S+$/);
  const start = match?.index ?? query.length;
  const prefix = query.slice(0, start);
  return `${prefix}${suggestion}${suggestion.endsWith(":") ? "" : " "}`;
}

function quoteCommitQueryValue(value: string): string {
  return /\s/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

export function uniqueCommitFilterValues(values: Array<string | null | undefined>, limit: number): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized.toLowerCase())) continue;
    seen.add(normalized.toLowerCase());
    unique.push(normalized);
    if (unique.length >= limit) break;
  }
  return unique;
}

export type CommitListItem = RepoCommitSummary &
  Pick<CommitSearchHit, "repoId" | "repoFullName" | "authorEmail" | "source" | "matchedPath">;

export function commitToListItem(commit: RepoCommitSummary): CommitListItem {
  return {
    ...commit,
    repoId: "",
    repoFullName: "",
    authorEmail: null,
    source: "git",
    matchedPath: null
  };
}

export function commitGraphNodeToListItem(node: CommitGraphNode, repo: WatchedRepo): CommitListItem {
  return {
    sha: node.sha,
    message: node.message,
    authorLogin: null,
    authorName: node.authorName,
    authorEmail: node.authorEmail,
    committedAt: node.committedAt,
    htmlUrl: node.htmlUrl,
    verified: false,
    repoId: repo.id,
    repoFullName: repo.fullName,
    source: "git",
    matchedPath: null
  };
}

export function commitSearchHasFilters(input: CommitSearchInput): boolean {
  return Boolean(input.message || input.author || input.sha || input.after || input.before || input.ref || input.path);
}

export function formatCommitSearchSummary(input: CommitSearchInput): string {
  return [
    input.message ? `message:${quoteCommitQueryValue(input.message)}` : null,
    input.author ? `author:${quoteCommitQueryValue(input.author)}` : null,
    input.sha ? `sha:${input.sha}` : null,
    input.ref ? `branch:${quoteCommitQueryValue(input.ref)}` : null,
    input.path ? `path:${quoteCommitQueryValue(input.path)}` : null,
    input.after ? `after:${quoteCommitQueryValue(input.after)}` : null,
    input.before ? `before:${quoteCommitQueryValue(input.before)}` : null
  ]
    .filter(Boolean)
    .join(" ");
}

export function commitGraphNodeMatches(node: CommitGraphNode, input: CommitSearchInput): boolean {
  const message = input.message?.trim().toLowerCase();
  if (message && !node.message.toLowerCase().includes(message)) return false;
  const sha = input.sha?.trim().toLowerCase();
  if (sha && !node.sha.toLowerCase().startsWith(sha)) return false;
  const author = input.author?.trim().toLowerCase();
  if (author && ![node.authorName, node.authorEmail].some((value) => value?.toLowerCase().includes(author))) return false;
  const ref = input.ref?.trim().toLowerCase();
  if (ref && !node.refs.some((item) => item.name.toLowerCase().includes(ref) || item.fullName.toLowerCase().includes(ref))) return false;
  const path = input.path?.trim().toLowerCase();
  if (path && !node.files.some((file) => file.path.toLowerCase().includes(path) || file.previousPath?.toLowerCase().includes(path))) {
    return false;
  }
  if (input.after && node.committedAt && new Date(node.committedAt).getTime() < new Date(input.after).getTime()) return false;
  if (input.before && node.committedAt && new Date(node.committedAt).getTime() > new Date(`${input.before}T23:59:59`).getTime())
    return false;
  return true;
}

export function commitGraphStatusCopy(fetching: boolean, graph: CommitGraphViewModel | null, hasSearch: boolean, count: number): string {
  if (fetching && !graph) return "Loading local commit graph...";
  if (!graph) return "Commit graph is ready when local Git history is available.";
  if (hasSearch && count === 0) return "No graph commits matched those filters.";
  if (hasSearch) return `${count} graph commits matched those filters.`;
  return graph.message;
}

export function commitSearchStatusCopy(
  hasSearch: boolean,
  fetching: boolean,
  result: CommitSearchResult | null,
  repo: WatchedRepo,
  count: number
): string {
  if (!hasSearch)
    return repo.localPath ? "Filter local commit history." : "Search uses cached GitHub commit metadata until the repo is cloned.";
  if (fetching && !result) return "Searching local history...";
  if (!result) return "Commit filters are ready.";
  if (result.status === "timeout" || result.status === "not_cloned" || result.status === "error") return result.message;
  if (count === 0) return "No commits matched those filters.";
  return result.message;
}
