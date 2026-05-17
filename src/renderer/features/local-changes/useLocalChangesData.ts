import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WatchedRepo } from "../../../shared/domain/watched-repo";
import type { LocalChangeFile, LocalChangesState } from "../../../shared/domain/local-git";
import { fallbackSettings } from "../../app/default-settings";
import { parsePatchFilesForView } from "../../diffs/patch-files";

export function canBlameFile(file: LocalChangeFile | null | undefined): file is LocalChangeFile {
  return Boolean(file && file.status !== "deleted" && file.status !== "untracked" && file.status !== "added");
}

export function useLocalChangesData({
  changes,
  inspectorMode,
  repo,
  selectedFile
}: {
  changes?: LocalChangesState;
  inspectorMode: "history" | "blame" | null;
  repo: WatchedRepo;
  selectedFile: LocalChangeFile | null;
}) {
  const {
    data: selectedPatchData,
    isFetching: selectedPatchFetching,
    error: selectedPatchError
  } = useQuery({
    queryKey: ["localChangePatch", repo.id, selectedFile?.path],
    queryFn: () => window.fallback.repos.localChangePatch(repo.id, selectedFile!.path),
    enabled: Boolean(selectedFile && changes?.isDirty),
    staleTime: 0,
    refetchOnWindowFocus: false
  });
  const patchFiles = useMemo(
    () =>
      parsePatchFilesForView(
        selectedPatchData?.patch ?? "",
        `local:${repo.id}:${selectedPatchData?.path ?? selectedFile?.path ?? "file"}:${selectedPatchData?.generatedAt ?? "pending"}`
      ),
    [repo.id, selectedFile?.path, selectedPatchData?.generatedAt, selectedPatchData?.patch, selectedPatchData?.path]
  );
  const { data: fileHistory, isFetching: historyFetching } = useQuery({
    queryKey: ["localFileHistory", repo.id, selectedFile?.path],
    queryFn: () => window.fallback.repos.fileHistory(repo.id, selectedFile!.path),
    enabled: Boolean(inspectorMode === "history" && selectedFile && repo.localPath),
    staleTime: 30_000
  });
  const { data: fileBlame, isFetching: blameFetching } = useQuery({
    queryKey: ["localFileBlame", repo.id, selectedFile?.path],
    queryFn: () => window.fallback.repos.fileBlame(repo.id, selectedFile!.path),
    enabled: Boolean(inspectorMode === "blame" && canBlameFile(selectedFile) && repo.localPath),
    staleTime: 30_000
  });
  const { data: commitIdentity } = useQuery({
    queryKey: ["repoIdentity", repo.id],
    queryFn: () => window.fallback.repos.getIdentity(repo.id, "local-changes-commit")
  });
  const { data: settings = fallbackSettings } = useQuery({
    queryKey: ["settings"],
    queryFn: window.fallback.settings.get
  });
  const { data: commitTemplates = [] } = useQuery({
    queryKey: ["commitTemplates", repo.id],
    queryFn: () => window.fallback.repos.commitTemplates(repo.id)
  });
  const { data: recentOperations = [] } = useQuery({
    queryKey: ["operations", repo.id],
    queryFn: () => window.fallback.operations.listRecent(repo.id),
    refetchInterval: 30_000
  });
  const { data: conflictState } = useQuery({
    queryKey: ["conflictState", repo.id],
    queryFn: () => window.fallback.repos.conflictState(repo.id),
    enabled: Boolean(repo.localPath),
    refetchInterval: (query) => (query.state.data?.isActive ? 2000 : 15_000)
  });

  return {
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
  };
}
