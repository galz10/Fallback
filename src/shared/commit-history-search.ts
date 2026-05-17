import type { CommitSearchInput } from "./domain/repo-code.js";

const commitSearchPrefixes = new Set(["commit", "commits", "history", "log"]);
const commitSearchKeys = new Set([
  "author",
  "sha",
  "message",
  "msg",
  "after",
  "since",
  "before",
  "until",
  "branch",
  "ref",
  "path",
  "file",
  "limit"
]);
const gitLogFormat = "%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e";

export function isCommitSearchQuery(query: string): boolean {
  const [first] = tokenizeCommitSearch(query);
  if (!first) return false;
  if (commitSearchPrefixes.has(first.toLowerCase())) return true;
  const field = fieldName(first);
  return field ? commitSearchKeys.has(field) : false;
}

export function parseCommitSearchQuery(query: string): CommitSearchInput {
  const tokens = tokenizeCommitSearch(query);
  if (tokens[0] && commitSearchPrefixes.has(tokens[0].toLowerCase())) tokens.shift();

  const input: CommitSearchInput = {};
  const messageTerms: string[] = [];
  for (const token of tokens) {
    const separator = token.indexOf(":");
    const key = separator > 0 ? token.slice(0, separator).toLowerCase() : "";
    const value = separator > 0 ? stripCommitSearchQuotes(token.slice(separator + 1).trim()) : "";
    if (commitSearchKeys.has(key) && !value) {
      continue;
    }
    if (value && commitSearchKeys.has(key)) {
      assignCommitSearchField(input, key, value);
    } else {
      messageTerms.push(stripCommitSearchQuotes(token));
    }
  }

  if (!input.sha && messageTerms.length === 1 && /^[0-9a-f]{4,40}$/i.test(messageTerms[0] ?? "")) {
    input.sha = messageTerms[0];
  } else if (!input.message && messageTerms.length > 0) {
    input.message = messageTerms.join(" ");
  }
  return normalizeCommitSearchInput(input);
}

export function normalizeCommitSearchInput(input: CommitSearchInput): CommitSearchInput {
  return {
    ...(cleanText(input.message) ? { message: cleanText(input.message) } : {}),
    ...(cleanText(input.author) ? { author: cleanText(input.author) } : {}),
    ...(cleanSha(input.sha) ? { sha: cleanSha(input.sha) } : {}),
    ...(cleanCommitDate(input.after) ? { after: cleanCommitDate(input.after) } : {}),
    ...(cleanCommitDate(input.before) ? { before: cleanCommitDate(input.before) } : {}),
    ...(cleanRef(input.ref) ? { ref: cleanRef(input.ref) } : {}),
    ...(cleanRepoPath(input.path) ? { path: cleanRepoPath(input.path) } : {}),
    limit: clampNumber(input.limit, 50, 1, 200),
    timeoutMs: clampNumber(input.timeoutMs, 12_000, 1_000, 30_000),
    ...(cleanRequestId(input.requestId) ? { requestId: cleanRequestId(input.requestId) } : {})
  };
}

export function buildCommitSearchGitLogArgs(input: CommitSearchInput): string[] {
  const search = normalizeCommitSearchInput(input);
  const args = ["log", "--date=iso-strict", `--max-count=${search.limit ?? 50}`, `--format=${gitLogFormat}`];
  if (search.message) args.push("--regexp-ignore-case", `--grep=${search.message}`);
  if (search.author) args.push(`--author=${search.author}`);
  if (search.after) args.push(`--since=${search.after}`);
  if (search.before) args.push(`--until=${search.before}`);
  args.push(search.ref ?? "--all");
  if (search.path) args.push("--", search.path);
  return args;
}

export function tokenizeCommitSearch(query: string): string[] {
  const tokens: string[] = [];
  const pattern = /(?:[^\s"']+:"[^"]*"|[^\s"']+:'[^']*'|"[^"]*"|'[^']*'|\S+)/g;
  for (const match of query.matchAll(pattern)) tokens.push(match[0] ?? "");
  return tokens;
}

function assignCommitSearchField(input: CommitSearchInput, key: string, value: string): void {
  if (key === "author") input.author = value;
  else if (key === "sha") input.sha = value;
  else if (key === "message" || key === "msg") input.message = value;
  else if (key === "after" || key === "since") input.after = value;
  else if (key === "before" || key === "until") input.before = value;
  else if (key === "branch" || key === "ref") input.ref = value;
  else if (key === "path" || key === "file") input.path = value;
  else if (key === "limit") input.limit = Number(value);
}

function fieldName(token: string): string | null {
  const separator = token.indexOf(":");
  return separator > 0 ? token.slice(0, separator).toLowerCase() : null;
}

function stripCommitSearchQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "").replace(/(:)["'](.*)["']$/, "$1$2");
}

function cleanText(value: string | null | undefined): string | undefined {
  const clean = value?.trim();
  return clean || undefined;
}

function cleanCommitDate(value: string | null | undefined): string | undefined {
  const clean = cleanText(value);
  if (!clean) return undefined;
  const slashDate = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!slashDate) return clean;

  const month = Number(slashDate[1]);
  const day = Number(slashDate[2]);
  const rawYear = slashDate[3] ?? "";
  const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
  if (!Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(year)) return clean;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return clean;
  return date.toISOString().slice(0, 10);
}

function cleanSha(value: string | null | undefined): string | undefined {
  const clean = value?.trim();
  if (!clean) return undefined;
  return /^[0-9a-f]{4,40}$/i.test(clean) ? clean : undefined;
}

function cleanRef(value: string | null | undefined): string | undefined {
  const clean = value?.trim();
  if (!clean || clean.startsWith("-") || clean.includes("..") || clean.includes("\0")) return undefined;
  return clean;
}

function cleanRepoPath(value: string | null | undefined): string | undefined {
  const clean = value?.trim().replace(/\\/g, "/");
  if (!clean || clean.startsWith("/") || clean.split("/").includes("..") || clean.includes("\0")) return undefined;
  return clean;
}

function cleanRequestId(value: string | null | undefined): string | undefined {
  const clean = value?.trim();
  return clean && clean.length <= 240 && !clean.includes("\0") ? clean : undefined;
}

function clampNumber(value: number | null | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(Number(value))));
}
