import fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { WatchedRepo } from "../../../src/shared/domain/watched-repo.js";
import type {
  LocalGitConflictFile,
  LocalGitConflictFileStatus,
  LocalGitConflictOperation,
  LocalGitConflictPreflightInput,
  LocalGitConflictRiskLevel,
  LocalGitConflictState,
  LocalGitConflictStateKind
} from "../../../src/shared/domain/local-git.js";
import { gitRaw, gitText } from "../git-command.js";

export function conflictPreflightCacheKey(repoId: string, input: LocalGitConflictPreflightInput): string {
  return [repoId, input.operation, input.targetRef?.trim() ?? "", input.stashRef?.trim() ?? ""].join(":");
}

export function emptyConflictState(
  repo: WatchedRepo & { localPath: string },
  branch: string | null,
  headSha: string | null
): LocalGitConflictState {
  return {
    repoId: repo.id,
    repoFullName: repo.fullName,
    workspacePath: repo.localPath,
    branch,
    headSha,
    state: "none",
    isActive: false,
    operationLabel: conflictOperationLabel("none"),
    files: [],
    fileCount: 0,
    binaryCount: 0,
    lfsCount: 0,
    recoveryHint: "No active Git conflict.",
    generatedAt: new Date().toISOString()
  };
}

export class LocalGitConflictError extends Error {
  readonly fallbackCode: string;

  constructor(
    readonly status: "active_conflict" | "stash_conflict" | "merge_tool_failed",
    message: string
  ) {
    super(message);
    this.name = "LocalGitConflictError";
    this.fallbackCode = `git_conflict_${status}`;
  }
}

export function isConflictErrorMessage(message: string): boolean {
  return /CONFLICT|Automatic merge failed|unmerged files|fix conflicts|needs merge|could not apply/i.test(message);
}

export async function conflictTargetRef(cwd: string, input: LocalGitConflictPreflightInput): Promise<string | null> {
  if (input.targetRef?.trim()) return input.targetRef.trim();
  if (input.operation === "pull" || input.operation === "rebase") {
    return gitText(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).catch(() => null);
  }
  return null;
}

export async function changedPathsForRef(cwd: string, ref: string): Promise<Set<string>> {
  const mergeBase = await gitText(cwd, ["merge-base", "HEAD", ref]).catch(() => null);
  const range = mergeBase ? `${mergeBase}..${ref}` : `HEAD..${ref}`;
  const stdout = await gitRaw(cwd, ["diff", "--name-only", "-z", range]);
  return new Set(stdout.split("\0").filter(Boolean));
}

export async function conflictStateKind(cwd: string): Promise<LocalGitConflictStateKind> {
  const [mergeHead, rebaseMerge, rebaseApply, cherryPickHead, revertHead] = await Promise.all([
    gitPathExists(cwd, "MERGE_HEAD"),
    gitPathExists(cwd, "rebase-merge"),
    gitPathExists(cwd, "rebase-apply"),
    gitPathExists(cwd, "CHERRY_PICK_HEAD"),
    gitPathExists(cwd, "REVERT_HEAD")
  ]);
  if (rebaseMerge || rebaseApply) return "rebase";
  if (cherryPickHead) return "cherry_pick";
  if (revertHead) return "revert";
  if (mergeHead) return "merge";
  return "none";
}

export async function gitPathExists(cwd: string, gitPath: string): Promise<boolean> {
  const resolved = await gitText(cwd, ["rev-parse", "--git-path", gitPath]).catch(() => null);
  return Boolean(resolved && fs.existsSync(path.isAbsolute(resolved) ? resolved : path.join(cwd, resolved)));
}

export async function unmergedConflictFiles(cwd: string): Promise<Array<Omit<LocalGitConflictFile, "isBinary" | "isLfsPointer" | "cue">>> {
  const stdout = await gitRaw(cwd, ["ls-files", "-u", "-z"]).catch(() => "");
  const entries = stdout.split("\0").filter(Boolean);
  const stagesByPath = new Map<string, Set<number>>();
  for (const entry of entries) {
    const match = entry.match(/^\d+\s+[0-9a-f]+\s+(\d)\t(.+)$/i);
    if (!match) continue;
    const stage = Number(match[1]);
    const filePath = match[2] ?? "";
    if (!filePath) continue;
    const stages = stagesByPath.get(filePath) ?? new Set<number>();
    stages.add(stage);
    stagesByPath.set(filePath, stages);
  }
  const statusByPath = await conflictStatusByPath(cwd);
  return [...stagesByPath.entries()]
    .map(([filePath, stages]) => ({
      path: filePath,
      previousPath: null,
      status: conflictFileStatus(statusByPath.get(filePath), stages),
      stages: [...stages].sort((a, b) => a - b)
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function conflictStatusByPath(cwd: string): Promise<Map<string, string>> {
  const stdout = await gitRaw(cwd, ["status", "--porcelain=v1", "-z"]).catch(() => "");
  const parts = stdout.split("\0").filter(Boolean);
  const map = new Map<string, string>();
  for (const row of parts) {
    if (row.length < 4) continue;
    const code = row.slice(0, 2);
    const filePath = row.slice(3);
    if (/^(AA|DD|AU|UA|DU|UD|UU)$/.test(code)) map.set(filePath, code);
  }
  return map;
}

export function conflictFileStatus(code: string | undefined, stages: Set<number>): LocalGitConflictFileStatus {
  if (code === "UU") return "both_modified";
  if (code === "AA") return "both_added";
  if (code === "UD") return "deleted_by_them";
  if (code === "DU") return "deleted_by_us";
  if (code === "AU") return "added_by_us";
  if (code === "UA") return "added_by_them";
  if (stages.has(1) && stages.has(2) && stages.has(3)) return "both_modified";
  return "unmerged";
}

export async function conflictFileHint(
  cwd: string,
  filePath: string
): Promise<{ isBinary: boolean; isLfsPointer: boolean; cue: string | null }> {
  const absolutePath = path.join(cwd, filePath);
  const bytes = await readFile(absolutePath).catch(() => null);
  const isBinary = bytes ? bytes.subarray(0, 8192).includes(0) : fileLooksBinary(filePath);
  const text = bytes && !isBinary ? bytes.toString("utf8", 0, Math.min(bytes.length, 512)) : "";
  const isLfsPointer = /^version https:\/\/git-lfs.github.com\/spec\/v1\n/m.test(text);
  const cue = isLfsPointer
    ? "LFS pointer conflict. Prefer Git LFS tooling or an external merge tool."
    : isBinary
      ? "Binary conflict. Do not edit blindly; choose one side or use a binary-aware tool."
      : null;
  return { isBinary, isLfsPointer, cue };
}

export function conflictRiskLevel(input: {
  activeConflict: boolean;
  overlapCount: number;
  dirtyCount: number;
  binaryCount: number;
  lfsCount: number;
  diverged: boolean;
  operation: LocalGitConflictOperation;
}): LocalGitConflictRiskLevel {
  if (input.activeConflict || input.overlapCount > 0 || input.binaryCount > 0 || input.lfsCount > 0) return "high";
  if (input.diverged || (input.dirtyCount > 0 && conflictOperationTouchesWorktree(input.operation))) return "medium";
  if (input.dirtyCount > 0) return "low";
  return "none";
}

export function conflictRiskSummary(
  operation: LocalGitConflictOperation,
  riskLevel: LocalGitConflictRiskLevel,
  overlapCount: number,
  dirtyCount: number,
  targetRef: string | null,
  activeConflict: LocalGitConflictState
): string {
  if (activeConflict.isActive)
    return `${activeConflict.operationLabel} is already in progress with ${activeConflict.fileCount} conflicted files.`;
  if (overlapCount > 0)
    return `${operationLabel(operation)} may conflict: ${overlapCount} dirty files overlap ${targetRef ?? "the target"}.`;
  if (riskLevel === "medium") return `${operationLabel(operation)} has worktree risk with ${dirtyCount} dirty files.`;
  if (riskLevel === "low") return `${operationLabel(operation)} sees ${dirtyCount} dirty files but no direct overlap.`;
  return `${operationLabel(operation)} has no obvious conflict risk.`;
}

export function conflictSafeAlternatives(
  operation: LocalGitConflictOperation,
  input: { hasDirtyFiles: boolean; hasOverlap: boolean; activeConflict: boolean }
): string[] {
  if (input.activeConflict)
    return ["Open conflicted files", "Open external merge tool", "Abort the active Git operation", "Copy diagnostics"];
  const alternatives = ["Fetch first", "Open diff"];
  if (input.hasDirtyFiles) alternatives.unshift("Stash selected files");
  if (input.hasOverlap || operation === "branch_switch" || operation === "workspace_switch") alternatives.push("Create a worktree");
  alternatives.push("Abort");
  return alternatives;
}

export function operationLabel(operation: LocalGitConflictOperation): string {
  return operation.replaceAll("_", " ");
}

export function conflictOperationLabel(state: LocalGitConflictStateKind): string {
  if (state === "merge") return "Merge";
  if (state === "rebase") return "Rebase";
  if (state === "cherry_pick") return "Cherry-pick";
  if (state === "revert") return "Revert";
  return "No conflict";
}

export function conflictOperationTouchesWorktree(operation: LocalGitConflictOperation): boolean {
  return operation !== "stash_apply" && operation !== "stash_pop";
}

export function fileLooksRisky(filePath: string): boolean {
  return fileLooksBinary(filePath) || /\.(psd|ai|sketch|fig|zip|gz|pdf|png|jpe?g|gif|webp|mov|mp4|sqlite|db)$/i.test(filePath);
}

export function fileLooksBinary(filePath: string): boolean {
  return /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|7z|mov|mp4|mp3|wav|sqlite|db|lockb)$/i.test(filePath);
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
