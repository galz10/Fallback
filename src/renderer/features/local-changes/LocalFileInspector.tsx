import React from "react";
import type { LocalChangePatch, LocalFileBlame, LocalFileHistory } from "../../../shared/domain/local-git";

export function LocalFilePreviewStrip({ preview }: { preview: LocalChangePatch["preview"] | null }) {
  if (!preview) return null;
  const stateText = previewStateLabel(preview);
  if (!stateText && preview.kind !== "image") return null;
  return (
    <div className="border-b border-neutral-900 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-neutral-500">
        {stateText && (
          <span className="rounded-md border border-neutral-800 bg-black px-2 py-1 font-medium text-neutral-400">{stateText}</span>
        )}
        {preview.fileSize != null && <span className="font-mono text-[11px]">{preview.fileSize.toLocaleString()} bytes</span>}
        {preview.message && <span>{preview.message}</span>}
      </div>
      {preview.kind === "image" && (preview.previousDataUrl || preview.currentDataUrl) && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <ImagePreview label="HEAD" src={preview.previousDataUrl} />
          <ImagePreview label="Worktree" src={preview.currentDataUrl} />
        </div>
      )}
    </div>
  );
}

function previewStateLabel(preview: NonNullable<LocalChangePatch["preview"]>): string | null {
  if (preview.kind === "permission_error") return "Permission issue";
  if (preview.kind === "missing") return "Missing file";
  if (preview.isGenerated) return "Generated file";
  if (preview.kind === "too_large") return "Too large";
  if (preview.kind === "lfs") return "LFS pointer";
  if (preview.kind === "binary") return "Binary file";
  if (preview.kind === "deleted") return "Deleted file";
  if (preview.kind === "image") return "Image diff";
  return null;
}

function ImagePreview({ label, src }: { label: string; src: string | null | undefined }) {
  return (
    <div className="overflow-hidden rounded-md border border-neutral-900 bg-black">
      <div className="border-b border-neutral-900 px-2 py-1 font-mono text-[11px] text-neutral-600">{label}</div>
      {src ? (
        <img src={src} alt={`${label} preview`} className="max-h-56 w-full object-contain" />
      ) : (
        <div className="py-10 text-center text-xs text-neutral-700">No image</div>
      )}
    </div>
  );
}

export function FileHistoryPanel({ history, loading }: { history?: LocalFileHistory; loading: boolean }) {
  return (
    <div className="border-t border-neutral-900 px-3 py-2">
      {loading && <div className="py-4 text-sm text-neutral-600">Loading file history...</div>}
      {!loading && history && (
        <div className="space-y-1">
          {history.renameCaveat && <div className="pb-1 text-[11px] text-neutral-600">{history.renameCaveat}</div>}
          {history.entries.slice(0, 8).map((entry) => (
            <div
              key={entry.sha}
              className="grid grid-cols-[72px_minmax(0,1fr)_140px] gap-2 rounded-md px-2 py-1.5 text-[12px] hover:bg-neutral-900/50"
            >
              <span className="font-mono text-neutral-500">{entry.shortSha}</span>
              <span className="truncate text-neutral-300">{entry.subject}</span>
              <span className="truncate text-right text-neutral-600">{entry.authorName ?? "Unknown"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function FileBlamePanel({ blame, loading }: { blame?: LocalFileBlame; loading: boolean }) {
  return (
    <div className="border-t border-neutral-900 px-3 py-2">
      {loading && <div className="py-4 text-sm text-neutral-600">Loading blame...</div>}
      {!loading && blame && (
        <div className="max-h-64 overflow-auto rounded-md border border-neutral-900 bg-black">
          {blame.lines.length === 0 && (
            <div className="px-3 py-4 text-sm text-neutral-600">Blame is available after this file is committed.</div>
          )}
          {blame.lines.slice(0, 120).map((line) => (
            <div
              key={`${line.sha}:${line.lineNumber}`}
              className="grid grid-cols-[52px_78px_140px_minmax(0,1fr)] gap-2 px-2 py-1 font-mono text-[11px]"
            >
              <span className="text-neutral-700">{line.lineNumber}</span>
              <span className="text-neutral-500">{line.shortSha}</span>
              <span className="truncate text-neutral-600">{line.authorName ?? "Unknown"}</span>
              <span className="truncate text-neutral-300">{line.content || " "}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
