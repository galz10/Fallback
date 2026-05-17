import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertIcon as GitHubAlertIcon } from "@primer/octicons-react";
import { Archive, GitBranch } from "lucide-react";
import type { OperationRecord } from "../../../shared/domain/operation";
import type { WatchedRepo } from "../../../shared/domain/watched-repo";
import type { CredentialDiagnosticReport } from "../../../shared/domain/repo-identity";
import type { LocalChangeFile, LocalChangesState, LocalGitConflictPreflight } from "../../../shared/domain/local-git";
import { filterLocalChangeFiles, type LocalChangeStageFilter, type LocalChangeStatusFilter } from "../../../shared/local-changes-tree";
import { commitDraftFromTemplate, commitTemplateContext } from "../../../shared/commit-templates";
import { selectiveStashActionState } from "../../../shared/selective-file-stash";
import { commitIdentityPolicy } from "../../../shared/commit-identity-policy";
import { parseLocalPatch, type LocalPatchFile } from "../../../shared/local-diff-patches";
import { useAppPreferencesStore } from "../../state/app-store";
import { OperationStatusPanel, operationReport } from "../../components/OperationStatusPanel";
import { CredentialDiagnosticsDialog } from "../../components/CredentialDiagnosticsDialog";
import { Button } from "../../components/ui/button";
import { InputGroup, InputGroupButton, InputGroupInput } from "../../components/ui/input-group";
import { DiscardLocalChangeDialog } from "./DiscardLocalChangeDialog";
import { conflictReport } from "./ConflictPanels";
import { canBlameFile, useLocalChangesData } from "./useLocalChangesData";
import { ChangedFilesPanel } from "./ChangedFilesPanel";
import { CommitWorkflow } from "./CommitWorkflow";
import { ConflictWorkflow } from "./ConflictWorkflow";
import { DiffInspector } from "./DiffInspector";
import { LocalStashesDialog, SelectiveStashDialog } from "./StashWorkflow";
import { useLocalChangeMutations } from "./useLocalChangeMutations";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const maxDismissedOperationIds = 200;

function dismissedLocalChangeOperationsKey(repoId: string): string {
  return `fallback.localChanges.dismissedOperations.${repoId}`;
}

function readDismissedOperationIds(repoId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(dismissedLocalChangeOperationsKey(repoId)) ?? "[]");
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string").slice(-maxDismissedOperationIds) : []
    );
  } catch {
    return new Set();
  }
}

function writeDismissedOperationIds(repoId: string, operationIds: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      dismissedLocalChangeOperationsKey(repoId),
      JSON.stringify([...operationIds].slice(-maxDismissedOperationIds))
    );
  } catch {
    // Dismissal still works in memory when localStorage is unavailable.
  }
}

function stashRiskConfirmationMessage(risk: LocalGitConflictPreflight, action: "apply" | "pop"): string {
  const overlapFiles = risk.files.filter((file) => file.dirty && file.touchedByTarget).map((file) => file.path);
  const visibleFiles = overlapFiles.length > 0 ? overlapFiles : risk.files.map((file) => file.path);
  const fileLines = visibleFiles.slice(0, 8).map((filePath) => `- ${filePath}`);
  const remainingCount = Math.max(0, visibleFiles.length - fileLines.length);
  const files =
    fileLines.length > 0
      ? `\n\nOverlapping dirty files:\n${fileLines.join("\n")}${remainingCount > 0 ? `\n- and ${remainingCount} more` : ""}`
      : "\n\nFallback did not receive file-level overlap details for this warning.";
  const actionLabel = action === "pop" ? "unstash" : "apply";
  const actionDetail =
    action === "pop" ? "Unstash applies the stash and drops it after a successful apply." : "Apply keeps the stash after applying it.";
  return `${risk.summary}${files}\n\n${actionDetail} Overlapping files can enter conflict state. Continue with ${actionLabel}?`;
}

export function LocalChangesView({
  repo,
  changes,
  error,
  loading,
  commitPrefill,
  onCommitPrefillApplied
}: {
  repo: WatchedRepo;
  changes?: LocalChangesState;
  error: unknown;
  loading: boolean;
  commitPrefill: { summary: string; token: string } | null;
  onCommitPrefillApplied: () => void;
}) {
  const fileDisplayMode = useAppPreferencesStore((s) => s.localChangesDisplayMode);
  const setFileDisplayMode = useAppPreferencesStore((s) => s.setLocalChangesDisplayMode);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [stashSelectedPaths, setStashSelectedPaths] = useState<Set<string>>(() => new Set());
  const [commitSummary, setCommitSummary] = useState("");
  const [commitDescription, setCommitDescription] = useState("");
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [selectedCommitTemplateId, setSelectedCommitTemplateId] = useState("");
  const [commitTemplateName, setCommitTemplateName] = useState("");
  const [commitIdentityBypassed, setCommitIdentityBypassed] = useState(false);
  const [stashMessage, setStashMessage] = useState("");
  const [selectiveStashOpen, setSelectiveStashOpen] = useState(false);
  const [stashesOpen, setStashesOpen] = useState(false);
  const [discardTarget, setDiscardTarget] = useState<LocalChangeFile | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [operationDiagnosticsReport, setOperationDiagnosticsReport] = useState<CredentialDiagnosticReport | null>(null);
  const [dismissedOperationIds, setDismissedOperationIds] = useState<Set<string>>(() => readDismissedOperationIds(repo.id));
  const [fileFilter, setFileFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<LocalChangeStatusFilter>("all");
  const [stageFilter, setStageFilter] = useState<LocalChangeStageFilter>("all");
  const [diffSearch, setDiffSearch] = useState("");
  const [patchActionsOpen, setPatchActionsOpen] = useState(false);
  const [selectedDiffLineIds, setSelectedDiffLineIds] = useState<Set<string>>(() => new Set());
  const [inspectorMode, setInspectorMode] = useState<"history" | "blame" | null>(null);
  const files = useMemo(() => changes?.files ?? [], [changes?.files]);
  const filteredFiles = useMemo(
    () => filterLocalChangeFiles(files, { query: fileFilter, status: statusFilter, stage: stageFilter }),
    [fileFilter, files, stageFilter, statusFilter]
  );
  const selectedStashFiles = useMemo(() => files.filter((file) => stashSelectedPaths.has(file.path)), [files, stashSelectedPaths]);
  const selectedStashMessage = stashMessage || `WIP: ${changes?.branch ?? repo.name}`;
  const selectedFile =
    filteredFiles.find((file) => file.path === selectedPath) ??
    (filteredFiles.length > 0 ? filteredFiles[0] : null) ??
    files.find((file) => file.path === selectedPath) ??
    files[0] ??
    null;
  const {
    blameFetching,
    commitIdentity,
    commitTemplates,
    conflictState,
    fileBlame,
    fileHistory,
    historyFetching,
    patchFiles,
    recentOperations,
    selectedPatchData,
    selectedPatchError,
    selectedPatchFetching,
    settings
  } = useLocalChangesData({ changes, inspectorMode, repo, selectedFile });
  const visibleOperations = useMemo(
    () => recentOperations.filter((operation) => !dismissedOperationIds.has(operation.id)),
    [dismissedOperationIds, recentOperations]
  );
  useEffect(() => {
    setDismissedOperationIds(readDismissedOperationIds(repo.id));
  }, [repo.id]);
  const dismissOperation = useCallback(
    (operation: OperationRecord) => {
      setDismissedOperationIds((current) => {
        if (current.has(operation.id)) return current;
        const next = new Set([...current, operation.id].slice(-maxDismissedOperationIds));
        writeDismissedOperationIds(repo.id, next);
        return next;
      });
    },
    [repo.id]
  );
  const selectedPatch = selectedFile
    ? (patchFiles.find((file) => file.path === selectedFile.path || file.previousPath === selectedFile.path) ?? patchFiles[0] ?? null)
    : null;
  const selectedFilePath = selectedFile?.path ?? null;
  const selectedStagedPatch = selectedPatchData?.stagedPatch ?? null;
  const selectedUnstagedPatch = selectedPatchData?.unstagedPatch ?? null;
  const selectedPatchModels = useMemo(
    () => ({
      staged: selectedStagedPatch
        ? (parseLocalPatch(selectedStagedPatch).find((file) => file.path === selectedFilePath || file.previousPath === selectedFilePath) ??
          null)
        : null,
      unstaged: selectedUnstagedPatch
        ? (parseLocalPatch(selectedUnstagedPatch).find(
            (file) => file.path === selectedFilePath || file.previousPath === selectedFilePath
          ) ?? null)
        : null
    }),
    [selectedFilePath, selectedStagedPatch, selectedUnstagedPatch]
  );
  const selectedFileIndex = selectedFile ? filteredFiles.findIndex((file) => file.path === selectedFile.path) : -1;
  const selectedFilePosition = selectedFileIndex >= 0 ? `${selectedFileIndex + 1}/${filteredFiles.length}` : null;
  const allStaged = files.length > 0 && files.every((file) => file.staged && !file.unstaged);
  const stagedCount = files.filter((file) => file.staged).length;
  const commitIdentityState = commitIdentityPolicy(commitIdentity);
  const commitIdentityEffectiveState = commitIdentityPolicy(commitIdentity, { bypassed: commitIdentityBypassed });
  const selectedCommitTemplate = commitTemplates.find((template) => template.id === selectedCommitTemplateId) ?? commitTemplates[0] ?? null;
  const canCommit = stagedCount > 0 && commitSummary.trim().length > 0 && commitIdentityEffectiveState.status === "ok";
  useEffect(() => {
    if (selectedFile && selectedFile.path !== selectedPath) setSelectedPath(selectedFile.path);
    if (!selectedFile && selectedPath) setSelectedPath(null);
  }, [selectedFile, selectedPath]);

  useEffect(() => {
    if (inspectorMode === "blame" && selectedFile && !canBlameFile(selectedFile)) setInspectorMode(null);
  }, [inspectorMode, selectedFile]);

  useEffect(() => {
    setSelectedDiffLineIds(new Set());
    setDiffSearch("");
  }, [selectedFile?.path]);

  useEffect(() => {
    const availablePaths = new Set(files.map((file) => file.path));
    setStashSelectedPaths((current) => {
      const next = new Set([...current].filter((filePath) => availablePaths.has(filePath)));
      return next.size === current.size ? current : next;
    });
  }, [files]);

  useEffect(() => {
    if (!commitPrefill) return;
    setCommitSummary(commitPrefill.summary);
    onCommitPrefillApplied();
  }, [commitPrefill, onCommitPrefillApplied]);

  useEffect(() => {
    if (selectedCommitTemplateId && commitTemplates.some((template) => template.id === selectedCommitTemplateId)) return;
    setSelectedCommitTemplateId(commitTemplates[0]?.id ?? "");
  }, [commitTemplates, selectedCommitTemplateId]);

  const {
    abortConflict,
    applyCommitIdentity,
    applyLocalPatch,
    busy,
    cancelOperation,
    commit,
    conflictBusy,
    discardFile,
    operationDiagnostics,
    openConflictFile,
    openMergeTool,
    resolveConflictFile,
    retryOperation,
    saveRepoCommitTemplate,
    stageAll,
    stageFile,
    stash,
    stashAction,
    stashSelected
  } = useLocalChangeMutations({
    allStaged,
    changes,
    commitDescription,
    commitIdentityBypassed,
    commitSummary,
    commitTemplateName,
    conflictState,
    repo,
    selectedStashFiles,
    selectedStashMessage,
    settings,
    stashMessage,
    setCommitDescription,
    setCommitDialogOpen,
    setCommitIdentityBypassed,
    setCommitSummary,
    setCommitTemplateName,
    setNotice,
    setOperationDiagnosticsReport,
    setSelectedDiffLineIds,
    setSelectiveStashOpen,
    setStashMessage,
    setStashSelectedPaths,
    setStashesOpen
  });
  const copyOperationReport = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setNotice("Copied operation report.");
  };
  const copyConflictReport = async () => {
    if (conflictState?.isActive) {
      await navigator.clipboard.writeText(conflictReport(conflictState));
      setNotice("Copied conflict diagnostics.");
    }
  };
  const applyCommitTemplate = () => {
    if (!selectedCommitTemplate) return;
    const draft = commitDraftFromTemplate(
      selectedCommitTemplate,
      commitTemplateContext({
        summary: commitSummary,
        branch: changes?.branch,
        repoFullName: repo.fullName,
        identity: commitIdentity
      })
    );
    setCommitSummary(draft.summary);
    setCommitDescription(draft.description);
  };
  const selectiveStashAction = selectiveStashActionState({
    selectedCount: selectedStashFiles.length,
    busy,
    isDirty: Boolean(changes?.isDirty)
  });
  const busyActionReason = "Wait for the current local changes operation to finish.";
  const commitBlockReason = busy
    ? busyActionReason
    : stagedCount === 0
      ? "Stage at least one file before committing."
      : !commitSummary.trim()
        ? "Add a commit summary before committing."
        : commitIdentityEffectiveState.status !== "ok"
          ? [commitIdentityEffectiveState.message, commitIdentityEffectiveState.action].filter(Boolean).join(" ")
          : null;
  const selectReviewNeighbor = useCallback(
    (path: string, direction: 1 | -1 = 1) => {
      if (filteredFiles.length === 0) {
        setSelectedPath(null);
        return;
      }
      if (filteredFiles.length === 1) {
        if (filteredFiles[0]?.path === path) setSelectedPath(null);
        return;
      }
      const index = filteredFiles.findIndex((file) => file.path === path);
      if (index === -1) {
        setSelectedPath(filteredFiles[0]?.path ?? null);
        return;
      }
      const nextIndex = direction > 0 ? (index < filteredFiles.length - 1 ? index + 1 : index - 1) : index > 0 ? index - 1 : index + 1;
      setSelectedPath(filteredFiles[nextIndex]?.path ?? null);
    },
    [filteredFiles]
  );
  const selectAdjacentFile = useCallback(
    (direction: 1 | -1) => {
      if (selectedFileIndex < 0) return;
      const nextIndex = selectedFileIndex + direction;
      if (nextIndex < 0 || nextIndex >= filteredFiles.length) return;
      setSelectedPath(filteredFiles[nextIndex]?.path ?? null);
    },
    [filteredFiles, selectedFileIndex]
  );
  const handleStageFile = useCallback(
    (file: LocalChangeFile) => {
      if (stageFilter !== "all") selectReviewNeighbor(file.path);
      stageFile.mutate(file);
    },
    [selectReviewNeighbor, stageFile, stageFilter]
  );
  const handleDiscardFile = useCallback(
    (file: LocalChangeFile) => {
      selectReviewNeighbor(file.path);
      discardFile.mutate(file);
    },
    [discardFile, selectReviewNeighbor]
  );
  const confirmDiscard = (file: LocalChangeFile) => setDiscardTarget(file);
  const toggleStashSelection = (file: LocalChangeFile) => {
    setStashSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(file.path)) next.delete(file.path);
      else next.add(file.path);
      return next;
    });
  };
  const clearStashSelection = () => setStashSelectedPaths(new Set());
  const applyPatchSelection = (
    action: "stage" | "unstage" | "discard",
    file: LocalPatchFile,
    patch: string,
    selectionKind: "hunk" | "lines"
  ) => {
    if (
      action === "discard" &&
      !window.confirm(
        `Discard selected ${selectionKind} in ${file.path}?\n\nFallback will record recovery metadata before applying the reverse patch.`
      )
    ) {
      return;
    }
    applyLocalPatch.mutate({ action, path: file.path, patch, selectionKind });
  };
  const handleStashAction = async (ref: string, action: "apply" | "pop" | "drop") => {
    if (action === "drop") {
      if (!window.confirm(`Drop ${ref}?\n\nThis removes the saved stash entry from this repository.`)) return;
      stashAction.mutate({ ref, action });
      return;
    }

    if (!changes?.isDirty) {
      stashAction.mutate({ ref, action });
      return;
    }

    try {
      const risk = await window.fallback.repos.conflictPreflight(repo.id, {
        operation: action === "pop" ? "stash_pop" : "stash_apply",
        stashRef: ref
      });
      if ((risk.riskLevel === "medium" || risk.riskLevel === "high") && !window.confirm(stashRiskConfirmationMessage(risk, action))) {
        return;
      }
      stashAction.mutate({ ref, action });
    } catch (stashError) {
      setNotice(errorMessage(stashError));
    }
  };
  const stashButton = changes ? (
    <button
      onClick={() => setStashesOpen(true)}
      disabled={busy}
      title={busy ? busyActionReason : "View and manage local stashes"}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-800 bg-black/30 px-2.5 text-xs font-medium text-neutral-400 transition-colors hover:border-neutral-700 hover:bg-neutral-900 hover:text-neutral-200 disabled:opacity-50"
    >
      <Archive className="h-3.5 w-3.5" />
      Stashes
      <span className="ml-2 font-mono text-[12px] text-neutral-600">{changes.stashes.length}</span>
    </button>
  ) : null;
  const conflictWorkflow = (
    <ConflictWorkflow
      conflictState={conflictState}
      stashConflictRisk={null}
      busy={busy || conflictBusy}
      onOpenFile={(path) => openConflictFile.mutate(path)}
      onOpenMergeTool={(path) => openMergeTool.mutate(path)}
      onAbort={() => {
        if (window.confirm("Abort the active Git operation?\n\nGit will try to return this workspace to the pre-operation state.")) {
          abortConflict.mutate();
        }
      }}
      onCopy={copyConflictReport}
    />
  );

  if (loading) {
    return <div className="py-16 text-center text-sm text-neutral-500">Loading local changes...</div>;
  }

  if (error && !changes) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-[#0A0A0A] p-3 text-sm text-neutral-100">
        <GitHubAlertIcon className="h-4 w-4 text-red-300" />
        <span>{errorMessage(error)}</span>
      </div>
    );
  }

  if (!changes || (!changes.isDirty && changes.stashes.length === 0)) {
    return (
      <div className="space-y-5">
        {operationDiagnosticsReport && (
          <CredentialDiagnosticsDialog report={operationDiagnosticsReport} onClose={() => setOperationDiagnosticsReport(null)} />
        )}
        <OperationStatusPanel
          operations={visibleOperations}
          onCancel={(operation) => cancelOperation.mutate(operation.id)}
          onCopyReport={(operation) => void copyOperationReport(operationReport(operation))}
          onDismiss={dismissOperation}
          onOpenDiagnostics={() => operationDiagnostics.mutate()}
          onRetry={(operation) => retryOperation.mutate(operation.kind)}
        />
        {conflictWorkflow}
        {notice && (
          <div className="flex items-center justify-between rounded-lg border border-neutral-800 bg-[#0A0A0A] px-3 py-2 text-sm text-neutral-300">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="text-neutral-500 transition-colors hover:text-white">
              Dismiss
            </button>
          </div>
        )}
        <div className="py-16 text-center">
          <p className="mb-2 text-lg font-medium text-white">No local changes</p>
          <p className="text-sm text-neutral-500">This workspace is clean.</p>
        </div>
      </div>
    );
  }

  if (!changes.isDirty) {
    return (
      <div className="space-y-5">
        {operationDiagnosticsReport && (
          <CredentialDiagnosticsDialog report={operationDiagnosticsReport} onClose={() => setOperationDiagnosticsReport(null)} />
        )}
        {discardTarget && (
          <DiscardLocalChangeDialog
            repoId={repo.id}
            file={discardTarget}
            pending={discardFile.isPending}
            onClose={() => setDiscardTarget(null)}
            onConfirm={() => {
              handleDiscardFile(discardTarget);
              setDiscardTarget(null);
            }}
          />
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-900 pb-4">
          <div className="flex min-w-0 items-center gap-2 text-[13px] text-neutral-500">
            <span className="font-mono text-neutral-300">{changes.branch}</span>
            <span className="text-neutral-700">/</span>
            <span>Worktree clean</span>
          </div>
          {stashButton}
        </div>
        {stashesOpen && (
          <LocalStashesDialog
            repoId={repo.id}
            stashes={changes.stashes}
            isDirty={changes.isDirty}
            currentBranch={changes.branch}
            busy={busy}
            onClose={() => setStashesOpen(false)}
            onAction={(ref, action) => void handleStashAction(ref, action)}
          />
        )}
        <OperationStatusPanel
          operations={visibleOperations}
          onCancel={(operation) => cancelOperation.mutate(operation.id)}
          onCopyReport={(operation) => void copyOperationReport(operationReport(operation))}
          onDismiss={dismissOperation}
          onOpenDiagnostics={() => operationDiagnostics.mutate()}
          onRetry={(operation) => retryOperation.mutate(operation.kind)}
        />
        {conflictWorkflow}
        {notice && (
          <div className="flex items-center justify-between rounded-lg border border-neutral-800 bg-[#0A0A0A] px-3 py-2 text-sm text-neutral-300">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="text-neutral-500 transition-colors hover:text-white">
              Dismiss
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {operationDiagnosticsReport && (
        <CredentialDiagnosticsDialog report={operationDiagnosticsReport} onClose={() => setOperationDiagnosticsReport(null)} />
      )}
      {discardTarget && (
        <DiscardLocalChangeDialog
          repoId={repo.id}
          file={discardTarget}
          pending={discardFile.isPending}
          onClose={() => setDiscardTarget(null)}
          onConfirm={() => {
            handleDiscardFile(discardTarget);
            setDiscardTarget(null);
          }}
        />
      )}
      {selectiveStashOpen && changes && (
        <SelectiveStashDialog
          branch={changes.branch}
          files={selectedStashFiles}
          message={selectedStashMessage}
          pending={stashSelected.isPending}
          onClose={() => setSelectiveStashOpen(false)}
          onConfirm={() => stashSelected.mutate()}
        />
      )}
      <CommitWorkflow
        open={commitDialogOpen}
        repoId={repo.id}
        branch={changes.branch}
        filesCount={files.length}
        stagedCount={stagedCount}
        busy={busy}
        canCommit={canCommit}
        commitBlockReason={commitBlockReason}
        commitDescription={commitDescription}
        commitIdentity={commitIdentity}
        commitIdentityBypassed={commitIdentityBypassed}
        commitIdentityState={commitIdentityState}
        commitPending={commit.isPending}
        commitSummary={commitSummary}
        commitTemplates={commitTemplates}
        selectedTemplate={selectedCommitTemplate}
        templateName={commitTemplateName}
        applyIdentityPending={applyCommitIdentity.isPending}
        onApplyIdentity={() => applyCommitIdentity.mutate()}
        onApplyTemplate={applyCommitTemplate}
        onCommit={() => commit.mutate()}
        onCommitDescriptionChange={setCommitDescription}
        onCommitIdentityBypassedChange={setCommitIdentityBypassed}
        onCommitSummaryChange={setCommitSummary}
        onOpenChange={setCommitDialogOpen}
        onSaveTemplate={() => saveRepoCommitTemplate.mutate()}
        onSelectedTemplateIdChange={setSelectedCommitTemplateId}
        onTemplateNameChange={setCommitTemplateName}
      />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-900 pb-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5 text-[12px] text-neutral-500">
          <span className="inline-flex items-center gap-1.5 font-mono text-neutral-300">
            <GitBranch className="h-3 w-3 text-neutral-600" />
            {changes.branch}
          </span>
          <span className="h-3 w-px bg-neutral-800" />
          <span className="text-neutral-500">{files.length} changed</span>
          <span className="inline-flex items-center gap-1 font-mono">
            {changes.additions > 0 && <span style={{ color: "#3fb950" }}>+{changes.additions}</span>}
            {changes.deletions > 0 && <span style={{ color: "#ff7b72" }}>-{changes.deletions}</span>}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {stashButton}
          {selectedStashFiles.length > 0 && (
            <button
              onClick={() => setSelectiveStashOpen(true)}
              disabled={!selectiveStashAction.enabled}
              title={
                selectiveStashAction.enabled
                  ? selectiveStashAction.label
                  : busy
                    ? busyActionReason
                    : "Select one or more changed files before stashing selected files."
              }
              className="h-8 rounded-md border border-neutral-700 bg-neutral-900 px-2.5 text-xs font-medium text-neutral-200 transition-colors hover:border-neutral-600 hover:bg-neutral-800 disabled:opacity-50"
            >
              {selectiveStashAction.label}
            </button>
          )}
          <InputGroup className="h-8 w-auto bg-black">
            <InputGroupInput
              aria-label="Stash message"
              value={stashMessage}
              onChange={(event) => setStashMessage(event.currentTarget.value)}
              placeholder="Stash message"
              className="w-48 text-[13px]"
            />
            <InputGroupButton
              onClick={() => stash.mutate()}
              disabled={busy}
              title={busy ? busyActionReason : "Stash all current local changes"}
            >
              {stash.isPending ? "Stashing..." : "Stash"}
            </InputGroupButton>
          </InputGroup>
          <Button
            type="button"
            onClick={() => setCommitDialogOpen(true)}
            disabled={busy}
            title={busy ? busyActionReason : "Open commit composer"}
            className="h-8 bg-white px-3 text-[13px] font-medium text-black hover:bg-neutral-200 disabled:bg-neutral-900 disabled:text-neutral-600 disabled:opacity-100"
          >
            Commit...
          </Button>
        </div>
      </div>

      {stashesOpen && (
        <LocalStashesDialog
          repoId={repo.id}
          stashes={changes.stashes}
          isDirty={changes.isDirty}
          currentBranch={changes.branch}
          busy={busy}
          onClose={() => setStashesOpen(false)}
          onAction={(ref, action) => void handleStashAction(ref, action)}
        />
      )}

      {notice && (
        <div className="flex items-center justify-between rounded-lg border border-neutral-800 bg-[#0A0A0A] px-3 py-2 text-sm text-neutral-300">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-neutral-500 transition-colors hover:text-white">
            Dismiss
          </button>
        </div>
      )}
      {conflictWorkflow}
      <OperationStatusPanel
        operations={visibleOperations}
        onCancel={(operation) => cancelOperation.mutate(operation.id)}
        onCopyReport={(operation) => void copyOperationReport(operationReport(operation))}
        onDismiss={dismissOperation}
        onOpenDiagnostics={() => operationDiagnostics.mutate()}
        onRetry={(operation) => retryOperation.mutate(operation.kind)}
      />
      <div className="grid min-h-[620px] overflow-hidden rounded-lg border border-neutral-800 bg-[#050505] shadow-[0_1px_0_rgba(255,255,255,0.035)_inset] xl:grid-cols-[292px_minmax(0,1fr)]">
        <ChangedFilesPanel
          allStaged={allStaged}
          busy={busy}
          busyActionReason={busyActionReason}
          displayMode={fileDisplayMode}
          files={files}
          filteredFiles={filteredFiles}
          selectedFile={selectedFile}
          selectedStashFiles={selectedStashFiles}
          selectedStashPaths={stashSelectedPaths}
          stagedCount={stagedCount}
          stageFilter={stageFilter}
          statusFilter={statusFilter}
          query={fileFilter}
          onClearStashSelection={clearStashSelection}
          onDiscard={confirmDiscard}
          onDisplayModeChange={setFileDisplayMode}
          onQueryChange={setFileFilter}
          onSelectPath={setSelectedPath}
          onStageAll={() => stageAll.mutate()}
          onStageFilterChange={setStageFilter}
          onStatusFilterChange={setStatusFilter}
          onToggleStage={handleStageFile}
          onToggleStashSelection={toggleStashSelection}
        />

        <DiffInspector
          blame={fileBlame}
          blameFetching={blameFetching}
          busy={busy}
          file={selectedFile}
          history={fileHistory}
          historyFetching={historyFetching}
          inspectorMode={inspectorMode}
          patch={selectedPatchData ?? null}
          patchActionsOpen={patchActionsOpen}
          positionLabel={selectedFilePosition}
          repoPath={repo.localPath}
          search={diffSearch}
          selectedLineIds={selectedDiffLineIds}
          selectedPatch={selectedPatch}
          selectedPatchError={selectedPatchError}
          selectedPatchFetching={selectedPatchFetching}
          staged={selectedPatchModels.staged}
          canSelectNext={selectedFileIndex >= 0 && selectedFileIndex < filteredFiles.length - 1}
          canSelectPrevious={selectedFileIndex > 0}
          unstaged={selectedPatchModels.unstaged}
          onApply={applyPatchSelection}
          onClearLines={() => setSelectedDiffLineIds(new Set())}
          onDiscard={confirmDiscard}
          onInspectorModeChange={setInspectorMode}
          onPatchActionsOpenChange={setPatchActionsOpen}
          onResolveConflictFile={(path, contents) => resolveConflictFile.mutate({ path, contents })}
          onSearchChange={setDiffSearch}
          onSelectNext={() => selectAdjacentFile(1)}
          onSelectPrevious={() => selectAdjacentFile(-1)}
          onToggleLine={(lineId) =>
            setSelectedDiffLineIds((current) => {
              const next = new Set(current);
              if (next.has(lineId)) next.delete(lineId);
              else next.add(lineId);
              return next;
            })
          }
        />
      </div>
    </div>
  );
}
