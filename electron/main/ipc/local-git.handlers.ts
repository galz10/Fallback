import { shell } from "electron";
import type {
  LocalCommitInput,
  LocalGitConflictAbortInput,
  LocalGitConflictPreflightInput,
  LocalGitConflictResolveInput,
  LocalGitPublishInput,
  LocalGitPullInput,
  LocalPatchApplyInput
} from "../../../src/shared/domain/local-git.js";
import type { AppServices } from "../app-services.js";
import { LocalGitOperations } from "../modules/local-git/local-git-operations.js";
import { createIpcHandlerRegistrar } from "./ipc-handler-registry.js";
import {
  assertGitBranchName,
  assertGitCommitSha,
  assertGitRefName,
  assertGitRemoteName,
  assertGitStashRef,
  assertOptionalString,
  assertRepoRelativePath,
  assertString,
  assertStringArray
} from "./validation.js";

export function registerLocalGitHandlers(services: AppServices): void {
  const ipc = createIpcHandlerRegistrar(services);
  const operations = new LocalGitOperations(services);

  ipc.handle("reposApplyLocalGitIdentity", async (_event, repoId: string) => {
    const id = assertString(repoId, "Repo ID");
    return operations.applyRepoIdentity(id);
  });

  ipc.handle("operationsListRecent", async (_event, repoId?: string) =>
    services.operations.listRecent(assertOptionalString(repoId, "Repo ID"))
  );
  ipc.handle("operationsCancel", async (_event, operationId: string) =>
    services.operations.cancel(assertString(operationId, "Operation ID"))
  );
  ipc.handle("reposLocalChanges", async (_event, repoId: string) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) => services.localGit.changes(id))
  );
  ipc.handle("reposLocalChangesOverview", async (_event, repoId: string) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) => services.localGit.changesOverview(id))
  );
  ipc.handle("reposLocalChangePatch", async (_event, repoId: string, path: string) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) =>
      services.localGit.changePatch(id, assertRepoRelativePath(path, "Path"))
    )
  );
  ipc.handle("reposLocalChangesSummary", async (_event, repoIds?: string[], options?: { includeStats?: boolean }) =>
    services.localGit.changesSummary(Array.isArray(repoIds) ? assertStringArray(repoIds, "Repo IDs") : undefined, {
      includeStats: options?.includeStats !== false
    })
  );
  ipc.handle("reposApplyLocalPatch", async (_event, repoId: string, input: LocalPatchApplyInput) => {
    const id = assertString(repoId, "Repo ID");
    const patchInput = validatePatchApplyInput(input);
    return operations.applyLocalPatch(id, patchInput);
  });
  ipc.handle("reposFileHistory", async (_event, repoId: string, path: string) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) =>
      services.localGit.fileHistory(id, assertRepoRelativePath(path, "Path"))
    )
  );
  ipc.handle("reposFileBlame", async (_event, repoId: string, path: string) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) =>
      services.localGit.fileBlame(id, assertRepoRelativePath(path, "Path"))
    )
  );
  ipc.handle("reposCommitGraph", async (_event, repoId: string, options?: { limit?: number; sinceDays?: number }) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) => services.commitGraph.graph(id, options))
  );
  ipc.handle("reposCommitGraphPatch", async (_event, repoId: string, sha: string) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) => services.commitGraph.patch(id, assertGitCommitSha(sha)))
  );
  ipc.handle("reposGitNetworkPreflight", async (_event, repoId: string) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) => services.localGit.gitNetworkPreflight(id))
  );
  ipc.handle("reposFetchWorkspace", async (_event, repoId: string) => {
    const id = assertString(repoId, "Repo ID");
    return operations.fetchWorkspace(id);
  });
  ipc.handle("reposPullWorkspace", async (_event, repoId: string, input?: LocalGitPullInput) => {
    const id = assertString(repoId, "Repo ID");
    const pullInput = assertPullInput(input);
    return operations.pullWorkspace(id, pullInput);
  });
  ipc.handle("reposPushWorkspace", async (_event, repoId: string) => {
    const id = assertString(repoId, "Repo ID");
    return operations.pushWorkspace(id);
  });
  ipc.handle("reposPublishWorkspace", async (_event, repoId: string, input?: LocalGitPublishInput) => {
    const id = assertString(repoId, "Repo ID");
    const publishInput = assertPublishInput(input);
    return operations.publishWorkspace(id, publishInput);
  });
  ipc.handle("reposConflictPreflight", async (_event, repoId: string, input: LocalGitConflictPreflightInput) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) => services.localGit.conflictPreflight(id, assertConflictInput(input)))
  );
  ipc.handle("reposConflictState", async (_event, repoId: string) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) => services.localGit.conflictState(id))
  );
  ipc.handle("reposAbortConflict", async (_event, repoId: string, input?: LocalGitConflictAbortInput) => {
    const id = assertString(repoId, "Repo ID");
    return operations.abortConflict(id, assertConflictAbortInput(input));
  });
  ipc.handle("reposResolveConflictFile", async (_event, repoId: string, input: LocalGitConflictResolveInput) => {
    const id = assertString(repoId, "Repo ID");
    return operations.resolveConflictFile(id, assertConflictResolveInput(input));
  });
  ipc.handle("reposOpenConflictFile", async (_event, repoId: string, path: string) => {
    const id = assertString(repoId, "Repo ID");
    services.database.localCache.repos.requireRepoVisibleToActiveAccount(id);
    const filePath = await services.localGit.conflictFilePath(id, assertRepoRelativePath(path, "Path"));
    const error = await shell.openPath(filePath);
    if (error) throw new Error(error);
  });
  ipc.handle("reposOpenMergeTool", async (_event, repoId: string, path: string) => {
    const id = assertString(repoId, "Repo ID");
    const filePath = assertRepoRelativePath(path, "Path");
    return operations.openMergeTool(id, filePath);
  });
  ipc.handle("reposStageLocalFile", async (_event, repoId: string, path: string) => {
    const id = assertString(repoId, "Repo ID");
    const filePath = assertRepoRelativePath(path, "Path");
    return operations.stageFile(id, filePath);
  });
  ipc.handle("reposUnstageLocalFile", async (_event, repoId: string, path: string) => {
    const id = assertString(repoId, "Repo ID");
    const filePath = assertRepoRelativePath(path, "Path");
    return operations.unstageFile(id, filePath);
  });
  ipc.handle("reposStageAllLocalChanges", async (_event, repoId: string) => {
    const id = assertString(repoId, "Repo ID");
    return operations.stageAll(id);
  });
  ipc.handle("reposUnstageAllLocalChanges", async (_event, repoId: string) => {
    const id = assertString(repoId, "Repo ID");
    return operations.unstageAll(id);
  });
  ipc.handle("reposDiscardLocalFile", async (_event, repoId: string, path: string) => {
    const id = assertString(repoId, "Repo ID");
    const filePath = assertRepoRelativePath(path, "Path");
    return operations.discardFile(id, filePath);
  });
  ipc.handle("reposRevertCommit", async (_event, repoId: string, sha: string) => {
    const id = assertString(repoId, "Repo ID");
    const commitSha = assertGitCommitSha(sha);
    return operations.revertCommit(id, commitSha);
  });
  ipc.handle("reposCommitLocalChanges", async (_event, repoId: string, input: LocalCommitInput) => {
    const id = assertString(repoId, "Repo ID");
    return operations.commit(id, input);
  });
  ipc.handle("reposStashLocalChanges", async (_event, repoId: string, message?: string) => {
    const id = assertString(repoId, "Repo ID");
    const stashMessage = assertOptionalString(message, "Stash message");
    return operations.stash(id, stashMessage);
  });
  ipc.handle("reposStashLocalFiles", async (_event, repoId: string, paths: string[], message?: string) => {
    const id = assertString(repoId, "Repo ID");
    const selectedPaths = assertStringArray(paths, "Paths").map((item) => assertRepoRelativePath(item, "Path"));
    const stashMessage = assertOptionalString(message, "Stash message");
    return operations.stashFiles(id, selectedPaths, stashMessage);
  });
  ipc.handle("reposStashDetail", async (_event, repoId: string, stashRef: string) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) => services.localGit.stashDetail(id, assertGitStashRef(stashRef)))
  );
  ipc.handle("reposApplyStash", async (_event, repoId: string, stashRef: string) => {
    const id = assertString(repoId, "Repo ID");
    const ref = assertGitStashRef(stashRef);
    return operations.applyStash(id, ref);
  });
  ipc.handle("reposPopStash", async (_event, repoId: string, stashRef: string) => {
    const id = assertString(repoId, "Repo ID");
    const ref = assertGitStashRef(stashRef);
    return operations.popStash(id, ref);
  });
  ipc.handle("reposDropStash", async (_event, repoId: string, stashRef: string) => {
    const id = assertString(repoId, "Repo ID");
    const ref = assertGitStashRef(stashRef);
    return operations.dropStash(id, ref);
  });
}

function withVisibleRepo<T>(services: AppServices, repoId: string, load: (repoId: string) => T): T {
  services.database.localCache.repos.requireRepoVisibleToActiveAccount(repoId);
  return load(repoId);
}

function assertPullInput(input: LocalGitPullInput | undefined): LocalGitPullInput {
  if (!input) return {};
  const strategy = input.strategy;
  if (strategy == null) return {};
  if (strategy !== "ff-only" && strategy !== "merge" && strategy !== "rebase") throw new Error("Unsupported pull strategy.");
  return { strategy };
}

function assertPublishInput(input: LocalGitPublishInput | undefined): LocalGitPublishInput {
  if (!input) return {};
  return {
    branchName: input.branchName == null ? undefined : assertGitBranchName(input.branchName),
    remote: input.remote == null ? undefined : assertGitRemoteName(input.remote)
  };
}

function assertConflictInput(input: LocalGitConflictPreflightInput | undefined): LocalGitConflictPreflightInput {
  if (!input || typeof input !== "object") throw new Error("Conflict preflight input is required.");
  const operation = input.operation;
  if (
    operation !== "pull" &&
    operation !== "merge" &&
    operation !== "rebase" &&
    operation !== "stash_apply" &&
    operation !== "stash_pop" &&
    operation !== "branch_switch" &&
    operation !== "workspace_switch"
  ) {
    throw new Error("Unsupported conflict preflight operation.");
  }
  return {
    operation,
    targetRef: input.targetRef == null ? undefined : assertGitRefName(input.targetRef, "Target ref"),
    stashRef: input.stashRef == null ? undefined : assertGitStashRef(input.stashRef)
  };
}

function assertConflictAbortInput(input: LocalGitConflictAbortInput | undefined): LocalGitConflictAbortInput {
  if (!input) return {};
  const state = input.state;
  if (state == null) return {};
  if (state !== "merge" && state !== "rebase" && state !== "cherry_pick" && state !== "revert")
    throw new Error("Unsupported conflict state.");
  return { state };
}

function assertConflictResolveInput(input: LocalGitConflictResolveInput | undefined): LocalGitConflictResolveInput {
  if (!input || typeof input !== "object") throw new Error("Conflict resolution input is required.");
  const contents = assertString(input.contents, "Resolved file contents");
  if (contents.length > 5_000_000) throw new Error("Resolved file contents are too large.");
  return {
    path: assertRepoRelativePath(input.path, "Path"),
    contents
  };
}

function validatePatchApplyInput(input: LocalPatchApplyInput | undefined): LocalPatchApplyInput {
  if (!input || typeof input !== "object") throw new Error("Patch input is required.");
  if (input.action !== "stage" && input.action !== "unstage" && input.action !== "discard") throw new Error("Unsupported patch action.");
  if (input.selectionKind !== "hunk" && input.selectionKind !== "lines") throw new Error("Unsupported patch selection kind.");
  const filePath = assertRepoRelativePath(input.path, "Path");
  const patch = assertString(input.patch, "Patch");
  if (patch.length > 1_000_000) throw new Error("Patch selection is too large.");
  if (!/^diff --git /m.test(patch) || !/^@@ /m.test(patch)) throw new Error("Patch selection must include a file diff and hunk.");
  return { action: input.action, path: filePath, patch, selectionKind: input.selectionKind };
}
