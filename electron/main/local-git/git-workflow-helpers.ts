import fs from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { WatchedRepo } from "../../../src/shared/domain/watched-repo.js";
import type {
  CommitTemplate,
  LocalFileBlameLine,
  LocalFileHistoryEntry,
  LocalChangesState,
  LocalStashDetail,
  LocalStashEntry
} from "../../../src/shared/domain/local-git.js";
import { assertGitBranchName, assertGitRemoteName } from "../git-input-validation.js";
import { gitRaw, gitText } from "../git-command.js";
import { inspectRepoPath } from "../repo-path-safety.js";
import { generatedPath } from "./local-file-preview.js";
import { mergeStats, parseNameStatus, parseNumstat } from "./git-status-parser.js";
import type { StatusEntry } from "./git-status-parser.js";
export {
  LocalGitConflictError,
  changedPathsForRef,
  conflictFileHint,
  conflictFileStatus,
  conflictOperationLabel,
  conflictOperationTouchesWorktree,
  conflictPreflightCacheKey,
  conflictRiskLevel,
  conflictRiskSummary,
  conflictSafeAlternatives,
  conflictStateKind,
  conflictStatusByPath,
  conflictTargetRef,
  emptyConflictState,
  fileLooksBinary,
  fileLooksRisky,
  gitPathExists,
  isConflictErrorMessage,
  operationLabel,
  uniqueStrings,
  unmergedConflictFiles
} from "./git-conflict-helpers.js";
export {
  LocalGitNetworkError,
  aheadBehind,
  classifyGitNetworkError,
  credentialPreflightSummary,
  firstRemote,
  gitIdentityLabel,
  gitNetworkPreflightFingerprint,
  gitNetworkStatus,
  gitNetworkStatusMessage,
  networkStatusNeedsDiagnostics,
  normalizeBranchMergeRef,
  pullStrategyArgs,
  redactRemoteUrl,
  remoteProtocol,
  stringHash,
  upstreamBranchFromRef,
  upstreamRemoteFromRef
} from "./git-network-helpers.js";

export {
  binaryBuffer,
  dataUrl,
  generatedPath,
  gitObjectBuffer,
  gitObjectHeaderBuffer,
  gitObjectSize,
  imageMime,
  lfsPointer,
  localChangeFilePreview,
  localChangePreviewMaxBytes,
  localChangePreviewSampleBytes,
  previewMessage,
  previewState
} from "./local-file-preview.js";
export {
  disposeLocalGitParserWorker,
  gitExitCode,
  gitNumstat,
  gitRawWithInput,
  gitStatus,
  mergeStats,
  nameStatusKind,
  normalizeNumstatPath,
  parseGitNumstat,
  parseGitStatus,
  parseNameStatus,
  parseNumstat,
  statusKind
} from "./git-status-parser.js";
export type { NumstatEntry, StatusEntry } from "./git-status-parser.js";

export const untrackedPatchMaxBytes = 256_000;
export const untrackedLineCountMaxFiles = 200;

export interface LocalChangesSummaryOptions {
  includeStats?: boolean;
}

export interface GitCommandOptions {
  signal?: AbortSignal;
}

export interface LocalGitRecoverySnapshotOptions {
  operationId?: string;
  operationKind?: string;
  createSafetyRef?: boolean;
  safetyTargetRef?: string | null;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function remotePruneFetchCacheKey(repoId: string, remote: string): string {
  return `${repoId}:${remote.trim() || "origin"}`;
}

export function fallbackSafetyRefsFetchCacheKey(repoId: string, remote: string): string {
  return `${repoId}:${remote.trim() || "origin"}`;
}

export function isClonedLocalRepo(repo: WatchedRepo): repo is WatchedRepo & { localPath: string } {
  return Boolean(repo.localPath && fs.existsSync(path.join(repo.localPath, ".git")));
}

export function emptyLocalChangesState(repo: Pick<WatchedRepo, "id" | "defaultBranch">): LocalChangesState {
  return {
    repoId: repo.id,
    branch: repo.defaultBranch || "HEAD",
    isDirty: false,
    files: [],
    additions: 0,
    deletions: 0,
    patch: "",
    stashes: []
  };
}

export async function untrackedFilePatches(cwd: string, entries: StatusEntry[]): Promise<string[]> {
  const patches: string[] = [];
  for (const entry of entries.filter((item) => item.status === "untracked")) {
    const patch = await untrackedFilePatch(cwd, entry);
    if (patch.trim()) patches.push(patch);
  }
  return patches;
}

export async function untrackedFilePatch(cwd: string, entry: StatusEntry): Promise<string> {
  const inspectedPath = inspectRepoPath(cwd, entry.path);
  if (inspectedPath.kind !== "file" || inspectedPath.stat.size > untrackedPatchMaxBytes || generatedPath(entry.path)) return "";
  return gitRaw(cwd, ["diff", "--no-index", "--", "/dev/null", entry.path], 30_000, [0, 1]).catch(() => "");
}

export function untrackedLineCounts(cwd: string, entries: StatusEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries.filter((item) => item.status === "untracked").slice(0, untrackedLineCountMaxFiles)) {
    if (generatedPath(entry.path)) continue;
    const inspectedPath = inspectRepoPath(cwd, entry.path);
    if (inspectedPath.kind !== "file" || inspectedPath.stat.size > untrackedPatchMaxBytes) continue;
    const contents = fs.readFileSync(inspectedPath.absolutePath);
    if (contents.includes(0)) continue;
    const text = contents.toString("utf8");
    counts.set(entry.path, text.length === 0 ? 0 : text.replace(/\n$/, "").split("\n").length);
  }
  return counts;
}

export function logLocalGitTiming(name: string, startedAt: number, context: Record<string, string | number | null | undefined> = {}): void {
  const durationMs = performance.now() - startedAt;
  if (durationMs < 250 && process.env.FALLBACK_PERF_SMOKE !== "1") return;
  const contextCopy = Object.entries(context)
    .filter((entry): entry is [string, string | number] => entry[1] !== null && entry[1] !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  console.info(`[perf] local git ${name}: ${Math.round(durationMs)}ms${contextCopy ? ` ${contextCopy}` : ""}`);
}

export async function fileHistoryEntries(cwd: string, filePath: string): Promise<LocalFileHistoryEntry[]> {
  const stdout = await gitRaw(
    cwd,
    ["log", "--follow", "--date=iso-strict", "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s", "--", filePath],
    60_000
  );
  return stdout
    .split("\n")
    .filter(Boolean)
    .slice(0, 100)
    .map((line) => {
      const [sha, shortShaValue, authorName, authorEmail, authoredAt, ...subjectParts] = line.split("\x1f");
      return {
        sha: sha ?? "",
        shortSha: shortShaValue ?? (sha ? sha.slice(0, 7) : ""),
        authorName: authorName || null,
        authorEmail: authorEmail || null,
        authoredAt: authoredAt || null,
        subject: subjectParts.join("\x1f") || "(no subject)"
      };
    });
}

export function parseBlamePorcelain(stdout: string): LocalFileBlameLine[] {
  const lines: LocalFileBlameLine[] = [];
  let current: Omit<LocalFileBlameLine, "lineNumber" | "content"> | null = null;
  let pendingLineNumber = 0;
  for (const row of stdout.split("\n")) {
    const header = row.match(/^([0-9a-f]{40}) \d+ (\d+)/);
    if (header) {
      current = {
        sha: header[1] ?? "",
        shortSha: (header[1] ?? "").slice(0, 7),
        authorName: null,
        authorEmail: null,
        authoredAt: null,
        summary: null
      };
      pendingLineNumber = Number(header[2]) || lines.length + 1;
      continue;
    }
    if (!current) continue;
    if (row.startsWith("author ")) current.authorName = row.slice("author ".length) || null;
    else if (row.startsWith("author-mail ")) current.authorEmail = row.slice("author-mail ".length).replace(/^<|>$/g, "") || null;
    else if (row.startsWith("author-time ")) {
      const seconds = Number(row.slice("author-time ".length));
      current.authoredAt = Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
    } else if (row.startsWith("summary ")) current.summary = row.slice("summary ".length) || null;
    else if (row.startsWith("\t")) {
      lines.push({ ...current, lineNumber: pendingLineNumber, content: row.slice(1) });
      current = null;
    }
  }
  return lines;
}

export async function gitStashes(cwd: string): Promise<LocalStashEntry[]> {
  const stdout = await gitRaw(cwd, ["stash", "list", "--format=%gd%x1f%s%x1f%cI"]);
  const rows = stdout.split("\n").filter(Boolean).slice(0, 20);
  return Promise.all(
    rows.map(async (row) => {
      const [ref, message, date] = row.split("\x1f");
      const names = await gitRaw(cwd, ["stash", "show", "--include-untracked", "--name-only", ref]).catch(() => "");
      return {
        ref,
        message: message ?? "",
        date: date || null,
        files: names.split("\n").filter(Boolean).length
      };
    })
  );
}

export async function stashShaRefs(cwd: string): Promise<Map<string, string>> {
  const stdout = await gitRaw(cwd, ["stash", "list", "--format=%H%x1f%gd"]).catch(() => "");
  const refs = new Map<string, string>();
  for (const row of stdout.split("\n").filter(Boolean)) {
    const [sha, ref] = row.split("\x1f");
    if (sha && ref) refs.set(sha, ref);
  }
  return refs;
}

export function createdStashRef(before: Map<string, string>, after: Map<string, string>): string | null {
  for (const [sha, ref] of after) {
    if (!before.has(sha)) return ref;
  }
  return null;
}

export async function stashDetail(cwd: string, ref: string): Promise<LocalStashDetail> {
  const [sha, subject, date, baseSha, baseMessage, nameStatus, numstat, patch] = await Promise.all([
    gitText(cwd, ["rev-parse", ref]),
    gitText(cwd, ["show", "-s", "--format=%s", ref]),
    gitText(cwd, ["show", "-s", "--format=%cI", ref]).catch(() => ""),
    gitText(cwd, ["rev-parse", "--short", `${ref}^1`]).catch(() => null),
    gitText(cwd, ["show", "-s", "--format=%s", `${ref}^1`]).catch(() => null),
    gitRaw(cwd, ["stash", "show", "--include-untracked", "--name-status", ref]).catch(() => ""),
    gitRaw(cwd, ["stash", "show", "--include-untracked", "--numstat", ref]).catch(() => ""),
    gitRaw(cwd, ["stash", "show", "--include-untracked", "--patch", "--find-renames", ref], 120_000).catch(() => "")
  ]);
  const stats = mergeStats(parseNumstat(numstat));
  const files = parseNameStatus(nameStatus).map((file) => {
    const totals = stats.get(file.path) ?? { additions: 0, deletions: 0 };
    return { ...file, additions: totals.additions, deletions: totals.deletions };
  });
  const parsed = parseStashSubject(subject);
  return {
    ref,
    sha,
    branch: parsed.branch,
    baseSha,
    baseMessage,
    date: date || null,
    message: parsed.message || subject,
    files,
    patch
  };
}

export function parseStashSubject(subject: string): { branch: string | null; message: string } {
  const wip = subject.match(/^WIP on ([^:]+): [0-9a-f]+ (.*)$/i);
  if (wip) return { branch: wip[1] ?? null, message: wip[2] ?? subject };
  const onBranch = subject.match(/^On ([^:]+): (.*)$/i);
  if (onBranch) return { branch: onBranch[1] ?? null, message: onBranch[2] ?? subject };
  return { branch: null, message: subject };
}

export async function gitCommitTemplate(localPath: string): Promise<CommitTemplate | null> {
  const configuredPath = await gitText(localPath, ["config", "--get", "commit.template"]).catch(() => null);
  if (!configuredPath) return null;
  const resolvedPath = resolveGitTemplatePath(configuredPath, localPath);
  const body = await readFile(resolvedPath, "utf8");
  return {
    id: `git:${resolvedPath}`,
    name: "Git commit.template",
    body: body.slice(0, 128 * 1024),
    source: "git",
    scope: "repo",
    path: resolvedPath,
    repoId: null
  };
}

export function resolveGitTemplatePath(configuredPath: string, localPath: string): string {
  const trimmed = configuredPath.trim();
  if (trimmed.startsWith("~/")) return path.join(homedir(), trimmed.slice(2));
  if (path.isAbsolute(trimmed)) return trimmed;
  return path.resolve(localPath, trimmed);
}

export async function stashRefForSha(cwd: string, sha: string): Promise<string | null> {
  const stdout = await gitRaw(cwd, ["stash", "list", "--format=%gd%x1f%H"]).catch(() => "");
  for (const row of stdout.split("\n").filter(Boolean)) {
    const [ref, fullSha] = row.split("\x1f");
    if (fullSha === sha) return ref ?? null;
  }
  return null;
}

export function cleanRepoPath(value: string): string {
  const clean = value.trim();
  if (!clean || path.isAbsolute(clean) || clean.split(/[\\/]/).includes("..")) throw new Error("Invalid file path.");
  return clean;
}

export function uniqueCleanRepoPaths(paths: string[]): string[] {
  return [...new Set(paths.map(cleanRepoPath))];
}

export function cleanCommitSha(value: string): string {
  const clean = value.trim();
  if (!/^[0-9a-f]{7,40}$/i.test(clean)) throw new Error("Invalid commit SHA.");
  return clean;
}

export async function cleanExistingRemote(cwd: string, value: string): Promise<string> {
  const clean = assertGitRemoteName(value, "Git remote");
  const remotes = new Set(
    (await gitRaw(cwd, ["remote"], 30_000).catch(() => ""))
      .split("\n")
      .map((remote) => remote.trim())
      .filter(Boolean)
  );
  if (!remotes.has(clean)) throw new Error(`Git remote is not configured for this repository: ${clean}`);
  return clean;
}

export async function cleanBranchName(cwd: string, value: string): Promise<string> {
  const clean = assertGitBranchName(value, "Branch name");
  await gitRaw(cwd, ["check-ref-format", "--branch", clean], 30_000, [0]).catch(() => {
    throw new Error("Invalid branch name.");
  });
  return clean;
}

export function pixelSignatureTrailer(mode: string | null | undefined, digest: string | null | undefined): string | null {
  if (mode !== "pixel") return null;
  const cleanDigest = (digest ?? "").trim().replace(/^sha256:/i, "");
  if (!/^[0-9a-f]{64}$/i.test(cleanDigest)) return null;
  return `Pixel-Signature-SHA256: ${cleanDigest.toLowerCase()}`;
}

export function cleanStashRef(value: string): string {
  const clean = value.trim();
  if (!/^stash@\{\d+\}$/.test(clean)) throw new Error("Invalid stash reference.");
  return clean;
}
