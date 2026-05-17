export type LocalPatchLineType = "context" | "addition" | "deletion" | "metadata";

export interface LocalPatchChangedLine {
  id: string;
  hunkId: string;
  rawLineIndex: number;
  type: Exclude<LocalPatchLineType, "context" | "metadata">;
  oldLine: number | null;
  newLine: number | null;
  content: string;
}

export interface LocalPatchHunk {
  id: string;
  filePath: string;
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
  changedLines: LocalPatchChangedLine[];
}

export interface LocalPatchFile {
  path: string;
  previousPath: string | null;
  headerLines: string[];
  hunks: LocalPatchHunk[];
  isBinary: boolean;
  isImage: boolean;
  isLfsPointer: boolean;
  isGenerated: boolean;
  isTooLarge: boolean;
}

export type LocalSelectedLinePatchMode = "forward" | "reverse";

const hunkHeaderPattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const imageExtensionPattern = /\.(avif|bmp|gif|jpe?g|png|webp)$/i;
const generatedPathPattern =
  /(^|\/)(dist|build|coverage|vendor|node_modules|generated)(\/|$)|(\.min\.(js|css)$)|(^|\/)package-lock\.json$/i;

export function parseLocalPatch(patch: string): LocalPatchFile[] {
  const lines = patch.replaceAll("\r\n", "\n").replace(/\n$/, "").split("\n");
  const files: LocalPatchFile[] = [];
  let current: LocalPatchFile | null = null;
  let currentHunk: LocalPatchHunk | null = null;

  const finishHunk = () => {
    if (!current || !currentHunk) return;
    current.hunks.push(currentHunk);
    currentHunk = null;
  };
  const finishFile = () => {
    finishHunk();
    if (current) files.push(current);
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      finishFile();
      const { previousPath, path } = parseDiffGitLine(line);
      current = {
        path,
        previousPath,
        headerLines: [line],
        hunks: [],
        isBinary: false,
        isImage: imageExtensionPattern.test(path),
        isLfsPointer: false,
        isGenerated: generatedPathPattern.test(path),
        isTooLarge: patch.length > 512_000
      };
      continue;
    }
    if (!current) continue;

    const hunkMatch = line.match(hunkHeaderPattern);
    if (hunkMatch) {
      finishHunk();
      currentHunk = {
        id: `${current.path}:hunk:${current.hunks.length}`,
        filePath: current.path,
        header: line,
        oldStart: Number(hunkMatch[1]),
        oldLines: Number(hunkMatch[2] ?? "1"),
        newStart: Number(hunkMatch[3]),
        newLines: Number(hunkMatch[4] ?? "1"),
        lines: [],
        changedLines: []
      };
      continue;
    }

    if (currentHunk) {
      currentHunk.lines.push(line);
      continue;
    }

    current.headerLines.push(line);
    if (/^Binary files /.test(line) || /^GIT binary patch/.test(line)) current.isBinary = true;
    if (line.includes("version https://git-lfs.github.com/spec/v1")) current.isLfsPointer = true;
  }
  finishFile();

  for (const file of files) {
    for (const hunk of file.hunks) annotateHunkLines(hunk);
  }
  return files;
}

export function hunkPatch(file: LocalPatchFile, hunkId: string): string | null {
  const hunk = file.hunks.find((item) => item.id === hunkId);
  if (!hunk) return null;
  return patchText(file.headerLines, hunk.header, hunk.lines);
}

export function selectedLinesPatch(
  file: LocalPatchFile,
  lineIds: string[],
  options: { applyMode?: LocalSelectedLinePatchMode } = {}
): string | null {
  const selected = new Set(lineIds);
  const applyMode = options.applyMode ?? "forward";
  const hunks = file.hunks
    .map((hunk) => selectedLinesHunkPatch(hunk, selected, applyMode))
    .filter((hunk): hunk is { header: string; lines: string[] } => Boolean(hunk));
  if (hunks.length === 0) return null;
  return [file.headerLines.join("\n"), ...hunks.flatMap((hunk) => [hunk.header, ...hunk.lines])].join("\n").replace(/\n?$/, "\n");
}

export function patchForPath(patch: string, filePath: string): LocalPatchFile | null {
  return parseLocalPatch(patch).find((file) => file.path === filePath || file.previousPath === filePath) ?? null;
}

function selectedLinesHunkPatch(
  hunk: LocalPatchHunk,
  selected: Set<string>,
  applyMode: LocalSelectedLinePatchMode
): { header: string; lines: string[] } | null {
  if (!hunk.changedLines.some((line) => selected.has(line.id))) return null;
  const outputLines: string[] = [];
  for (const [rawLineIndex, line] of hunk.lines.entries()) {
    if (line.startsWith("+")) {
      const changed = hunk.changedLines.find((item) => item.rawLineIndex === rawLineIndex && selected.has(item.id));
      if (changed) outputLines.push(line);
      else if (applyMode === "reverse") outputLines.push(` ${line.slice(1)}`);
      continue;
    }
    if (line.startsWith("-")) {
      const changed = hunk.changedLines.find((item) => item.rawLineIndex === rawLineIndex && selected.has(item.id));
      if (changed) outputLines.push(line);
      else if (applyMode === "forward") outputLines.push(` ${line.slice(1)}`);
      continue;
    }
    outputLines.push(line);
  }
  const oldLines = outputLines.filter((line) => !line.startsWith("+")).length;
  const newLines = outputLines.filter((line) => !line.startsWith("-")).length;
  return {
    header: `@@ -${hunk.oldStart},${oldLines} +${hunk.newStart},${newLines} @@`,
    lines: outputLines
  };
}

function annotateHunkLines(hunk: LocalPatchHunk): void {
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  for (const [index, line] of hunk.lines.entries()) {
    if (line.startsWith("+")) {
      hunk.changedLines.push({
        id: `${hunk.id}:line:${index}`,
        hunkId: hunk.id,
        rawLineIndex: index,
        type: "addition",
        oldLine: null,
        newLine,
        content: line.slice(1)
      });
      newLine += 1;
      continue;
    }
    if (line.startsWith("-")) {
      hunk.changedLines.push({
        id: `${hunk.id}:line:${index}`,
        hunkId: hunk.id,
        rawLineIndex: index,
        type: "deletion",
        oldLine,
        newLine: null,
        content: line.slice(1)
      });
      oldLine += 1;
      continue;
    }
    if (line.startsWith(" ")) {
      oldLine += 1;
      newLine += 1;
    }
  }
}

function parseDiffGitLine(line: string): { previousPath: string | null; path: string } {
  const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
  if (!match) return { previousPath: null, path: "unknown" };
  const previousPath = unquoteGitPath(match[1] ?? "");
  const nextPath = unquoteGitPath(match[2] ?? previousPath);
  return { previousPath: previousPath === nextPath ? null : previousPath, path: nextPath };
}

function unquoteGitPath(value: string): string {
  return value.replace(/^"|"$/g, "");
}

function patchText(headerLines: string[], hunkHeader: string, hunkLines: string[]): string {
  return [...headerLines, hunkHeader, ...hunkLines].join("\n").replace(/\n?$/, "\n");
}
