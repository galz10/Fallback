import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import type { LocalChangeFile, LocalStashDetail, LocalStashEntry } from "../../../shared/domain/local-git";
import { localChangeFileKey } from "../../../shared/local-changes-tree";
import { DiffsCodeShell, PatchRenderBoundary } from "../../diffs/DiffShell";
import { PatchDiff } from "../../diffs/lazy-diffs";
import { diffsDiffOptions } from "../../diffs/options";
import { formatRelative } from "../../lib/format";
import { IdentityRiskNotice, RepoIdentityControl } from "../repo-identity/RepoIdentityControl";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function localChangeStatusTone(status: LocalChangeFile["status"]): string {
  if (status === "added" || status === "untracked") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
  if (status === "deleted") return "border-red-500/35 bg-neutral-900 text-red-200";
  if (status === "renamed") return "border-blue-500/20 bg-blue-500/10 text-blue-300";
  return "border-neutral-700 bg-neutral-900 text-neutral-400";
}

export function SelectiveStashDialog({
  branch,
  files,
  message,
  pending,
  onClose,
  onConfirm
}: {
  branch: string;
  files: LocalChangeFile[];
  message: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const untrackedCount = files.filter((file) => file.status === "untracked").length;
  const trackedCount = files.length - untrackedCount;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-lg border border-neutral-800 bg-[#0A0A0A] shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-neutral-900 px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">Stash selected files</div>
            <div className="mt-1 text-xs text-neutral-600">
              <span className="font-mono text-neutral-400">{branch}</span>
              <span className="px-2 text-neutral-700">/</span>
              <span>{files.length} selected</span>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={pending}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-neutral-500 transition-colors hover:bg-[#111111] hover:text-neutral-200 disabled:opacity-50"
            aria-label="Close selective stash dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md border border-neutral-900 bg-black/20 px-3 py-2">
              <div className="font-mono text-lg text-neutral-200">{files.length}</div>
              <div className="text-[11px] text-neutral-600">selected</div>
            </div>
            <div className="rounded-md border border-neutral-900 bg-black/20 px-3 py-2">
              <div className="font-mono text-lg text-neutral-200">{trackedCount}</div>
              <div className="text-[11px] text-neutral-600">tracked</div>
            </div>
            <div className="rounded-md border border-neutral-900 bg-black/20 px-3 py-2">
              <div className="font-mono text-lg text-neutral-200">{untrackedCount}</div>
              <div className="text-[11px] text-neutral-600">untracked</div>
            </div>
          </div>
          <div className="rounded-md border border-neutral-900 bg-black/20 px-3 py-2">
            <div className="mb-1 text-[11px] font-medium text-neutral-600">Message</div>
            <div className="truncate text-sm text-neutral-300">{message}</div>
          </div>
          <div className="max-h-44 space-y-1 overflow-auto rounded-md border border-neutral-900 bg-[#050505] p-2">
            {files.map((file) => (
              <div key={localChangeFileKey(file)} className="flex items-center gap-2 text-xs">
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${localChangeStatusTone(file.status)}`}>{file.status}</span>
                <span className="min-w-0 truncate font-mono text-neutral-400">{file.path}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-neutral-900 px-4 py-3">
          <button
            onClick={onClose}
            disabled={pending}
            className="h-8 rounded-md px-3 text-sm font-medium text-neutral-500 transition-colors hover:bg-[#111111] hover:text-neutral-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={pending || files.length === 0}
            className="h-8 rounded-md bg-white px-3 text-sm font-semibold text-black transition-colors hover:bg-neutral-200 disabled:cursor-wait disabled:bg-white/[0.08] disabled:text-neutral-600"
          >
            {pending ? "Stashing..." : "Stash selected"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function LocalStashesDialog({
  repoId,
  stashes,
  isDirty,
  currentBranch,
  busy,
  onClose,
  onAction
}: {
  repoId: string;
  stashes: LocalStashEntry[];
  isDirty: boolean;
  currentBranch: string;
  busy: boolean;
  onClose: () => void;
  onAction: (ref: string, action: "apply" | "pop" | "drop") => void;
}) {
  const [selectedRef, setSelectedRef] = useState(stashes[0]?.ref ?? null);
  useEffect(() => {
    if (!selectedRef || !stashes.some((stash) => stash.ref === selectedRef)) {
      setSelectedRef(stashes[0]?.ref ?? null);
    }
  }, [selectedRef, stashes]);
  const selectedStash = stashes.find((stash) => stash.ref === selectedRef) ?? stashes[0] ?? null;
  const {
    data: detail,
    error,
    isFetching
  } = useQuery({
    queryKey: ["stashDetail", repoId, selectedStash?.ref],
    queryFn: () => window.fallback.repos.stashDetail(repoId, selectedStash!.ref),
    enabled: Boolean(selectedStash)
  });

  const stashSignature = stashes.map((stash) => `${stash.ref}:${stash.files}:${stash.date ?? ""}`).join("|");

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      <StashDialogBoundary onClose={onClose} stashSignature={stashSignature}>
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-white">Stashed changes</div>
            <div className="mt-0.5 text-xs text-neutral-600">
              {stashes.length} saved {stashes.length === 1 ? "stash" : "stashes"}
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-neutral-500 transition-colors hover:bg-[#111111] hover:text-neutral-200"
            aria-label="Close stashes"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2 border-b border-neutral-900 px-4 py-3">
          <div className="flex items-center justify-between gap-3 rounded-md border border-neutral-900 bg-black/20 px-3 py-2">
            <span className="text-xs font-medium text-neutral-500">Acting as</span>
            <RepoIdentityControl repoId={repoId} compact allowApply={false} />
          </div>
          <IdentityRiskNotice repoId={repoId} action="git" />
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)]">
          <LocalStashesPanel
            stashes={stashes}
            busy={busy}
            selectedRef={selectedStash?.ref ?? null}
            onPreview={setSelectedRef}
            framed={false}
          />
          <StashPreviewPanel
            stash={selectedStash}
            detail={detail}
            loading={isFetching}
            error={error}
            isDirty={isDirty}
            currentBranch={currentBranch}
            busy={busy}
            onAction={onAction}
          />
        </div>
      </StashDialogBoundary>
    </div>
  );
}

class StashDialogBoundary extends React.Component<
  { children: React.ReactNode; onClose: () => void; stashSignature: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(previousProps: { stashSignature: string }) {
    if (previousProps.stashSignature !== this.props.stashSignature && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="w-full max-w-lg rounded-lg border border-neutral-800 bg-[#0A0A0A] p-4 text-sm text-neutral-100 shadow-2xl">
          <div className="flex items-center gap-2 font-semibold text-neutral-100">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
            Stash preview could not render.
          </div>
          <div className="mt-2 text-neutral-300">{this.state.error.message}</div>
          <button
            type="button"
            onClick={this.props.onClose}
            className="mt-4 h-8 rounded-md border border-neutral-800 px-3 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-900 hover:text-white"
          >
            Close
          </button>
        </div>
      );
    }

    return (
      <div className="flex h-[min(860px,92vh)] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-neutral-800 bg-[#0A0A0A] shadow-2xl">
        {this.props.children}
      </div>
    );
  }
}

export function LocalStashesPanel({
  stashes,
  busy,
  onAction,
  onPreview,
  selectedRef,
  framed = true
}: {
  stashes: LocalStashEntry[];
  busy: boolean;
  onAction?: (ref: string, action: "apply" | "pop" | "drop") => void;
  onPreview?: (ref: string) => void;
  selectedRef?: string | null;
  framed?: boolean;
}) {
  const content = (
    <>
      {framed && (
        <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-600">Stashed Changes</span>
          <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold text-neutral-500">{stashes.length}</span>
        </div>
      )}
      {stashes.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-neutral-600">No stashes for this repository.</div>
      ) : (
        <div className="divide-y divide-neutral-900">
          {stashes.map((stash) => (
            <LocalStashRow
              key={stash.ref}
              stash={stash}
              busy={busy}
              selected={stash.ref === selectedRef}
              onPreview={onPreview}
              onAction={onAction}
            />
          ))}
        </div>
      )}
    </>
  );

  if (!framed) return <div>{content}</div>;
  return <div className="overflow-hidden rounded-lg border border-neutral-800 bg-[#0A0A0A]">{content}</div>;
}

function LocalStashRow({
  stash,
  busy,
  selected,
  onPreview,
  onAction
}: {
  stash: LocalStashEntry;
  busy: boolean;
  selected?: boolean;
  onPreview?: (ref: string) => void;
  onAction?: (ref: string, action: "apply" | "pop" | "drop") => void;
}) {
  const canPreview = Boolean(onPreview);
  return (
    <div
      className={`transition-colors ${
        selected
          ? "bg-white/[0.055] shadow-[inset_2px_0_0_rgb(255_255_255_/_0.72)]"
          : canPreview
            ? "hover:bg-white/[0.025]"
            : "hover:bg-white/[0.02]"
      }`}
    >
      <button
        type="button"
        onClick={() => onPreview?.(stash.ref)}
        disabled={!canPreview}
        aria-pressed={canPreview ? Boolean(selected) : undefined}
        className={`block w-full px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/20 ${
          canPreview ? "cursor-pointer" : "cursor-default"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className={`font-mono text-xs ${selected ? "text-white" : "text-neutral-300"}`}>{stash.ref}</span>
              {selected && (
                <span className="rounded-full border border-white/[0.12] bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-neutral-300">
                  selected
                </span>
              )}
            </div>
            <div className={`mt-1 truncate text-sm ${selected ? "text-neutral-200" : "text-neutral-500"}`}>{stash.message}</div>
            <div className="mt-2 text-xs text-neutral-700">{stash.date ? formatRelative(stash.date) : "Stashed"}</div>
          </div>
          <div className="shrink-0 text-right font-mono text-[11px] text-neutral-600">{stash.files} files</div>
        </div>
      </button>
      {onAction && (
        <div className="flex items-center justify-end gap-2 border-t border-white/[0.04] px-3 pb-3 pt-2">
          <div className="flex items-center gap-1">
            {(["apply", "pop", "drop"] as const).map((action) => (
              <button
                key={action}
                onClick={() => onAction(stash.ref, action)}
                disabled={busy}
                className="rounded-md px-2 py-1 text-xs font-medium capitalize text-neutral-500 transition-colors hover:bg-[#111111] hover:text-neutral-200 disabled:opacity-50"
              >
                {action === "pop" ? "Unstash" : action}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StashPreviewPanel({
  stash,
  detail,
  loading,
  error,
  isDirty,
  currentBranch,
  busy,
  onAction
}: {
  stash: LocalStashEntry | null;
  detail?: LocalStashDetail;
  loading: boolean;
  error: unknown;
  isDirty: boolean;
  currentBranch: string;
  busy: boolean;
  onAction: (ref: string, action: "apply" | "pop" | "drop") => void;
}) {
  const dirtyCrossBranch = Boolean(isDirty && detail?.branch && detail.branch !== currentBranch);
  const dirtyWarning = isDirty
    ? dirtyCrossBranch
      ? `Your ${currentBranch} workspace is dirty. Fallback will create a safety stash before applying this ${detail?.branch} stash.`
      : "Your workspace is dirty. Applying or popping this stash may overlap with current local changes."
    : null;
  const stashDate = detail?.date ?? stash?.date ?? null;
  const patch = typeof detail?.patch === "string" ? detail.patch : "";

  if (!stash) {
    return <div className="grid place-items-center border-l border-neutral-900 text-sm text-neutral-600">No stash selected.</div>;
  }

  return (
    <div className="min-w-0 overflow-y-auto border-l border-neutral-900">
      <div className="border-b border-neutral-900 px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600">
              <span className="font-mono text-neutral-400">{stash.ref}</span>
              <span>/</span>
              <span>{detail?.branch ?? "branch unknown"}</span>
              {detail?.baseSha && (
                <>
                  <span>/</span>
                  <span className="font-mono">{detail.baseSha}</span>
                </>
              )}
              <span>/</span>
              <span>{stashDate ? formatRelative(stashDate) : "date unknown"}</span>
            </div>
            <div className="mt-2 truncate text-sm font-medium text-neutral-200">{detail?.message ?? stash.message}</div>
            {detail?.baseMessage && <div className="mt-1 truncate text-xs text-neutral-600">Base: {detail.baseMessage}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {(["apply", "pop", "drop"] as const).map((action) => (
              <button
                key={action}
                onClick={() => onAction(stash.ref, action)}
                disabled={busy || loading}
                className="h-8 rounded-md border border-neutral-800 px-3 text-xs font-medium capitalize text-neutral-300 transition-colors hover:bg-neutral-900 hover:text-white disabled:cursor-wait disabled:opacity-50"
              >
                {action === "pop" ? "Unstash" : action}
              </button>
            ))}
          </div>
        </div>
        {dirtyWarning && (
          <div className="mt-3 rounded-md border border-neutral-700 bg-neutral-900/80 px-3 py-2 text-xs text-neutral-200">
            {dirtyWarning}
          </div>
        )}
      </div>

      {loading && <div className="px-4 py-10 text-center text-sm text-neutral-600">Loading stash preview...</div>}
      {Boolean(error) && !loading && (
        <div className="m-4 rounded-md border border-neutral-800 bg-[#0A0A0A] px-3 py-2 text-sm text-neutral-100">
          {errorMessage(error)}
        </div>
      )}
      {detail && !loading && !error && (
        <div className="grid min-h-0 grid-cols-[280px_minmax(0,1fr)]">
          <div className="border-r border-neutral-900">
            <div className="border-b border-neutral-900 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-600">
              {detail.files.length} {detail.files.length === 1 ? "File" : "Files"}
            </div>
            <div className="divide-y divide-neutral-900">
              {detail.files.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-neutral-600">No file list available.</div>
              ) : (
                detail.files.map((file) => <StashPreviewFileRow key={`${file.previousPath ?? ""}:${file.path}`} file={file} />)
              )}
            </div>
          </div>
          <div className="min-w-0 p-4">
            {patch.trim() ? (
              <DiffsCodeShell className="diffs-shell-fit rounded-lg border-white/[0.08] bg-black">
                <PatchRenderBoundary patch={patch}>
                  <PatchDiff patch={patch} options={{ ...diffsDiffOptions, disableFileHeader: true }} />
                </PatchRenderBoundary>
              </DiffsCodeShell>
            ) : (
              <div className="rounded-lg border border-neutral-900 bg-black px-4 py-12 text-center text-sm text-neutral-600">
                No patch preview is available for this stash.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StashPreviewFileRow({ file }: { file: LocalStashDetail["files"][number] }) {
  return (
    <div className="px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-xs text-neutral-300">{file.path}</div>
          {file.previousPath && <div className="mt-1 truncate font-mono text-[11px] text-neutral-600">from {file.previousPath}</div>}
        </div>
        <span className="shrink-0 rounded border border-neutral-800 px-1.5 py-0.5 text-[10px] uppercase text-neutral-500">
          {file.status}
        </span>
      </div>
      <div className="mt-1 font-mono text-[11px]">
        {file.additions > 0 && <span className="text-emerald-500">+{file.additions}</span>}
        {file.additions > 0 && file.deletions > 0 && <span className="text-neutral-700"> </span>}
        {file.deletions > 0 && <span className="text-red-500">-{file.deletions}</span>}
      </div>
    </div>
  );
}
