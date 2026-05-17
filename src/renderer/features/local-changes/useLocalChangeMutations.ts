import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FallbackCommitTemplate } from "../../../shared/domain/settings";
import type { WatchedRepo } from "../../../shared/domain/watched-repo";
import type { CredentialDiagnosticReport } from "../../../shared/domain/repo-identity";
import type { LocalChangeFile, LocalChangesState, LocalGitConflictState } from "../../../shared/domain/local-git";
import { commitTemplateBody, upsertCommitTemplate } from "../../../shared/commit-templates";
import { rendererQueryKeys, invalidateLocalChangesFreshness } from "../../app/query-freshness";
import { shortSha } from "../../lib/format";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useLocalChangeMutations({
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
}: {
  allStaged: boolean;
  changes?: LocalChangesState;
  commitDescription: string;
  commitIdentityBypassed: boolean;
  commitSummary: string;
  commitTemplateName: string;
  conflictState: LocalGitConflictState | null | undefined;
  repo: WatchedRepo;
  selectedStashFiles: LocalChangeFile[];
  selectedStashMessage: string;
  settings: { commitTemplates?: FallbackCommitTemplate[] };
  stashMessage: string;
  setCommitDescription: (value: string) => void;
  setCommitDialogOpen: (open: boolean) => void;
  setCommitIdentityBypassed: (bypassed: boolean) => void;
  setCommitSummary: (value: string) => void;
  setCommitTemplateName: (value: string) => void;
  setNotice: (value: string | null) => void;
  setOperationDiagnosticsReport: (report: CredentialDiagnosticReport | null) => void;
  setSelectedDiffLineIds: (lineIds: Set<string>) => void;
  setSelectiveStashOpen: (open: boolean) => void;
  setStashMessage: (value: string) => void;
  setStashSelectedPaths: (paths: Set<string>) => void;
  setStashesOpen: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const invalidateLocalChanges = (options: { refreshNetwork?: boolean; refreshRepoShape?: boolean } = {}) =>
    invalidateLocalChangesFreshness(queryClient, repo.id, options);

  const stageFile = useMutation({
    mutationFn: (file: LocalChangeFile) =>
      file.staged && !file.unstaged
        ? window.fallback.repos.unstageLocalFile(repo.id, file.path)
        : window.fallback.repos.stageLocalFile(repo.id, file.path),
    onSuccess: () => invalidateLocalChanges(),
    onError: (mutationError) => setNotice(errorMessage(mutationError))
  });
  const stageAll = useMutation({
    mutationFn: () =>
      allStaged ? window.fallback.repos.unstageAllLocalChanges(repo.id) : window.fallback.repos.stageAllLocalChanges(repo.id),
    onSuccess: () => invalidateLocalChanges(),
    onError: (mutationError) => setNotice(errorMessage(mutationError))
  });
  const discardFile = useMutation({
    mutationFn: (file: LocalChangeFile) => window.fallback.repos.discardLocalFile(repo.id, file.path),
    onSuccess: async (_changes, file) => {
      setNotice(`Discarded changes in ${file.path}.`);
      await invalidateLocalChanges({ refreshRepoShape: true });
    },
    onError: (mutationError) => setNotice(errorMessage(mutationError))
  });
  const applyLocalPatch = useMutation({
    mutationFn: (input: { action: "stage" | "unstage" | "discard"; path: string; patch: string; selectionKind: "hunk" | "lines" }) =>
      window.fallback.repos.applyLocalPatch(repo.id, input),
    onSuccess: async (_changes, input) => {
      setSelectedDiffLineIds(new Set());
      setNotice(
        `${input.action === "stage" ? "Staged" : input.action === "unstage" ? "Unstaged" : "Discarded"} selected ${input.selectionKind}.`
      );
      await invalidateLocalChanges({ refreshRepoShape: input.action === "discard" });
    },
    onError: (mutationError) => setNotice(errorMessage(mutationError))
  });
  const commit = useMutation({
    mutationFn: () =>
      window.fallback.repos.commitLocalChanges(repo.id, {
        summary: commitSummary,
        description: commitDescription,
        bypassIdentityWarning: commitIdentityBypassed
      }),
    onSuccess: async (result) => {
      setNotice(`Committed ${shortSha(result.sha)}: ${result.message}`);
      setCommitSummary("");
      setCommitDescription("");
      setCommitDialogOpen(false);
      setCommitIdentityBypassed(false);
      await invalidateLocalChanges({ refreshNetwork: true, refreshRepoShape: true });
    },
    onError: (mutationError) => setNotice(errorMessage(mutationError))
  });
  const saveRepoCommitTemplate = useMutation({
    mutationFn: async () => {
      const body = commitTemplateBody(commitSummary, commitDescription);
      if (!body) throw new Error("Write a commit draft before saving a template.");
      const name = commitTemplateName.trim() || `${repo.name} commit template`;
      const template: Omit<FallbackCommitTemplate, "createdAt" | "updatedAt"> = {
        id: `repo:${repo.id}:${Date.now()}`,
        name,
        body,
        repoId: repo.id
      };
      return window.fallback.settings.update({
        commitTemplates: upsertCommitTemplate(settings.commitTemplates ?? [], template)
      });
    },
    onSuccess: async (nextSettings) => {
      queryClient.setQueryData(["settings"], nextSettings);
      setCommitTemplateName("");
      setNotice("Commit template saved.");
      await queryClient.invalidateQueries({ queryKey: ["commitTemplates", repo.id] });
    },
    onError: (mutationError) => setNotice(errorMessage(mutationError))
  });
  const stash = useMutation({
    mutationFn: () => window.fallback.repos.stashLocalChanges(repo.id, stashMessage || `WIP: ${changes?.branch ?? repo.name}`),
    onSuccess: async (result) => {
      setNotice(result.createdStashRef ? `Local changes stashed as ${result.createdStashRef}.` : "Local changes stashed.");
      setStashMessage("");
      await invalidateLocalChanges();
      setStashesOpen(true);
    },
    onError: (mutationError) => setNotice(errorMessage(mutationError))
  });
  const stashSelected = useMutation({
    mutationFn: () =>
      window.fallback.repos.stashLocalFiles(
        repo.id,
        selectedStashFiles.map((file) => file.path),
        selectedStashMessage
      ),
    onSuccess: async (result) => {
      setNotice(
        result.createdStashRef
          ? `Stashed ${selectedStashFiles.length} selected ${selectedStashFiles.length === 1 ? "file" : "files"} as ${result.createdStashRef}.`
          : `Stashed ${selectedStashFiles.length} selected ${selectedStashFiles.length === 1 ? "file" : "files"}.`
      );
      setStashSelectedPaths(new Set());
      setSelectiveStashOpen(false);
      setStashMessage("");
      await invalidateLocalChanges();
      setStashesOpen(true);
    },
    onError: (mutationError) => setNotice(errorMessage(mutationError))
  });
  const stashAction = useMutation({
    mutationFn: ({ ref, action }: { ref: string; action: "apply" | "pop" | "drop" }) => {
      if (action === "apply") return window.fallback.repos.applyStash(repo.id, ref);
      if (action === "pop") return window.fallback.repos.popStash(repo.id, ref);
      return window.fallback.repos.dropStash(repo.id, ref);
    },
    onSuccess: async (result, input) => {
      await invalidateLocalChanges({ refreshRepoShape: true });
      if (input.action !== "drop" || result.stashes.length === 0) setStashesOpen(false);
    },
    onError: (mutationError) => setNotice(errorMessage(mutationError))
  });
  const retryOperation = useMutation({
    mutationFn: (kind: string) => {
      if (kind === "stage_all") return window.fallback.repos.stageAllLocalChanges(repo.id);
      if (kind === "unstage_all") return window.fallback.repos.unstageAllLocalChanges(repo.id);
      if (kind === "stash") return window.fallback.repos.stashLocalChanges(repo.id, stashMessage || `WIP: ${changes?.branch ?? repo.name}`);
      if (kind === "stash_files" && selectedStashFiles.length > 0) {
        return window.fallback.repos.stashLocalFiles(
          repo.id,
          selectedStashFiles.map((file) => file.path),
          selectedStashMessage
        );
      }
      throw new Error("This operation cannot be retried from the local changes view.");
    },
    onSuccess: () => invalidateLocalChanges(),
    onError: (mutationError) => setNotice(errorMessage(mutationError))
  });
  const operationDiagnostics = useMutation({
    mutationFn: () => window.fallback.repos.checkCredentials(repo.id),
    onSuccess: (report) => setOperationDiagnosticsReport(report),
    onError: (mutationError) => setNotice(errorMessage(mutationError))
  });
  const cancelOperation = useMutation({
    mutationFn: (operationId: string) => window.fallback.operations.cancel(operationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: rendererQueryKeys.operations(repo.id) });
    },
    onError: (mutationError) => setNotice(errorMessage(mutationError))
  });
  const abortConflict = useMutation({
    mutationFn: () =>
      window.fallback.repos.abortConflict(
        repo.id,
        conflictState?.state && conflictState.state !== "none" ? { state: conflictState.state } : {}
      ),
    onSuccess: async () => {
      setNotice("Active Git operation aborted.");
      await invalidateLocalChanges({ refreshNetwork: true, refreshRepoShape: true });
      await queryClient.invalidateQueries({ queryKey: rendererQueryKeys.conflictState(repo.id) });
    },
    onError: (mutationError) => setNotice(errorMessage(mutationError))
  });
  const openConflictFile = useMutation({
    mutationFn: (path: string) => window.fallback.repos.openConflictFile(repo.id, path),
    onError: (mutationError) => setNotice(errorMessage(mutationError))
  });
  const openMergeTool = useMutation({
    mutationFn: (path: string) => window.fallback.repos.openMergeTool(repo.id, path),
    onSuccess: async () => {
      await invalidateLocalChanges({ refreshNetwork: true, refreshRepoShape: true });
      await queryClient.invalidateQueries({ queryKey: rendererQueryKeys.conflictState(repo.id) });
    },
    onError: (mutationError) => setNotice(errorMessage(mutationError))
  });
  const resolveConflictFile = useMutation({
    mutationFn: (input: { path: string; contents: string }) => window.fallback.repos.resolveConflictFile(repo.id, input),
    onSuccess: async (result, input) => {
      setNotice(result.remainingMarkers ? `Saved partial conflict resolution in ${input.path}.` : `Resolved and staged ${input.path}.`);
      await invalidateLocalChanges({ refreshRepoShape: !result.remainingMarkers });
      await queryClient.invalidateQueries({ queryKey: rendererQueryKeys.conflictState(repo.id) });
    },
    onError: (mutationError) => setNotice(errorMessage(mutationError))
  });
  const applyCommitIdentity = useMutation({
    mutationFn: () => window.fallback.repos.applyLocalGitIdentity(repo.id),
    onSuccess: async () => {
      setCommitIdentityBypassed(false);
      await queryClient.invalidateQueries({ queryKey: rendererQueryKeys.repoIdentity(repo.id) });
    },
    onError: (mutationError) => setNotice(errorMessage(mutationError))
  });

  const busy =
    stageFile.isPending ||
    stageAll.isPending ||
    discardFile.isPending ||
    applyLocalPatch.isPending ||
    commit.isPending ||
    stash.isPending ||
    stashSelected.isPending ||
    stashAction.isPending ||
    resolveConflictFile.isPending ||
    retryOperation.isPending ||
    saveRepoCommitTemplate.isPending ||
    applyCommitIdentity.isPending;
  const conflictBusy = abortConflict.isPending || openConflictFile.isPending || openMergeTool.isPending || resolveConflictFile.isPending;

  return {
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
  };
}
