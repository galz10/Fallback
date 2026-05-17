import type { FileDiffMetadata } from "@pierre/diffs";
import { parsePatchFiles } from "@pierre/diffs";

export interface PatchFileView {
  id: string;
  path: string;
  previousPath: string | null;
  fileDiff: FileDiffMetadata | null;
  rawPatch: string | null;
  name: string;
  directory: string;
  additions: number;
  deletions: number;
  type: string;
}

export function parsePatchFilesForView(patch: string, cacheKeyPrefix: string): PatchFileView[] {
  const trimmedPatch = patch.trim();
  if (!trimmedPatch) return [];

  try {
    const parsedPatches = parsePatchFiles(trimmedPatch, cacheKeyPrefix, true);
    const files = parsedPatches.flatMap((parsedPatch, patchIndex) =>
      parsedPatch.files.map((fileDiff, fileIndex) => createPatchFileView(fileDiff, patchIndex, fileIndex))
    );
    return consolidatePatchFileViews(files);
  } catch {
    return [
      {
        id: `${cacheKeyPrefix}:raw`,
        path: "Unparsed patch",
        previousPath: null,
        fileDiff: null,
        rawPatch: trimmedPatch,
        name: "Unparsed patch",
        directory: "",
        additions: 0,
        deletions: 0,
        type: "unknown"
      }
    ];
  }
}

function createPatchFileView(fileDiff: FileDiffMetadata, patchIndex: number, fileIndex: number): PatchFileView {
  const fullPath = fileDiff.name || `Changed file ${fileIndex + 1}`;
  const lastSlash = fullPath.lastIndexOf("/");
  const { additions, deletions } = countChangedLines(fileDiff);
  return {
    id: `${fullPath}:${fileDiff.prevName ?? ""}:${patchIndex}:${fileIndex}`,
    path: fullPath,
    previousPath: fileDiff.prevName ?? null,
    fileDiff,
    rawPatch: null,
    name: lastSlash >= 0 ? fullPath.slice(lastSlash + 1) : fullPath,
    directory: lastSlash >= 0 ? fullPath.slice(0, lastSlash + 1) : "",
    additions,
    deletions,
    type: fileDiff.type
  };
}

function countChangedLines(fileDiff: FileDiffMetadata): { additions: number; deletions: number } {
  return fileDiff.hunks.reduce(
    (totals, hunk) => {
      for (const content of hunk.hunkContent) {
        if (content.type !== "change") continue;
        totals.additions += content.additions;
        totals.deletions += content.deletions;
      }
      return totals;
    },
    { additions: 0, deletions: 0 }
  );
}

function consolidatePatchFileViews(files: PatchFileView[]): PatchFileView[] {
  const grouped = new Map<string, PatchFileView>();
  for (const file of files) {
    const key = `${file.previousPath ?? ""}->${file.path}`;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, { ...file, id: key });
      continue;
    }

    grouped.set(key, {
      ...current,
      additions: current.additions + file.additions,
      deletions: current.deletions + file.deletions,
      fileDiff:
        current.fileDiff && file.fileDiff
          ? {
              ...current.fileDiff,
              hunks: [...current.fileDiff.hunks, ...file.fileDiff.hunks],
              splitLineCount: current.fileDiff.splitLineCount + file.fileDiff.splitLineCount,
              unifiedLineCount: current.fileDiff.unifiedLineCount + file.fileDiff.unifiedLineCount,
              cacheKey:
                current.fileDiff.cacheKey && file.fileDiff.cacheKey
                  ? `${current.fileDiff.cacheKey}:${file.fileDiff.cacheKey}`
                  : current.fileDiff.cacheKey
            }
          : (current.fileDiff ?? file.fileDiff),
      rawPatch: current.rawPatch ?? file.rawPatch
    });
  }
  return [...grouped.values()];
}
