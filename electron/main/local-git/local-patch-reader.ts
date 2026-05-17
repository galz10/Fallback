import type { LocalChangePatch, LocalFileBlame, LocalFileHistory } from "../../../src/shared/domain/local-git.js";
import { readFile } from "node:fs/promises";
import { gitRaw, gitText } from "../git-command.js";
import { inspectRepoPath } from "../repo-path-safety.js";
import { LocalGitWorkflowBase, type LocalGitWorkflowDependencies } from "./workflow-base.js";
import {
  cleanRepoPath,
  fileHistoryEntries,
  generatedPath,
  gitStatus,
  localChangeFilePreview,
  logLocalGitTiming,
  parseBlamePorcelain,
  untrackedFilePatch
} from "./git-workflow-helpers.js";

export class LocalPatchReader extends LocalGitWorkflowBase {
  constructor(deps: LocalGitWorkflowDependencies) {
    super(deps);
  }

  async changePatch(repoId: string, filePath: string): Promise<LocalChangePatch> {
    const startedAt = performance.now();
    const repo = this.requireLocalRepo(repoId);
    const cleanPath = cleanRepoPath(filePath);
    try {
      const statusEntries = await gitStatus(repo.localPath);
      const entry = statusEntries.find((item) => item.path === cleanPath || item.previousPath === cleanPath);
      if (!entry) {
        return {
          repoId,
          path: cleanPath,
          previousPath: null,
          patch: "",
          generatedAt: new Date().toISOString()
        };
      }

      const conflictPatch = await unmergedFilePatch(repo.localPath, entry.path);
      if (conflictPatch) {
        const preview = await localChangeFilePreview(repo.localPath, entry).catch((error) => ({
          kind: "permission_error" as const,
          path: entry.path,
          previousPath: entry.previousPath,
          mimeType: null,
          fileSize: null,
          isImage: false,
          isBinary: false,
          isLfsPointer: false,
          isGenerated: generatedPath(entry.path),
          isTooLarge: false,
          currentDataUrl: null,
          previousDataUrl: null,
          message: error instanceof Error ? error.message : "Could not load file preview."
        }));

        return {
          repoId,
          path: entry.path,
          previousPath: entry.previousPath,
          patch: conflictPatch.patch,
          stagedPatch: "",
          unstagedPatch: conflictPatch.patch,
          conflictContents: conflictPatch.contents,
          conflictMarkerCount: conflictPatch.markerCount,
          preview,
          generatedAt: new Date().toISOString()
        };
      }

      const [stagedPatch, unstagedPatch, preview] = await Promise.all([
        entry.status === "untracked"
          ? Promise.resolve("")
          : gitRaw(repo.localPath, ["diff", "--cached", "--patch", "--find-renames", "--", entry.path], 60_000).catch(() => ""),
        entry.status === "untracked"
          ? untrackedFilePatch(repo.localPath, entry)
          : gitRaw(repo.localPath, ["diff", "--patch", "--find-renames", "--", entry.path], 60_000).catch(() => ""),
        localChangeFilePreview(repo.localPath, entry).catch((error) => ({
          kind: "permission_error" as const,
          path: entry.path,
          previousPath: entry.previousPath,
          mimeType: null,
          fileSize: null,
          isImage: false,
          isBinary: false,
          isLfsPointer: false,
          isGenerated: generatedPath(entry.path),
          isTooLarge: false,
          currentDataUrl: null,
          previousDataUrl: null,
          message: error instanceof Error ? error.message : "Could not load file preview."
        }))
      ]);
      const patch = [stagedPatch, unstagedPatch].filter((part) => part.trim()).join("\n");

      return {
        repoId,
        path: entry.path,
        previousPath: entry.previousPath,
        patch,
        stagedPatch,
        unstagedPatch,
        preview,
        generatedAt: new Date().toISOString()
      };
    } finally {
      logLocalGitTiming("local-change-patch", startedAt, { repoId, path: cleanPath });
    }
  }

  async fileHistory(repoId: string, filePath: string): Promise<LocalFileHistory> {
    const startedAt = performance.now();
    const repo = this.requireLocalRepo(repoId);
    const cleanPath = cleanRepoPath(filePath);
    try {
      let historyPath = cleanPath;
      let entries = await fileHistoryEntries(repo.localPath, historyPath);
      if (entries.length === 0) {
        const statusEntry = (await gitStatus(repo.localPath).catch(() => [])).find((entry) => entry.path === cleanPath);
        if (statusEntry?.previousPath) {
          historyPath = statusEntry.previousPath;
          entries = await fileHistoryEntries(repo.localPath, historyPath);
        }
      }
      return {
        repoId,
        path: cleanPath,
        entries,
        renameCaveat:
          historyPath === cleanPath
            ? "History uses git log --follow and may miss complex rename or copy ancestry."
            : `History uses git log --follow from ${historyPath} because this rename is not committed yet.`,
        generatedAt: new Date().toISOString()
      };
    } finally {
      logLocalGitTiming("local-file-history", startedAt, { repoId, path: cleanPath });
    }
  }

  async fileBlame(repoId: string, filePath: string): Promise<LocalFileBlame> {
    const startedAt = performance.now();
    const repo = this.requireLocalRepo(repoId);
    const cleanPath = cleanRepoPath(filePath);
    try {
      const [branch, statusEntries] = await Promise.all([
        gitText(repo.localPath, ["branch", "--show-current"]).catch(() => repo.defaultBranch ?? null),
        gitStatus(repo.localPath).catch(() => [])
      ]);
      const statusEntry = statusEntries.find((entry) => entry.path === cleanPath);
      if (statusEntry && (statusEntry.status === "untracked" || (statusEntry.status === "added" && !statusEntry.previousPath))) {
        return {
          repoId,
          path: cleanPath,
          branch,
          lines: [],
          generatedAt: new Date().toISOString()
        };
      }
      const stdout = await gitRaw(repo.localPath, ["blame", "--line-porcelain", "--", cleanPath], 60_000).catch(async (error) => {
        if (!statusEntry?.previousPath) throw error;
        return gitRaw(repo.localPath, ["blame", "--line-porcelain", "--contents", cleanPath, "--", statusEntry.previousPath], 60_000);
      });
      return {
        repoId,
        path: cleanPath,
        branch,
        lines: parseBlamePorcelain(stdout).slice(0, 5_000),
        generatedAt: new Date().toISOString()
      };
    } finally {
      logLocalGitTiming("local-file-blame", startedAt, { repoId, path: cleanPath });
    }
  }
}

async function unmergedFilePatch(cwd: string, filePath: string): Promise<{ patch: string; contents: string; markerCount: number } | null> {
  const unmerged = await gitRaw(cwd, ["ls-files", "-u", "--", filePath]).catch(() => "");
  if (!unmerged.trim()) return null;

  const inspected = inspectRepoPath(cwd, filePath);
  if (inspected.kind !== "file") return null;

  const [ours, current] = await Promise.all([
    gitRaw(cwd, ["show", `:2:${filePath}`]).catch(() => ""),
    readFile(inspected.absolutePath, "utf8").catch(() => "")
  ]);
  const markerCount = conflictMarkerCount(current);
  if (markerCount === 0) return null;
  return { patch: unifiedPatch(filePath, ours, current), contents: current, markerCount };
}

function unifiedPatch(filePath: string, oldText: string, newText: string): string {
  const oldLines = splitPatchLines(oldText);
  const newLines = splitPatchLines(newText);
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const contextBefore = oldLines.slice(Math.max(0, prefix - 3), prefix);
  const contextAfter = oldLines.slice(oldLines.length - suffix, Math.min(oldLines.length, oldLines.length - suffix + 3));
  const oldChanged = oldLines.slice(prefix, oldLines.length - suffix);
  const newChanged = newLines.slice(prefix, newLines.length - suffix);
  const oldStart = Math.max(1, prefix - contextBefore.length + 1);
  const newStart = Math.max(1, prefix - contextBefore.length + 1);
  const oldCount = contextBefore.length + oldChanged.length + contextAfter.length;
  const newCount = contextBefore.length + newChanged.length + contextAfter.length;
  const hunkLines = [
    ...contextBefore.map((line) => ` ${line}`),
    ...oldChanged.map((line) => `-${line}`),
    ...newChanged.map((line) => `+${line}`),
    ...contextAfter.map((line) => ` ${line}`)
  ];

  return [
    `diff --git a/${filePath} b/${filePath}`,
    "index 0000000..0000000 100644",
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
    ...hunkLines
  ].join("\n");
}

function splitPatchLines(text: string): string[] {
  const normalized = text.replaceAll("\r\n", "\n");
  if (!normalized) return [];
  return normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
}

function conflictMarkerCount(contents: string): number {
  return contents.split(/\r?\n/).filter((line) => /^(<<<<<<<|=======|>>>>>>>)(?:\s|$)/.test(line)).length;
}
