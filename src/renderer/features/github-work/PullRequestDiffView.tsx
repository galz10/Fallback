import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DiffLineAnnotation, SelectedLineRange } from "@pierre/diffs";
import { prepareFileTreeInput } from "@pierre/trees";
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react";
import { AlertIcon as GitHubAlertIcon, CheckIcon as GitHubCheckIcon, CommentIcon as GitHubCommentIcon } from "@primer/octicons-react";
import { ChevronDown, X } from "lucide-react";
import { toast } from "sonner";
import { Button as UiButton, EmptyState } from "../../components/ui";
import type { WatchedRepo } from "../../../shared/domain/watched-repo";
import type {
  PullRequestDetail,
  PullRequestDiff,
  PullRequestReviewDraft,
  PullRequestReviewDraftComment,
  TimelineComment
} from "../../../shared/domain/github-work";
import {
  emptyPullRequestReviewDraft,
  removeReviewDraftComment,
  reviewDraftCommentCount,
  reviewFailureCopy,
  reviewSubmitPayload,
  reviewSubmitState,
  upsertReviewDraftComment
} from "../../../shared/pr-review-drafts";
import { reviewContinuityCopy, type ReviewContinuityCopy } from "../../../shared/product-coherence";
import { Avatar } from "../../components/Avatar";
import { CacheTimestamp, type CacheStampState } from "../../components/CacheTimestamp";
import { DiffsCodeShell, PatchRenderBoundary } from "../../diffs/DiffShell";
import { DiffsFileDiff, PatchDiff } from "../../diffs/lazy-diffs";
import { diffsDiffOptions } from "../../diffs/options";
import type { PatchFileView } from "../../diffs/patch-files";
import { Surface } from "../../components/ui";
import { Textarea } from "../../components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { IdentityRiskNotice, RepoIdentityControl } from "../repo-identity/RepoIdentityControl";
import { MarkdownBody } from "./MarkdownBody";
import { formatRelative } from "../../lib/format";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function useNetworkOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

interface ReviewAnnotationMetadata {
  comments?: TimelineComment[];
  draft?: InlineReviewDraft;
}

type DiffAnnotationSide = "additions" | "deletions";

type InlineReviewDraft = PullRequestReviewDraftComment;

interface DiffTextSelectionPoint {
  lineNumber: number;
  side: DiffAnnotationSide;
  source: "content" | "gutter";
}

interface DiffTextSelectionStart {
  fileId: string;
  point: DiffTextSelectionPoint;
  x: number;
  y: number;
}

export function PullRequestDiffView({
  diff,
  pr,
  files,
  error,
  login,
  repo,
  isFetching = false,
  isCacheWarming = false
}: {
  diff?: PullRequestDiff;
  pr: PullRequestDetail;
  files: PatchFileView[];
  error: unknown;
  login?: string;
  repo?: WatchedRepo | null;
  isFetching?: boolean;
  isCacheWarming?: boolean;
}) {
  const queryClient = useQueryClient();
  const online = useNetworkOnline();
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const collapsedStorageKey = `fallback:collapsed-files:${pr.repoId}:${pr.number}:${pr.headSha ?? "unknown"}`;
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [localReviewDraft, setLocalReviewDraft] = useState<PullRequestReviewDraft | null>(null);
  const [reviewDraftError, setReviewDraftError] = useState<string | null>(null);
  const [reviewComposerOpen, setReviewComposerOpen] = useState(false);
  const diffTextSelectionStartRef = useRef<DiffTextSelectionStart | null>(null);
  const visibleFiles = files;
  const diffTotals = useMemo(
    () =>
      visibleFiles.reduce(
        (totals, file) => ({
          additions: totals.additions + file.additions,
          deletions: totals.deletions + file.deletions
        }),
        { additions: 0, deletions: 0 }
      ),
    [visibleFiles]
  );
  const selectedFile = visibleFiles.find((file) => file.id === selectedFilePath) ?? visibleFiles[0] ?? null;
  const draftQuery = useQuery({
    queryKey: ["prReviewDraft", pr.repoId, pr.number],
    queryFn: () => window.fallback.prs.getReviewDraft(pr.repoId, pr.number)
  });
  const reviewDraft =
    localReviewDraft ??
    draftQuery.data ??
    emptyPullRequestReviewDraft({ repoId: pr.repoId, prNumber: pr.number, headSha: pr.headSha ?? null });
  const reviewedFiles = useMemo(
    () => new Set(reviewDraft.outdated ? [] : reviewDraft.reviewedFiles),
    [reviewDraft.outdated, reviewDraft.reviewedFiles]
  );
  const draftComments = reviewDraft.outdated ? [] : reviewDraft.comments;
  const draftCommentCount = reviewDraftCommentCount(reviewDraft);
  const reviewBlockReason = reviewWriteBlockReason(pr, repo);
  const canWriteReview = !reviewBlockReason;
  const updateReviewDraft = useMutation({
    mutationFn: (next: PullRequestReviewDraft) =>
      window.fallback.prs.updateReviewDraft(pr.repoId, pr.number, {
        headSha: next.headSha ?? pr.headSha ?? null,
        event: next.event,
        body: next.body,
        comments: next.comments,
        reviewedFiles: next.reviewedFiles
      }),
    onSuccess: (next) => {
      setLocalReviewDraft(next);
      queryClient.setQueryData(["prReviewDraft", pr.repoId, pr.number], next);
    },
    onError: (mutationError) => setReviewDraftError(errorMessage(mutationError))
  });
  const clearReviewDraft = useMutation({
    mutationFn: () => window.fallback.prs.clearReviewDraft(pr.repoId, pr.number, reviewDraft.headSha),
    onSuccess: async () => {
      const empty = emptyPullRequestReviewDraft({ repoId: pr.repoId, prNumber: pr.number, headSha: pr.headSha ?? null });
      setLocalReviewDraft(empty);
      setReviewDraftError(null);
      await queryClient.invalidateQueries({ queryKey: ["prReviewDraft", pr.repoId, pr.number] });
    },
    onError: (mutationError) => setReviewDraftError(errorMessage(mutationError))
  });
  const submitReviewDraft = useMutation({
    mutationFn: async () => {
      const state = reviewSubmitState({
        draft: reviewDraft,
        connected: Boolean(login),
        online,
        queueWhenUnavailable: true,
        canWrite: canWriteReview,
        writeBlockReason: reviewBlockReason
      });
      if (!state.canSubmit) throw new Error(state.message);
      return window.fallback.prs.submitReview(pr.repoId, pr.number, reviewSubmitPayload(reviewDraft), { clientOnline: online });
    },
    onSuccess: async (result) => {
      if (result.mode === "queued") {
        toast("Review queued locally", { description: "It will send when GitHub is reachable." });
      }
      await window.fallback.prs.clearReviewDraft(pr.repoId, pr.number, reviewDraft.headSha);
      const empty = emptyPullRequestReviewDraft({ repoId: pr.repoId, prNumber: pr.number, headSha: pr.headSha ?? null });
      setLocalReviewDraft(empty);
      await Promise.all([
        window.fallback.prs.refresh(pr.repoId, pr.number).catch(() => undefined),
        queryClient.invalidateQueries({ queryKey: ["prReviewDraft", pr.repoId, pr.number] }),
        queryClient.invalidateQueries({ queryKey: ["prDetail", pr.repoId, pr.number] }),
        queryClient.invalidateQueries({ queryKey: ["prs", pr.repoId] }),
        queryClient.invalidateQueries({ queryKey: ["myPrs"] }),
        queryClient.invalidateQueries({ queryKey: ["offlineActions"] })
      ]);
    },
    onError: (mutationError) => setReviewDraftError(reviewFailureCopy(errorMessage(mutationError)))
  });
  const submitState = reviewSubmitState({
    draft: reviewDraft,
    connected: Boolean(login),
    online,
    queueWhenUnavailable: true,
    canWrite: canWriteReview,
    writeBlockReason: reviewBlockReason,
    pending: submitReviewDraft.isPending
  });
  const continuity = reviewContinuityCopy({
    draft: reviewDraft,
    currentHeadSha: pr.headSha ?? null,
    online,
    accountLogin: login
  });

  useEffect(() => {
    try {
      setCollapsedFiles(new Set(JSON.parse(localStorage.getItem(collapsedStorageKey) ?? "[]") as string[]));
    } catch {
      setCollapsedFiles(new Set());
    }
  }, [collapsedStorageKey]);

  useEffect(() => {
    if (draftQuery.data !== undefined) {
      setLocalReviewDraft(
        draftQuery.data ?? emptyPullRequestReviewDraft({ repoId: pr.repoId, prNumber: pr.number, headSha: pr.headSha ?? null })
      );
    }
  }, [draftQuery.data, pr.headSha, pr.number, pr.repoId]);

  useEffect(() => {
    if (!selectedFile && selectedFilePath !== null) setSelectedFilePath(null);
    if (selectedFile && selectedFile.id !== selectedFilePath) setSelectedFilePath(selectedFile.id);
  }, [selectedFile, selectedFilePath]);

  const selectFile = useCallback(
    (file: PatchFileView) => {
      setSelectedFilePath(file.id);
      setCollapsedFiles((current) => {
        if (!current.has(file.id)) return current;
        const next = new Set(current);
        next.delete(file.id);
        localStorage.setItem(collapsedStorageKey, JSON.stringify([...next]));
        return next;
      });
      requestAnimationFrame(() => fileRefs.current[file.id]?.scrollIntoView({ block: "start", behavior: "smooth" }));
    },
    [collapsedStorageKey]
  );

  const toggleCollapsed = (file: PatchFileView) => {
    setCollapsedFiles((current) => {
      const next = new Set(current);
      if (next.has(file.id)) next.delete(file.id);
      else next.add(file.id);
      localStorage.setItem(collapsedStorageKey, JSON.stringify([...next]));
      return next;
    });
  };

  const toggleReviewed = (file: PatchFileView) => {
    if (reviewDraft.outdated) return;
    const nextReviewed = new Set(reviewDraft.reviewedFiles);
    const willReview = !nextReviewed.has(file.id);
    if (willReview) nextReviewed.add(file.id);
    else nextReviewed.delete(file.id);
    persistReviewDraft({ ...reviewDraft, reviewedFiles: [...nextReviewed] });

    setCollapsedFiles((currentCollapsed) => {
      const nextCollapsed = new Set(currentCollapsed);
      if (willReview) nextCollapsed.add(file.id);
      else nextCollapsed.delete(file.id);
      localStorage.setItem(collapsedStorageKey, JSON.stringify([...nextCollapsed]));
      return nextCollapsed;
    });
  };

  const createInlineDraft = (file: PatchFileView, range: SelectedLineRange | null) => {
    const draft = normalizeInlineReviewDraft(file, range);
    if (!draft || reviewDraft.outdated) return;
    persistReviewDraft({ ...reviewDraft, comments: upsertReviewDraftComment(reviewDraft.comments, draft) });
    setSelectedFilePath(file.id);
  };

  const handleDiffTextPointerDown = (file: PatchFileView, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      diffTextSelectionStartRef.current = null;
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) {
      diffTextSelectionStartRef.current = null;
      return;
    }
    const point = getDiffTextSelectionPoint(event.nativeEvent);
    diffTextSelectionStartRef.current = point?.source === "content" ? { fileId: file.id, point, x: event.clientX, y: event.clientY } : null;
  };

  const handleDiffTextPointerUp = (file: PatchFileView, event: React.PointerEvent<HTMLDivElement>) => {
    const start = diffTextSelectionStartRef.current;
    diffTextSelectionStartRef.current = null;
    if (!start || start.fileId !== file.id) return;
    const end = getDiffTextSelectionPoint(event.nativeEvent);
    if (end?.source !== "content") return;
    const moved = Math.abs(event.clientX - start.x) > 4 || Math.abs(event.clientY - start.y) > 4;
    const changedLine = start.point.lineNumber !== end.lineNumber || start.point.side !== end.side;
    if (!moved && !changedLine) return;
    createInlineDraft(file, {
      start: start.point.lineNumber,
      side: start.point.side,
      end: end.lineNumber,
      ...(start.point.side !== end.side ? { endSide: end.side } : {})
    });
  };

  const updateInlineDraftBody = (draft: InlineReviewDraft, body: string) => {
    persistReviewDraft({ ...reviewDraft, comments: upsertReviewDraftComment(reviewDraft.comments, { ...draft, body }) });
  };

  const clearInlineDraft = (draft: InlineReviewDraft) => {
    persistReviewDraft({ ...reviewDraft, comments: removeReviewDraftComment(reviewDraft.comments, draft.id) });
  };

  const updateReviewBody = (body: string) => persistReviewDraft({ ...reviewDraft, body });
  const updateReviewEvent = (event: PullRequestReviewDraft["event"]) => persistReviewDraft({ ...reviewDraft, event });
  const persistReviewDraft = (next: PullRequestReviewDraft) => {
    setLocalReviewDraft(next);
    setReviewDraftError(null);
    updateReviewDraft.mutate(next);
  };

  return (
    <div className="min-h-[calc(100vh-56px)]">
      {Boolean(error) && (
        <div className="m-8 flex items-center gap-2 rounded-[5px] border border-red-700/30 bg-red-200/35 px-4 py-3 text-sm text-red-900">
          <GitHubAlertIcon className="w-4 h-4" />
          <span>{errorMessage(error)}</span>
        </div>
      )}

      {!diff && !error && (
        <div className="m-8 rounded-[5px] border border-neutral-800 bg-black p-8 text-center text-sm text-neutral-500">Loading diff...</div>
      )}

      {diff && diff.patch.trim().length === 0 && (
        <div className="m-8 rounded-[5px] border border-neutral-800 bg-black p-8 text-center text-sm text-neutral-500">
          {isCacheWarming || isFetching
            ? "Fetching this patch in the background. The changes will appear here automatically."
            : "No changed files are available for this pull request."}
        </div>
      )}

      {diff && diff.patch.trim().length > 0 && (
        <div className="pr-diff-layout xl:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="pr-diff-sidebar px-4 py-6 xl:sticky xl:top-[58px] xl:max-h-[calc(100vh-58px)] xl:overflow-y-auto">
            <div className="mb-4 flex items-center justify-between gap-3 px-1">
              <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-600">Files</div>
                <div className="mt-1 font-mono text-xs text-neutral-700">
                  {visibleFiles.length} {visibleFiles.length === 1 ? "file" : "files"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums">
                {diffTotals.additions > 0 && <span className="pr-count-pill pr-count-pill-muted">+{diffTotals.additions}</span>}
                {diffTotals.deletions > 0 && <span className="pr-count-pill pr-count-pill-muted">-{diffTotals.deletions}</span>}
              </div>
            </div>
            <PierreSurfaceBoundary label="file tree">
              <PatchFileTree
                files={visibleFiles}
                selectedFileId={selectedFile?.id ?? null}
                reviewedFiles={reviewedFiles}
                onSelectFile={selectFile}
              />
            </PierreSurfaceBoundary>
          </aside>

          <div className="pr-diff-content">
            <PullRequestReviewDrawer
              draft={reviewDraft}
              continuity={continuity}
              commentCount={draftCommentCount}
              submitState={submitState}
              submitPending={submitReviewDraft.isPending}
              savePending={updateReviewDraft.isPending}
              clearPending={clearReviewDraft.isPending}
              error={reviewDraftError ?? (submitReviewDraft.error ? reviewFailureCopy(errorMessage(submitReviewDraft.error)) : null)}
              diff={diff}
              open={reviewComposerOpen}
              onBodyChange={updateReviewBody}
              onEventChange={updateReviewEvent}
              onOpenChange={setReviewComposerOpen}
              onSubmit={() => submitReviewDraft.mutate()}
              onClear={() => clearReviewDraft.mutate()}
            />
            {visibleFiles.length === 0 && (
              <Surface tone="elevated">
                <EmptyState title="No files to show." />
              </Surface>
            )}
            {visibleFiles.map((file) => {
              const reviewAnnotations = file.fileDiff ? buildReviewAnnotations(file.fileDiff, pr.reviewComments) : [];
              const draftAnnotations = draftComments
                .filter((draft) => draft.fileId === file.id)
                .map((draft) => createInlineDraftAnnotation(draft));
              const annotations = [...reviewAnnotations, ...draftAnnotations];
              const reviewComments = pr.reviewComments.filter((comment) => comment.path === file.path);
              const collapsed = collapsedFiles.has(file.id);
              const reviewed = reviewedFiles.has(file.id);
              const diffOptions = {
                ...diffsDiffOptions,
                disableFileHeader: true,
                onLineSelected: (range: SelectedLineRange | null) => createInlineDraft(file, range),
                onGutterUtilityClick: (range: SelectedLineRange) => createInlineDraft(file, range)
              };
              return (
                <div
                  key={file.id}
                  ref={(node) => {
                    fileRefs.current[file.id] = node;
                  }}
                  className={`${collapsed ? "mb-3" : "mb-10"} scroll-mt-[84px]`}
                >
                  <PatchFileHeader
                    file={file}
                    collapsed={collapsed}
                    reviewed={reviewed}
                    reviewCommentCount={reviewComments.length}
                    onToggleCollapsed={() => toggleCollapsed(file)}
                    onToggleReviewed={() => toggleReviewed(file)}
                  />
                  {!collapsed && (
                    <DiffsCodeShell
                      className="diffs-shell-fit pr-diff-shell"
                      onPointerDownCapture={(event) => handleDiffTextPointerDown(file, event)}
                      onPointerCancel={() => {
                        diffTextSelectionStartRef.current = null;
                      }}
                      onPointerUpCapture={(event) => handleDiffTextPointerUp(file, event)}
                    >
                      <PatchRenderBoundary patch={file.rawPatch ?? diff.patch}>
                        {file.fileDiff ? (
                          <DiffsFileDiff
                            fileDiff={file.fileDiff}
                            options={diffOptions}
                            lineAnnotations={annotations}
                            renderAnnotation={(annotation) => (
                              <ReviewDiffAnnotation
                                annotation={annotation}
                                repoId={pr.repoId}
                                login={login}
                                onDraftBodyChange={updateInlineDraftBody}
                                onCancelDraft={clearInlineDraft}
                              />
                            )}
                          />
                        ) : (
                          <PatchDiff patch={file.rawPatch ?? diff.patch} options={diffOptions} />
                        )}
                      </PatchRenderBoundary>
                    </DiffsCodeShell>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PatchFileTree({
  files,
  selectedFileId,
  reviewedFiles,
  onSelectFile
}: {
  files: PatchFileView[];
  selectedFileId: string | null;
  reviewedFiles: Set<string>;
  onSelectFile: (file: PatchFileView) => void;
}) {
  const fileByPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);
  const fileByPathRef = useRef(fileByPath);
  const onSelectFileRef = useRef(onSelectFile);
  const reviewedFilesRef = useRef(reviewedFiles);
  const paths = useMemo(() => uniqueTreePaths(fileByPath.keys()), [fileByPath]);
  const selectedPath = files.find((file) => file.id === selectedFileId)?.path ?? null;
  const preparedInput = useMemo(() => prepareFileTreeInput(paths, { flattenEmptyDirectories: true }), [paths]);
  const { model } = useFileTree({
    density: "compact",
    fileTreeSearchMode: "hide-non-matches",
    flattenEmptyDirectories: true,
    initialExpansion: "open",
    initialSelectedPaths: selectedPath ? [selectedPath] : [],
    initialVisibleRowCount: 22,
    itemHeight: 28,
    overscan: 8,
    paths,
    preparedInput,
    search: false,
    stickyFolders: true,
    onSelectionChange: (selectedPaths) => {
      const nextPath = selectedPaths[selectedPaths.length - 1];
      const file = nextPath ? fileByPathRef.current.get(nextPath) : null;
      if (file) {
        onSelectFileRef.current(file);
      }
    },
    renderRowDecoration: ({ item }) => {
      if (item.kind !== "file") return null;
      const file = fileByPathRef.current.get(item.path);
      if (!file) return null;
      const stats = [file.additions > 0 ? `+${file.additions}` : null, file.deletions > 0 ? `-${file.deletions}` : null]
        .filter(Boolean)
        .join(" ");
      const reviewed = reviewedFilesRef.current.has(file.id);
      return {
        text: reviewed ? `seen ${stats}`.trim() : stats || file.type,
        title: reviewed
          ? `Reviewed. ${file.additions} additions, ${file.deletions} deletions.`
          : `${file.additions} additions, ${file.deletions} deletions.`
      };
    },
    unsafeCSS: `
      :host {
        --trees-bg-override: transparent;
        --trees-bg-muted-override: transparent;
        --trees-accent-override: rgb(115 115 115);
        --trees-fg-override: rgb(163 163 163);
        --trees-fg-muted-override: rgb(82 82 82);
        --trees-border-color-override: rgb(32 32 32);
        --trees-indent-guide-bg-override: rgb(38 38 38);
        --trees-selected-fg-override: rgb(245 245 245);
        --trees-selected-bg-override: transparent;
        --trees-selected-focused-border-color-override: rgb(64 64 64);
        --trees-focus-ring-color-override: rgb(64 64 64);
        --trees-status-modified-override: rgb(115 115 115);
        --trees-status-untracked-override: rgb(115 115 115);
        --trees-status-added-override: rgb(115 115 115);
        --trees-status-deleted-override: rgb(115 115 115);
        --trees-git-modified-color-override: rgb(115 115 115);
        --trees-git-untracked-color-override: rgb(115 115 115);
        --trees-git-added-color-override: rgb(115 115 115);
        --trees-git-deleted-color-override: rgb(115 115 115);
        --trees-file-icon-color: rgb(82 82 82);
        --trees-font-family-override: var(--font-sans);
        --trees-font-size-override: 12px;
        --trees-font-weight-semibold-override: 500;
        --trees-padding-inline-override: 8px;
        background: transparent !important;
      }

      [data-file-tree-virtualized-wrapper='true'],
      [data-file-tree-virtualized-root='true'],
      [data-file-tree-virtualized-scroll='true'] {
        background: transparent !important;
        background-color: transparent !important;
      }

      [data-item-section='git'],
      [data-item-section='action'],
      [data-type='context-menu-anchor'] {
        display: none !important;
      }

      button[data-type='item'] {
        border-radius: 6px;
      }

      button[data-type='item'][data-item-type='folder'] {
        background: transparent !important;
        background-color: transparent !important;
        border-color: transparent !important;
        box-shadow: none !important;
        color: rgb(115 115 115) !important;
        font-weight: 400 !important;
      }

      button[data-type='item'][data-item-type='folder']:hover {
        background: transparent !important;
        background-color: transparent !important;
      }

      button[data-type='item'][data-item-type='folder'][data-item-selected],
      button[data-type='item'][data-item-type='folder'][data-item-focused],
      button[data-type='item'][data-item-type='folder']:focus,
      button[data-type='item'][data-item-type='folder']:focus-visible {
        background: transparent !important;
        background-color: transparent !important;
        border-color: transparent !important;
        box-shadow: none !important;
        outline: none !important;
      }

      button[data-type='item'][data-item-type='folder']::before {
        display: none !important;
        outline: 0 !important;
      }

      button[data-type='item'][data-item-type='folder'] [data-item-section='content'],
      button[data-type='item'][data-item-type='folder'][aria-selected='true'] [data-item-section='content'] {
        color: rgb(163 163 163) !important;
      }

      button[data-type='item'][data-item-type='file'][data-item-selected] {
        background: rgb(18 18 18) !important;
        border-color: rgb(38 38 38) !important;
        box-shadow: none !important;
      }

      [data-icon-token],
      [data-icon-token] *,
      [data-item-section='icon'],
      [data-item-section='icon'] :where(svg, path) {
        color: rgb(82 82 82) !important;
        fill: currentColor !important;
        stroke: currentColor !important;
      }

      [data-item-section='content'] {
        color: rgb(163 163 163) !important;
      }

      [data-item-section='decoration'] {
        color: rgb(115 115 115) !important;
        font-variant-numeric: tabular-nums;
      }

      [aria-selected='true'] [data-item-section='content'] {
        color: rgb(245 245 245) !important;
      }

      [aria-selected='true'] [data-item-section='decoration'] {
        color: rgb(163 163 163) !important;
      }
    `
  });
  useEffect(() => {
    fileByPathRef.current = fileByPath;
  }, [fileByPath]);

  useEffect(() => {
    onSelectFileRef.current = onSelectFile;
  }, [onSelectFile]);

  useEffect(() => {
    reviewedFilesRef.current = reviewedFiles;
  }, [reviewedFiles]);

  useEffect(() => {
    model.resetPaths(paths, { preparedInput });
  }, [model, paths, preparedInput]);

  return (
    <PierreFileTree
      model={model}
      className="h-[calc(100vh-194px)] min-h-[280px] overflow-hidden rounded-md bg-transparent"
      style={{ height: "calc(100vh - 194px)", minHeight: 280 }}
    />
  );
}

class PierreSurfaceBoundary extends React.Component<{ children: React.ReactNode; label: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-md border border-red-700/30 bg-red-200/35 px-3 py-2 text-xs text-red-900">
          Pierre {this.props.label} could not render: {this.state.error.message}
        </div>
      );
    }

    return this.props.children;
  }
}

function uniqueTreePaths(paths: Iterable<string>): string[] {
  return [...new Set([...paths].map((path) => path.trim()).filter(Boolean))];
}

function PatchFileHeader({
  file,
  collapsed,
  reviewed,
  reviewCommentCount,
  onToggleCollapsed,
  onToggleReviewed
}: {
  file: PatchFileView;
  collapsed: boolean;
  reviewed: boolean;
  reviewCommentCount: number;
  onToggleCollapsed: () => void;
  onToggleReviewed: () => void;
}) {
  return (
    <div
      className={`pr-file-header ${collapsed ? "pr-file-header-collapsed" : "pr-file-header-open"} ${reviewed ? "text-neutral-600" : ""}`}
    >
      <button
        onClick={onToggleCollapsed}
        className="group flex min-w-0 items-center gap-2 rounded-md text-left outline-none"
        title={collapsed ? "Expand file" : "Collapse file"}
      >
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform group-hover:text-neutral-200 ${collapsed ? "-rotate-90" : ""}`}
        />
        <span className="min-w-0 flex items-baseline gap-2">
          <span className={`truncate font-normal ${reviewed ? "text-neutral-500" : "text-neutral-200"}`}>{file.name}</span>
          {file.directory && (
            <span className="hidden min-w-0 truncate font-normal text-neutral-700 md:inline">{compactDirectory(file.directory)}</span>
          )}
        </span>
      </button>
      <div className="text-right font-mono text-xs">
        {file.additions > 0 && <span className="text-green-900">+{file.additions}</span>}
        {file.additions > 0 && file.deletions > 0 && <span className="text-neutral-700"> </span>}
        {file.deletions > 0 && <span className="text-red-900">-{file.deletions}</span>}
      </div>
      <div className="pr-file-header-comment-count font-mono text-xs text-neutral-600">
        {reviewCommentCount > 0 && (
          <span className="flex items-center justify-end gap-1.5">
            <GitHubCommentIcon className="w-3.5 h-3.5" />
            {reviewCommentCount}
          </span>
        )}
      </div>
      <button
        onClick={onToggleReviewed}
        className={`grid h-[18px] w-[18px] place-items-center rounded border transition-colors ${
          reviewed
            ? "border-green-700/30 bg-green-200/35 text-green-900 hover:border-green-700/50 hover:bg-green-200/50"
            : "border-white/[0.10] bg-transparent text-transparent hover:border-white/[0.22] hover:bg-white/[0.04] hover:text-neutral-300"
        }`}
        title={reviewed ? "Mark as unreviewed" : "Mark as reviewed"}
        aria-label={reviewed ? "Mark as unreviewed" : "Mark as reviewed"}
      >
        <GitHubCheckIcon className="h-3 w-3" />
      </button>
    </div>
  );
}

function PullRequestReviewDrawer({
  draft,
  continuity,
  commentCount,
  submitState,
  submitPending,
  savePending,
  clearPending,
  error,
  diff,
  open,
  onBodyChange,
  onEventChange,
  onOpenChange,
  onSubmit,
  onClear
}: {
  draft: PullRequestReviewDraft;
  continuity: ReviewContinuityCopy;
  commentCount: number;
  submitState: ReturnType<typeof reviewSubmitState>;
  submitPending: boolean;
  savePending: boolean;
  clearPending: boolean;
  error: string | null;
  diff?: PullRequestDiff;
  open: boolean;
  onBodyChange: (body: string) => void;
  onEventChange: (event: PullRequestReviewDraft["event"]) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  onClear: () => void;
}) {
  const hasDraft = Boolean(draft.body.trim() || draft.comments.length > 0 || draft.reviewedFiles.length > 0);
  const expanded = open || hasDraft || Boolean(error) || draft.outdated;
  const statusTone =
    submitState.tone === "danger" ? "text-red-900" : submitState.tone === "warning" ? "text-amber-900" : "text-neutral-500";
  const diffState: CacheStampState | undefined = diff ? (diff.fromCache ? "cached" : "live") : undefined;

  if (!expanded) {
    return (
      <div className="pr-review-strip">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-medium text-neutral-300">Review</span>
          {diffState && <CacheTimestamp cachedAt={diff?.cachedAt} state={diffState} />}
          <span className="truncate text-neutral-600">
            {continuity.hasWork ? continuity.summary : `${commentCount} pending ${commentCount === 1 ? "comment" : "comments"}`}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ToggleGroup
            type="single"
            value={draft.event}
            onValueChange={(event) => {
              if (event) onEventChange(event as PullRequestReviewDraft["event"]);
            }}
            disabled={submitPending || draft.outdated}
            className="pr-review-toggle hidden sm:flex"
          >
            {(["APPROVE", "COMMENT", "REQUEST_CHANGES"] as const).map((event) => (
              <ToggleGroupItem
                key={event}
                value={event}
                title={
                  submitPending
                    ? "Wait for the review submission to finish."
                    : draft.outdated
                      ? "Discard the outdated draft, refresh the PR, then rebuild the review."
                      : `Set review action to ${reviewEventLabel(event).toLowerCase()}.`
                }
                className="h-7 px-2.5 text-xs"
              >
                {reviewEventLabel(event)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <UiButton type="button" onClick={() => onOpenChange(true)} variant="secondary" size="sm">
            {continuity.nextAction}
          </UiButton>
        </div>
      </div>
    );
  }

  return (
    <Surface tone="elevated" className="pr-review-drawer pr-review-panel">
      <div className="pr-review-panel-header">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-neutral-300">
            <span>{continuity.title}</span>
            {diffState && <CacheTimestamp cachedAt={diff?.cachedAt} state={diffState} />}
          </div>
          <div className="mt-0.5 text-xs text-neutral-600">{continuity.summary}</div>
        </div>
        <ToggleGroup
          type="single"
          value={draft.event}
          onValueChange={(event) => {
            if (event) onEventChange(event as PullRequestReviewDraft["event"]);
          }}
          disabled={submitPending || draft.outdated}
          className="pr-review-toggle"
        >
          {(["APPROVE", "COMMENT", "REQUEST_CHANGES"] as const).map((event) => (
            <ToggleGroupItem
              key={event}
              value={event}
              title={
                submitPending
                  ? "Wait for the review submission to finish."
                  : draft.outdated
                    ? "Discard the outdated draft, refresh the PR, then rebuild the review."
                    : `Set review action to ${reviewEventLabel(event).toLowerCase()}.`
              }
              className="h-8 px-3 text-xs"
            >
              {reviewEventLabel(event)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <IdentityRiskNotice repoId={draft.repoId} action="github" className="mx-4 my-2" />
      {draft.outdated && (
        <div className="mx-4 my-2 rounded-md border border-amber-700/30 bg-amber-200/35 px-3 py-2 text-xs text-amber-900">
          This draft was created for an older PR head. Inline comments stay saved locally, but review their line mapping before sending.
        </div>
      )}
      <Textarea
        value={draft.body}
        onChange={(event) => onBodyChange(event.currentTarget.value)}
        disabled={submitPending || draft.outdated}
        title={
          submitPending
            ? "Wait for the review submission to finish."
            : draft.outdated
              ? "Discard the outdated draft, refresh the PR, then rebuild the review."
              : "Write an optional review summary."
        }
        className="pr-review-textarea"
        placeholder="Review summary..."
      />
      {error && <div className="border-t border-red-700/30 bg-red-200/35 px-4 py-2 text-xs text-red-900">{error}</div>}
      <div className="pr-review-footer">
        <span className={`text-xs ${statusTone}`}>
          {savePending ? "Saving draft locally..." : `${submitState.message} ${continuity.sendPreview}`}
        </span>
        <div className="pr-review-footer-actions">
          <UiButton
            type="button"
            onClick={onClear}
            disabled={clearPending || submitPending || !hasDraft}
            variant="ghost"
            size="sm"
            title={
              clearPending
                ? "Clearing the saved review draft..."
                : submitPending
                  ? "Wait for the review submission to finish."
                  : !hasDraft
                    ? "No saved review draft to clear."
                    : draft.outdated
                      ? "Discard the outdated saved review draft."
                      : "Clear the saved review draft."
            }
          >
            {draft.outdated ? "Discard outdated draft" : "Clear draft"}
          </UiButton>
          {!hasDraft && !error && !draft.outdated && (
            <UiButton type="button" onClick={() => onOpenChange(false)} variant="ghost" size="sm">
              Hide
            </UiButton>
          )}
          <UiButton
            type="button"
            onClick={onSubmit}
            disabled={!submitState.canSubmit || submitPending}
            variant="primary"
            size="sm"
            title={submitState.canSubmit ? "Submit this saved review to GitHub." : submitState.message}
          >
            {submitPending ? "Submitting..." : "Submit review"}
          </UiButton>
        </div>
      </div>
    </Surface>
  );
}

function reviewEventLabel(event: PullRequestReviewDraft["event"]): string {
  if (event === "APPROVE") return "Approve";
  if (event === "REQUEST_CHANGES") return "Request changes";
  return "Comment";
}

function reviewWriteBlockReason(pr: PullRequestDetail, repo?: WatchedRepo | null): string | null {
  if (pr.state !== "open" || pr.merged) return "Reviews can only be submitted on open pull requests.";
  if (pr.isDraft) return "Mark the pull request ready for review before submitting a review.";
  if (repo?.permissions && !repo.permissions.push && !repo.permissions.admin) {
    return "This account has read-only access to this repository. Switch accounts or open on GitHub to request access.";
  }
  return null;
}

function ReviewDiffAnnotation({
  annotation,
  repoId,
  login,
  onDraftBodyChange,
  onCancelDraft
}: {
  annotation: DiffLineAnnotation<unknown>;
  repoId: string;
  login?: string;
  onDraftBodyChange: (draft: InlineReviewDraft, body: string) => void;
  onCancelDraft: (draft: InlineReviewDraft) => void;
}) {
  const metadata = annotation.metadata as ReviewAnnotationMetadata;
  const comments = metadata.comments ?? [];
  return (
    <div className="mx-3 my-2 space-y-2">
      {metadata.draft && (
        <InlineReviewComposer
          repoId={repoId}
          login={login}
          draft={metadata.draft}
          onBodyChange={onDraftBodyChange}
          onCancel={onCancelDraft}
        />
      )}
      {comments.map((comment) => (
        <div key={comment.id} className="rounded-[7px] border border-[#2b2c31] bg-[#101113] px-3 py-2 text-sm text-neutral-300">
          <div className="mb-1 flex items-center justify-between gap-3 text-xs text-neutral-500">
            <span className="font-semibold text-neutral-300">{comment.authorLogin ?? "unknown"}</span>
            <span>{comment.createdAt ? formatRelative(comment.createdAt) : "review comment"}</span>
          </div>
          <MarkdownBody value={comment.body} />
        </div>
      ))}
    </div>
  );
}

function InlineReviewComposer({
  repoId,
  login,
  draft,
  onBodyChange,
  onCancel
}: {
  repoId: string;
  login?: string;
  draft: InlineReviewDraft;
  onBodyChange: (draft: InlineReviewDraft, body: string) => void;
  onCancel: (draft: InlineReviewDraft) => void;
}) {
  const trimmedBody = draft.body.trim();
  const lineLabel = draft.startLine && draft.startLine !== draft.line ? `${draft.startLine}-${draft.line}` : String(draft.line);

  return (
    <Surface tone="elevated" className="shadow-[0_12px_32px_rgb(0_0_0_/_0.35)]">
      <div className="flex items-center justify-between border-b border-[var(--border-default)] bg-[var(--surface-raised)] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs text-neutral-500">
          <Avatar seed={login ?? "you"} size="sm" />
          <span className="truncate">
            Comment on <span className="font-mono text-neutral-300">{draft.path}</span>
          </span>
          <span className="rounded-md border border-white/[0.08] bg-black/30 px-1.5 py-0.5 font-mono text-[11px] text-neutral-400">
            {draft.side === "RIGHT" ? "+" : "-"}
            {lineLabel}
          </span>
        </div>
        <div className="pr-inline-actions flex shrink-0 items-center gap-2">
          <RepoIdentityControl repoId={repoId} compact allowApply={false} />
          <button
            onClick={() => onCancel(draft)}
            title="Remove this pending inline review comment."
            aria-label="Remove pending inline review comment"
            className="rounded-md p-1 text-neutral-600 transition-colors hover:bg-white/[0.05] hover:text-neutral-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <IdentityRiskNotice repoId={repoId} action="github" className="mx-3 my-2" />
      <Textarea
        value={draft.body}
        onChange={(event) => onBodyChange(draft, event.currentTarget.value)}
        autoFocus
        className="block w-full min-h-[92px] resize-y bg-transparent px-3 py-3 text-sm leading-6 text-neutral-200 placeholder:text-neutral-600 disabled:opacity-60"
        placeholder="Leave an inline review comment..."
      />
      <div className="flex items-center justify-between gap-3 border-t border-white/[0.07] bg-[#151517] px-3 py-2">
        <span className="text-xs text-neutral-600">{trimmedBody ? "Saved as a pending review comment." : "Draft is saved locally."}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onCancel(draft)}
            title="Remove this pending inline review comment."
            className="h-8 rounded-md px-3 text-sm font-medium text-neutral-500 transition-colors hover:bg-white/[0.05] hover:text-neutral-200 disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      </div>
    </Surface>
  );
}

function compactDirectory(value: string): string {
  const parts = value.split("/").filter(Boolean);
  return parts.slice(-2).join("/");
}

function normalizeInlineReviewDraft(file: PatchFileView, range: SelectedLineRange | null): InlineReviewDraft | null {
  if (!range) return null;
  const diffSide = normalizeDiffSelectionSide(range.endSide ?? range.side);
  const startSide = normalizeDiffSelectionSide(range.side);
  const line = Math.max(range.start, range.end);
  const startLine = Math.min(range.start, range.end);
  const spansSingleSide = diffSide === startSide;
  return {
    id: `draft:${file.id}:${diffSide}:${line}:${Date.now()}`,
    fileId: file.id,
    path: file.path,
    line,
    side: diffSide === "deletions" ? "LEFT" : "RIGHT",
    diffSide,
    ...(spansSingleSide && startLine !== line ? { startLine, startSide: startSide === "deletions" ? "LEFT" : "RIGHT" } : {}),
    body: ""
  };
}

function getDiffTextSelectionPoint(event: PointerEvent): DiffTextSelectionPoint | null {
  let codeElement: HTMLElement | null = null;
  let lineElement: HTMLElement | null = null;
  let source: DiffTextSelectionPoint["source"] | null = null;
  let lineNumber: number | null = null;

  for (const item of event.composedPath()) {
    if (!(item instanceof HTMLElement)) continue;
    if (!lineElement && item.hasAttribute("data-line")) {
      lineElement = item;
      source = "content";
      lineNumber = parseLineNumber(item.getAttribute("data-line"));
      continue;
    }
    if (!lineElement && item.hasAttribute("data-column-number")) {
      lineElement = item;
      source = "gutter";
      lineNumber = parseLineNumber(item.getAttribute("data-column-number"));
      continue;
    }
    if (!codeElement && item.hasAttribute("data-code")) {
      codeElement = item;
    }
  }

  if (!lineElement || !source || !lineNumber) return null;
  return {
    lineNumber,
    source,
    side: getDiffAnnotationSide(lineElement, codeElement)
  };
}

function parseLineNumber(value: string | null): number | null {
  const lineNumber = Number.parseInt(value ?? "", 10);
  return Number.isFinite(lineNumber) && lineNumber > 0 ? lineNumber : null;
}

function getDiffAnnotationSide(lineElement: HTMLElement, codeElement: HTMLElement | null): DiffAnnotationSide {
  const lineType = lineElement.getAttribute("data-line-type");
  if (lineType === "change-deletion") return "deletions";
  if (lineType === "change-addition") return "additions";
  return codeElement?.hasAttribute("data-deletions") ? "deletions" : "additions";
}

function normalizeDiffSelectionSide(side: SelectedLineRange["side"]): DiffAnnotationSide {
  return side === "deletions" ? "deletions" : "additions";
}

function createInlineDraftAnnotation(draft: InlineReviewDraft): DiffLineAnnotation<ReviewAnnotationMetadata> {
  return {
    side: draft.diffSide,
    lineNumber: draft.line,
    metadata: { draft }
  };
}

function buildReviewAnnotations(
  fileDiff: NonNullable<PatchFileView["fileDiff"]>,
  comments: TimelineComment[]
): DiffLineAnnotation<ReviewAnnotationMetadata>[] {
  const byLine = new Map<string, { side: "additions" | "deletions"; lineNumber: number; comments: TimelineComment[] }>();
  for (const comment of comments) {
    if (comment.path !== fileDiff.name && comment.path !== fileDiff.prevName) continue;
    const target = parseReviewCommentTarget(comment.diffHunk);
    if (!target) continue;
    const key = `${target.side}:${target.lineNumber}`;
    const existing = byLine.get(key);
    if (existing) existing.comments.push(comment);
    else byLine.set(key, { ...target, comments: [comment] });
  }

  return [...byLine.values()].map((entry) => ({
    side: entry.side,
    lineNumber: entry.lineNumber,
    metadata: { comments: entry.comments }
  }));
}

function parseReviewCommentTarget(diffHunk: string | null): { side: "additions" | "deletions"; lineNumber: number } | null {
  if (!diffHunk) return null;
  const lines = diffHunk.split("\n");
  const header = lines.find((line) => line.startsWith("@@"));
  const headerMatch = header?.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if (!headerMatch) return null;

  let deletionLine = Number(headerMatch[1]);
  let additionLine = Number(headerMatch[2]);
  let target: { side: "additions" | "deletions"; lineNumber: number } | null = null;

  for (const line of lines.slice(lines.indexOf(header ?? "") + 1)) {
    if (line.startsWith("\\ No newline")) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      target = { side: "additions", lineNumber: additionLine };
      additionLine += 1;
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      target = { side: "deletions", lineNumber: deletionLine };
      deletionLine += 1;
      continue;
    }
    target = { side: "additions", lineNumber: additionLine };
    additionLine += 1;
    deletionLine += 1;
  }

  return target;
}
