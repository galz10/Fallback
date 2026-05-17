import React from "react";
import { ChevronLeft, ChevronRight, Clock, Code2, FolderSearch, GitCommit, ListChecks, Search } from "lucide-react";
import { UnresolvedFile as PierreUnresolvedFile, type FileContents } from "@pierre/diffs";
import { WorkerPoolContext } from "@pierre/diffs/react";
import type { LocalChangeFile, LocalChangePatch, LocalFileBlame, LocalFileHistory } from "../../../shared/domain/local-git";
import { hunkPatch, selectedLinesPatch, type LocalPatchFile } from "../../../shared/local-diff-patches";
import { DiffsCodeShell } from "../../diffs/DiffShell";
import { DiffsFileDiff, PatchDiff } from "../../diffs/lazy-diffs";
import { diffsConflictOptions, diffsDiffOptions } from "../../diffs/options";
import type { PatchFileView } from "../../diffs/patch-files";
import { canBlameFile } from "./useLocalChangesData";
import { FileBlamePanel, FileHistoryPanel, LocalFilePreviewStrip } from "./LocalFileInspector";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function DiffInspector({
  blame,
  blameFetching,
  busy,
  file,
  history,
  historyFetching,
  inspectorMode,
  patch,
  patchActionsOpen,
  positionLabel,
  repoPath,
  search,
  selectedLineIds,
  selectedPatch,
  selectedPatchError,
  selectedPatchFetching,
  staged,
  canSelectNext,
  canSelectPrevious,
  unstaged,
  onApply,
  onClearLines,
  onDiscard,
  onInspectorModeChange,
  onPatchActionsOpenChange,
  onResolveConflictFile,
  onSearchChange,
  onSelectNext,
  onSelectPrevious,
  onToggleLine
}: {
  blame?: LocalFileBlame;
  blameFetching: boolean;
  busy: boolean;
  file: LocalChangeFile | null;
  history?: LocalFileHistory;
  historyFetching: boolean;
  inspectorMode: "history" | "blame" | null;
  patch: LocalChangePatch | null;
  patchActionsOpen: boolean;
  positionLabel: string | null;
  repoPath: string | null;
  search: string;
  selectedLineIds: Set<string>;
  selectedPatch: PatchFileView | null;
  selectedPatchError: unknown;
  selectedPatchFetching: boolean;
  staged: LocalPatchFile | null;
  canSelectNext: boolean;
  canSelectPrevious: boolean;
  unstaged: LocalPatchFile | null;
  onApply: (action: "stage" | "unstage" | "discard", file: LocalPatchFile, patch: string, selectionKind: "hunk" | "lines") => void;
  onClearLines: () => void;
  onDiscard: (file: LocalChangeFile) => void;
  onInspectorModeChange: (mode: "history" | "blame" | null) => void;
  onPatchActionsOpenChange: (open: boolean) => void;
  onResolveConflictFile: (path: string, contents: string) => void;
  onSearchChange: (value: string) => void;
  onSelectNext: () => void;
  onSelectPrevious: () => void;
  onToggleLine: (lineId: string) => void;
}) {
  return (
    <section className="min-w-0 bg-black">
      {file && (
        <LocalDiffReviewTools
          file={file}
          patch={patch}
          staged={staged}
          unstaged={unstaged}
          search={search}
          selectedLineIds={selectedLineIds}
          patchActionsOpen={patchActionsOpen}
          inspectorMode={inspectorMode}
          history={history}
          blame={blame}
          historyFetching={historyFetching}
          blameFetching={blameFetching}
          busy={busy}
          onSearchChange={onSearchChange}
          onToggleLine={onToggleLine}
          onClearLines={onClearLines}
          onPatchActionsOpenChange={onPatchActionsOpenChange}
          onInspectorModeChange={onInspectorModeChange}
          onApply={onApply}
        />
      )}
      <div>
        <LocalChangeDiffHeader
          file={file}
          repoPath={repoPath}
          positionLabel={positionLabel}
          canSelectPrevious={canSelectPrevious}
          canSelectNext={canSelectNext}
          busy={busy}
          onSelectPrevious={onSelectPrevious}
          onSelectNext={onSelectNext}
          onDiscard={onDiscard}
        />
        {file && patch?.conflictContents ? (
          <ConflictResolutionDiff file={file} patch={patch} onResolve={(contents) => onResolveConflictFile(file.path, contents)} />
        ) : selectedPatch?.fileDiff ? (
          <DiffsCodeShell className="diffs-shell-fit !rounded-none !border-0 bg-black">
            <DiffsFileDiff fileDiff={selectedPatch.fileDiff} options={{ ...diffsDiffOptions, disableFileHeader: true }} />
          </DiffsCodeShell>
        ) : selectedPatch?.rawPatch ? (
          <DiffsCodeShell className="diffs-shell-fit !rounded-none !border-0 bg-black">
            <PatchDiff patch={selectedPatch.rawPatch} options={{ ...diffsDiffOptions, disableFileHeader: true }} />
          </DiffsCodeShell>
        ) : selectedPatchFetching ? (
          <div className="py-16 text-center text-sm text-neutral-500">Loading file diff...</div>
        ) : selectedPatchError ? (
          <div className="py-16 text-center text-sm text-red-300">{errorMessage(selectedPatchError)}</div>
        ) : (
          <div className="py-16 text-center text-sm text-neutral-500">No inline preview is available for this file yet.</div>
        )}
      </div>
    </section>
  );
}

function LocalDiffReviewTools({
  file,
  patch,
  staged,
  unstaged,
  search,
  selectedLineIds,
  patchActionsOpen,
  inspectorMode,
  history,
  blame,
  historyFetching,
  blameFetching,
  busy,
  onSearchChange,
  onToggleLine,
  onClearLines,
  onPatchActionsOpenChange,
  onInspectorModeChange,
  onApply
}: {
  file: LocalChangeFile;
  patch: LocalChangePatch | null;
  staged: LocalPatchFile | null;
  unstaged: LocalPatchFile | null;
  search: string;
  selectedLineIds: Set<string>;
  patchActionsOpen: boolean;
  inspectorMode: "history" | "blame" | null;
  history?: LocalFileHistory;
  blame?: LocalFileBlame;
  historyFetching: boolean;
  blameFetching: boolean;
  busy: boolean;
  onSearchChange: (value: string) => void;
  onToggleLine: (lineId: string) => void;
  onClearLines: () => void;
  onPatchActionsOpenChange: (open: boolean) => void;
  onInspectorModeChange: (mode: "history" | "blame" | null) => void;
  onApply: (action: "stage" | "unstage" | "discard", file: LocalPatchFile, patch: string, selectionKind: "hunk" | "lines") => void;
}) {
  const query = search.trim().toLowerCase();
  const allChangedLines = [...(staged?.hunks ?? []), ...(unstaged?.hunks ?? [])].flatMap((hunk) => hunk.changedLines);
  const searchMatches = query ? allChangedLines.filter((line) => line.content.toLowerCase().includes(query)).length : 0;
  const selectedByFile = (model: LocalPatchFile | null) =>
    model?.hunks.flatMap((hunk) => hunk.changedLines.filter((line) => selectedLineIds.has(line.id)).map((line) => line.id)) ?? [];
  const stagedSelected = selectedByFile(staged);
  const unstagedSelected = selectedByFile(unstaged);
  const preview = patch?.preview ?? null;
  const patchActionsAvailable = !patch?.conflictContents && (staged || unstaged);

  return (
    <div className="border-b border-neutral-900 bg-[#050505]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-900 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-[12px] text-neutral-500">
          <Search className="h-3.5 w-3.5 text-neutral-600" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.currentTarget.value)}
            placeholder="Search diff"
            className="h-7 w-44 rounded-md border border-neutral-800 bg-black px-2 font-mono text-[12px] text-neutral-300 outline-none placeholder:text-neutral-700 focus:border-neutral-600"
          />
          {query && <span className="font-mono text-[11px] text-neutral-600">{searchMatches} matches</span>}
          {selectedLineIds.size > 0 && (
            <button
              type="button"
              onClick={onClearLines}
              className="rounded-md px-2 py-1 text-[11px] text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-neutral-200"
            >
              Clear {selectedLineIds.size}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {patchActionsAvailable && (
            <button
              type="button"
              onClick={() => onPatchActionsOpenChange(!patchActionsOpen)}
              aria-label={patchActionsOpen ? "Hide patch actions" : "Show patch actions"}
              title={patchActionsOpen ? "Hide patch actions" : "Show patch actions"}
              className={`inline-grid h-7 w-7 place-items-center rounded-md border text-neutral-500 transition-colors ${
                patchActionsOpen
                  ? "border-neutral-700 bg-neutral-900 text-neutral-100"
                  : "border-neutral-800 hover:bg-neutral-900 hover:text-neutral-200"
              }`}
            >
              <ListChecks className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onInspectorModeChange(inspectorMode === "history" ? null : "history")}
            className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors ${
              inspectorMode === "history"
                ? "border-neutral-700 bg-neutral-900 text-neutral-100"
                : "border-neutral-800 text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200"
            }`}
          >
            <Clock className="h-3 w-3" />
            History
          </button>
          <button
            type="button"
            onClick={() => onInspectorModeChange(inspectorMode === "blame" ? null : "blame")}
            disabled={!canBlameFile(file)}
            title={canBlameFile(file) ? "Show committed line blame" : "Blame is available after the file exists in HEAD"}
            className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors disabled:opacity-45 ${
              inspectorMode === "blame"
                ? "border-neutral-700 bg-neutral-900 text-neutral-100"
                : "border-neutral-800 text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200"
            }`}
          >
            <GitCommit className="h-3 w-3" />
            Blame
          </button>
        </div>
      </div>

      <LocalFilePreviewStrip preview={preview} />

      {patchActionsOpen && patchActionsAvailable && (
        <div className="border-t border-neutral-900">
          <div className="grid gap-2 px-3 py-3 xl:grid-cols-2">
            <PatchStageColumn
              title="Unstaged hunks"
              actionLabel="Stage"
              model={unstaged}
              selectedLineIds={unstagedSelected}
              busy={busy}
              onToggleLine={onToggleLine}
              onApply={(hunkId) => {
                if (!unstaged) return;
                const patchText = hunkPatch(unstaged, hunkId);
                if (patchText) onApply("stage", unstaged, patchText, "hunk");
              }}
              onApplySelected={() => {
                if (!unstaged) return;
                const patchText = selectedLinesPatch(unstaged, unstagedSelected);
                if (patchText) onApply("stage", unstaged, patchText, "lines");
              }}
              onDiscard={(hunkId) => {
                if (!unstaged) return;
                const patchText = hunkPatch(unstaged, hunkId);
                if (patchText) onApply("discard", unstaged, patchText, "hunk");
              }}
              onDiscardSelected={() => {
                if (!unstaged) return;
                const patchText = selectedLinesPatch(unstaged, unstagedSelected, { applyMode: "reverse" });
                if (patchText) onApply("discard", unstaged, patchText, "lines");
              }}
            />
            <PatchStageColumn
              title="Staged hunks"
              actionLabel="Unstage"
              model={staged}
              selectedLineIds={stagedSelected}
              busy={busy}
              onToggleLine={onToggleLine}
              onApply={(hunkId) => {
                if (!staged) return;
                const patchText = hunkPatch(staged, hunkId);
                if (patchText) onApply("unstage", staged, patchText, "hunk");
              }}
              onApplySelected={() => {
                if (!staged) return;
                const patchText = selectedLinesPatch(staged, stagedSelected, { applyMode: "reverse" });
                if (patchText) onApply("unstage", staged, patchText, "lines");
              }}
            />
          </div>
        </div>
      )}

      {inspectorMode === "history" && <FileHistoryPanel history={history} loading={historyFetching} />}
      {inspectorMode === "blame" && <FileBlamePanel blame={blame} loading={blameFetching} />}
    </div>
  );
}

function ConflictResolutionDiff({
  file,
  patch,
  onResolve
}: {
  file: LocalChangeFile;
  patch: LocalChangePatch;
  onResolve: (contents: string) => void;
}) {
  const unresolvedFile = React.useMemo<FileContents>(
    () => ({
      name: file.path,
      contents: patch.conflictContents ?? "",
      cacheKey: `local-conflict:${patch.path}:${patch.generatedAt}:${patch.conflictMarkerCount ?? 0}`
    }),
    [file.path, patch.conflictContents, patch.conflictMarkerCount, patch.generatedAt, patch.path]
  );

  return (
    <DiffsCodeShell className="diffs-shell-fit !rounded-none !border-0 bg-black">
      <PierreConflictFile key={unresolvedFile.cacheKey} file={unresolvedFile} onResolve={onResolve} />
    </DiffsCodeShell>
  );
}

function PierreConflictFile({ file, onResolve }: { file: FileContents; onResolve: (contents: string) => void }) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const workerPool = React.useContext(WorkerPoolContext);
  const onResolveRef = React.useRef(onResolve);

  React.useEffect(() => {
    onResolveRef.current = onResolve;
  }, [onResolve]);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const instance = new PierreUnresolvedFile(
      {
        ...diffsConflictOptions,
        disableFileHeader: true,
        onMergeConflictResolve: (resolvedFile) => onResolveRef.current(resolvedFile.contents)
      },
      workerPool
    );
    instance.render({ file, containerWrapper: host });

    return () => {
      instance.cleanUp();
    };
  }, [file, workerPool]);

  return <div ref={hostRef} className="min-w-0" />;
}

function PatchStageColumn({
  title,
  actionLabel,
  model,
  selectedLineIds,
  busy,
  onToggleLine,
  onApply,
  onApplySelected,
  onDiscard,
  onDiscardSelected
}: {
  title: string;
  actionLabel: string;
  model: LocalPatchFile | null;
  selectedLineIds: string[];
  busy: boolean;
  onToggleLine: (lineId: string) => void;
  onApply: (hunkId: string) => void;
  onApplySelected: () => void;
  onDiscard?: (hunkId: string) => void;
  onDiscardSelected?: () => void;
}) {
  return (
    <div className="min-w-0 rounded-md border border-neutral-900 bg-black/20">
      <div className="flex items-center justify-between border-b border-neutral-900 px-2.5 py-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-600">{title}</span>
        <div className="flex items-center gap-1">
          {selectedLineIds.length > 0 && (
            <>
              <button
                type="button"
                onClick={onApplySelected}
                disabled={busy}
                className="rounded-md border border-neutral-800 px-2 py-1 text-[11px] text-neutral-300 transition-colors hover:bg-neutral-900 disabled:opacity-50"
              >
                {actionLabel} {selectedLineIds.length}
              </button>
              {onDiscardSelected && (
                <button
                  type="button"
                  onClick={onDiscardSelected}
                  disabled={busy}
                  className="rounded-md border border-red-500/20 px-2 py-1 text-[11px] text-red-200 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                >
                  Discard {selectedLineIds.length}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {!model || model.hunks.length === 0 ? (
        <div className="px-3 py-4 text-[12px] text-neutral-700">No hunks.</div>
      ) : (
        <div className="max-h-52 space-y-1 overflow-auto p-1.5">
          {model.hunks.map((hunk) => (
            <div key={hunk.id} className="rounded-md border border-neutral-900 bg-[#050505]">
              <div className="flex items-center justify-between gap-2 border-b border-neutral-900 px-2 py-1.5">
                <span className="truncate font-mono text-[11px] text-neutral-600">{hunk.header}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onApply(hunk.id)}
                    disabled={busy}
                    className="rounded px-1.5 py-0.5 text-[11px] text-neutral-300 hover:bg-neutral-900 disabled:opacity-50"
                  >
                    {actionLabel}
                  </button>
                  {onDiscard && (
                    <button
                      type="button"
                      onClick={() => onDiscard(hunk.id)}
                      disabled={busy}
                      className="rounded px-1.5 py-0.5 text-[11px] text-red-200 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      Discard
                    </button>
                  )}
                </div>
              </div>
              <div className="space-y-0.5 px-2 py-1">
                {hunk.changedLines.slice(0, 12).map((line) => (
                  <label key={line.id} className="grid grid-cols-[16px_42px_minmax(0,1fr)] items-center gap-1 text-[11px]">
                    <input
                      type="checkbox"
                      checked={selectedLineIds.includes(line.id)}
                      onChange={() => onToggleLine(line.id)}
                      className="h-3 w-3"
                      aria-label={`Select ${line.type} line ${line.newLine ?? line.oldLine ?? ""}`}
                    />
                    <span className={`font-mono ${line.type === "addition" ? "text-emerald-500" : "text-red-400"}`}>
                      {line.type === "addition" ? `+${line.newLine ?? ""}` : `-${line.oldLine ?? ""}`}
                    </span>
                    <span className="truncate font-mono text-neutral-500">{line.content || " "}</span>
                  </label>
                ))}
                {hunk.changedLines.length > 12 && (
                  <div className="px-5 text-[11px] text-neutral-700">{hunk.changedLines.length - 12} more lines</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LocalChangeDiffHeader({
  file,
  repoPath,
  positionLabel,
  canSelectPrevious,
  canSelectNext,
  busy,
  onSelectPrevious,
  onSelectNext,
  onDiscard
}: {
  file: LocalChangeFile | null;
  repoPath: string | null;
  positionLabel: string | null;
  canSelectPrevious: boolean;
  canSelectNext: boolean;
  busy: boolean;
  onSelectPrevious: () => void;
  onSelectNext: () => void;
  onDiscard: (file: LocalChangeFile) => void;
}) {
  if (!file) return null;
  const absolutePath = repoPath ? `${repoPath.replace(/[\\/]+$/, "")}/${file.path}` : null;
  return (
    <div className="flex h-10 items-center justify-between gap-3 border-b border-neutral-800 bg-[#080808] px-3 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0">
          <div className="truncate font-mono text-xs text-neutral-200">{file.path}</div>
          {file.previousPath && (
            <div className="mt-0.5 truncate font-mono text-[11px] text-neutral-600">renamed from {file.previousPath}</div>
          )}
        </div>
        {positionLabel && <span className="shrink-0 font-mono text-[11px] text-neutral-700">{positionLabel}</span>}
        <div className="flex items-center rounded-md border border-neutral-800 bg-black/40">
          <button
            type="button"
            onClick={onSelectPrevious}
            disabled={!canSelectPrevious}
            className="grid h-7 w-7 place-items-center text-neutral-500 transition-colors hover:text-neutral-200 disabled:opacity-35"
            aria-label="Review previous changed file"
            title="Previous changed file"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <div className="h-4 w-px bg-neutral-800" />
          <button
            type="button"
            onClick={onSelectNext}
            disabled={!canSelectNext}
            className="grid h-7 w-7 place-items-center text-neutral-500 transition-colors hover:text-neutral-200 disabled:opacity-35"
            aria-label="Review next changed file"
            title="Next changed file"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {file.staged && (
          <span className="rounded-md border border-neutral-800 bg-black px-2 py-1 font-mono text-xs">
            {file.additions > 0 && <span className="text-emerald-500">+{file.additions}</span>}
            {file.additions > 0 && file.deletions > 0 && <span className="text-neutral-700"> </span>}
            {file.deletions > 0 && <span className="text-red-500">-{file.deletions}</span>}
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            if (absolutePath) void window.fallback.shell.openEditorAtLine(absolutePath, 1, repoPath);
          }}
          disabled={busy || !absolutePath}
          title={absolutePath ? "Open file in editor" : "No local folder"}
          aria-label="Open changed file in editor"
          className="local-change-file-action"
        >
          <Code2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            if (absolutePath) void window.fallback.shell.revealPath(absolutePath);
          }}
          disabled={busy || !absolutePath}
          title={absolutePath ? "Reveal file in file manager" : "No local folder"}
          aria-label="Reveal changed file in file manager"
          className="local-change-file-action"
        >
          <FolderSearch className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onDiscard(file)}
          disabled={busy}
          className="h-7 rounded-md border border-neutral-800 bg-black px-2 text-xs font-medium text-neutral-500 transition-colors hover:border-red-700/40 hover:bg-red-950/20 hover:text-red-300 disabled:opacity-50"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
