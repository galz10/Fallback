import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SelectedLineRange } from "@pierre/diffs";
import { Copy, ExternalLink } from "lucide-react";
import { AlertIcon as GitHubAlertIcon, DownloadIcon as GitHubDownloadIcon } from "@primer/octicons-react";
import type { WatchedRepo } from "../../../shared/domain/watched-repo";
import { CacheTimestamp } from "../../components/CacheTimestamp";
import { Button as UiButton, EmptyState, Input as UiInput, Surface, Toolbar } from "../../components/ui";
import { DiffsCodeShell } from "../../diffs/DiffShell";
import { DiffsFile } from "../../diffs/lazy-diffs";
import { diffsFileOptions } from "../../diffs/options";
import { formatBytes } from "../../lib/format";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function FileContentView({ repo, filePath, onBack }: { repo: WatchedRepo; filePath: string; onBack: () => void }) {
  const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null>(null);
  const [lineJump, setLineJump] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const {
    data: file,
    isFetching,
    error,
    refetch
  } = useQuery({
    queryKey: ["repoFileContent", repo.id, filePath],
    queryFn: () => window.fallback.repos.readFile(repo.id, filePath),
    staleTime: 60_000
  });
  const fileForDiffs = useMemo(
    () =>
      file && !file.isBinary && file.contents != null
        ? {
            name: file.path,
            contents: file.contents,
            cacheKey: `${repo.id}:${file.path}:${file.sha ?? file.size ?? file.cachedAt ?? ""}`
          }
        : null,
    [file, repo.id]
  );
  const fileLineCount = file?.contents?.split("\n").length ?? 0;
  const fileViewerOptions = useMemo(
    () => ({
      ...diffsFileOptions,
      onLineSelected: setSelectedLines
    }),
    []
  );
  const copyText = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setNotice(`${label} copied`);
  };
  const copySelectedLines = async () => {
    if (!file?.contents || !selectedLines) return;
    const start = Math.max(1, Math.min(selectedLines.start, selectedLines.end));
    const end = Math.min(fileLineCount, Math.max(selectedLines.start, selectedLines.end));
    const text = file.contents
      .split("\n")
      .slice(start - 1, end)
      .join("\n");
    await copyText(text, start === end ? `Line ${start}` : `Lines ${start}-${end}`);
  };
  const jumpToLine = () => {
    const lineNumber = Number(lineJump);
    if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > fileLineCount) return;
    setSelectedLines({ start: lineNumber, end: lineNumber });
    setNotice(`Selected line ${lineNumber}`);
  };
  const selectedLineLabel = selectedLines
    ? selectedLines.start === selectedLines.end
      ? `Line ${selectedLines.start}`
      : `Lines ${Math.min(selectedLines.start, selectedLines.end)}-${Math.max(selectedLines.start, selectedLines.end)}`
    : null;

  return (
    <div className="space-y-4">
      <div className="file-viewer-header flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <UiButton onClick={onBack} variant="secondary" size="sm">
            <span>←</span>
            <span>Back to files</span>
          </UiButton>
          <span className="text-neutral-500">/</span>
          <span className="text-neutral-200 font-mono text-sm truncate">{filePath}</span>
        </div>
        <div className="file-viewer-header-actions flex items-center gap-2">
          {file && <CacheTimestamp cachedAt={file.cachedAt ?? null} fromCache={file.fromCache ?? false} />}
          <UiButton onClick={() => copyText(filePath, "Path")} variant="secondary" size="sm">
            <Copy className="w-3.5 h-3.5" />
            <span>Copy path</span>
          </UiButton>
          {file?.htmlUrl && (
            <UiButton onClick={() => window.open(file.htmlUrl ?? "", "_blank", "noopener,noreferrer")} variant="secondary" size="sm">
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Open</span>
            </UiButton>
          )}
          <UiButton onClick={() => refetch()} disabled={isFetching} variant="secondary" size="sm">
            <GitHubDownloadIcon className="w-3.5 h-3.5" />
            <span>{isFetching ? "Refreshing..." : "Refresh"}</span>
          </UiButton>
        </div>
      </div>

      {notice && (
        <div className="border border-blue-700/30 rounded-[5px] bg-blue-200/35 px-4 py-2 text-sm text-blue-900 flex items-center justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-blue-900 hover:text-blue-1000">
            Dismiss
          </button>
        </div>
      )}

      {Boolean(error) && (
        <div className="border border-red-700/30 rounded-[5px] bg-red-200/35 px-4 py-3 text-sm text-red-900 flex items-center gap-2">
          <GitHubAlertIcon className="w-4 h-4" />
          <span>{errorMessage(error)}</span>
        </div>
      )}

      {!file && !error && (
        <Surface>
          <EmptyState title="Loading file..." />
        </Surface>
      )}

      {file?.isBinary && (
        <Surface>
          <EmptyState
            title={file.isTooLarge ? "File is too large to preview." : "Binary file cached locally."}
            detail={file.isTooLarge ? "Open it in your editor to inspect the full contents." : "Preview is not available."}
          />
        </Surface>
      )}

      {fileForDiffs && (
        <div className="space-y-3">
          <Toolbar>
            <div className="flex items-center gap-2 text-neutral-500">
              <span>{formatBytes(file?.size ?? fileForDiffs.contents.length)}</span>
              <span>·</span>
              <span>{fileLineCount} lines</span>
              {selectedLineLabel && (
                <>
                  <span>·</span>
                  <span className="text-neutral-300">{selectedLineLabel} selected</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <UiInput
                aria-label="Jump to line"
                value={lineJump}
                onChange={(event) => setLineJump(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") jumpToLine();
                }}
                placeholder="Line"
                className="w-20"
              />
              <UiButton onClick={jumpToLine} disabled={fileLineCount === 0} variant="secondary" size="sm">
                Jump
              </UiButton>
              <UiButton onClick={copySelectedLines} disabled={!selectedLines} variant="secondary" size="sm">
                Copy selection
              </UiButton>
            </div>
          </Toolbar>
          <DiffsCodeShell>
            <DiffsFile
              file={fileForDiffs}
              options={fileViewerOptions}
              selectedLines={selectedLines}
              renderHeaderMetadata={() => (
                <span className="text-neutral-500">
                  {formatBytes(file?.size ?? fileForDiffs.contents.length)} · {fileLineCount} lines
                </span>
              )}
            />
          </DiffsCodeShell>
        </div>
      )}
    </div>
  );
}
