import { syncPriority } from "../../../src/shared/sync-policy.js";
import type { CreateRepoWorkspaceInput, RemoveRepoWorkspaceInput, WatchRepoInput } from "../../../src/shared/domain/watched-repo.js";
import type { CommitSearchInput } from "../../../src/shared/domain/repo-code.js";
import type { AppServices } from "../app-services.js";
import { LocalGitOperations } from "../modules/local-git/local-git-operations.js";
import { sendAppEvent } from "./app-events.js";
import { createIpcHandlerRegistrar } from "./ipc-handler-registry.js";
import {
  assertBoolean,
  assertGitBranchName,
  assertGitRefName,
  assertLocalPath,
  assertRepoRelativePath,
  assertString
} from "./validation.js";

export function registerWatchedReposHandlers(services: AppServices): void {
  const ipc = createIpcHandlerRegistrar(services);
  const localGitOperations = new LocalGitOperations(services);
  ipc.handle("reposListAvailable", async () => services.sync.listAvailableRepos());
  ipc.handle("reposListWatched", async () => services.database.localCache.repos.listWatchedReposForActiveAccount());
  ipc.handle("reposCodeSummary", async (_event, repoId: string) => {
    const id = assertString(repoId, "Repo ID");
    services.database.localCache.repos.requireRepoVisibleToActiveAccount(id);
    return services.sync.repoCodeSummary(id);
  });
  ipc.handle("reposListFiles", async (_event, repoId: string, path?: string) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) =>
      services.sync.listRepoFiles(id, path == null ? undefined : assertRepoRelativePath(path, "Path", { allowRoot: true }))
    )
  );
  ipc.handle("reposReadFile", async (_event, repoId: string, path: string) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) => services.sync.readRepoFile(id, assertRepoRelativePath(path, "Path")))
  );
  ipc.handle("reposListBranches", async (_event, repoId: string) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) => services.sync.listRepoBranches(id))
  );
  ipc.handle("reposListWorkspaces", async (_event, repoId: string) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) => services.repoWorkspaces.list(id))
  );
  ipc.handle("reposRefreshWorkspaces", async (_event, repoId: string) => {
    const id = assertString(repoId, "Repo ID");
    services.database.localCache.repos.requireRepoVisibleToActiveAccount(id);
    const result = await services.repoWorkspaces.refresh(id);
    emitWorkspaceEvents(id);
    return result;
  });
  ipc.handle("reposSwitchWorkspace", async (_event, repoId: string, workspaceId: string) => {
    const id = assertString(repoId, "Repo ID");
    return localGitOperations.switchWorkspace(id, assertString(workspaceId, "Workspace ID"));
  });
  ipc.handle("reposCreateWorkspace", async (_event, repoId: string, input: CreateRepoWorkspaceInput) => {
    const id = assertString(repoId, "Repo ID");
    return localGitOperations.createWorkspace(id, validateCreateWorkspaceInput(input));
  });
  ipc.handle("reposRemoveWorkspace", async (_event, repoId: string, workspaceId: string, input?: RemoveRepoWorkspaceInput) => {
    const id = assertString(repoId, "Repo ID");
    const targetWorkspaceId = assertString(workspaceId, "Workspace ID");
    return localGitOperations.removeWorkspace(id, targetWorkspaceId, validateRemoveWorkspaceInput(input));
  });
  ipc.handle("reposPruneWorkspaces", async (_event, repoId: string) => {
    const id = assertString(repoId, "Repo ID");
    return localGitOperations.pruneWorkspaces(id);
  });
  ipc.handle("reposSwitchBranch", async (_event, repoId: string, branch: string) => {
    const id = assertString(repoId, "Repo ID");
    const targetBranch = assertGitBranchName(branch, "Branch");
    return localGitOperations.switchBranch(id, targetBranch);
  });
  ipc.handle("reposListReleases", async (_event, repoId: string) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) => services.sync.listRepoReleases(id))
  );
  ipc.handle("reposListTags", async (_event, repoId: string) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) => services.sync.listRepoTags(id))
  );
  ipc.handle("reposListContributors", async (_event, repoId: string) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) => services.sync.listRepoContributors(id))
  );

  ipc.handle("reposWatch", async (_event, input: WatchRepoInput) => {
    const repo = await services.sync.watchRepo(assertString(input?.fullName, "Repository full name"));
    if (!repo) throw new Error("Repository was not stored after watch.");
    sendAppEvent("repos", { repoId: repo.id });
    return repo;
  });

  ipc.handle("reposUnwatch", async (_event, repoId: string) => {
    const id = assertString(repoId, "Repo ID");
    const result = services.database.localCache.repos.unwatchRepo(id);
    sendAppEvent("repos", { repoId: id });
    return result;
  });
  ipc.handle("reposRefresh", async (_event, repoId: string) => {
    const id = assertString(repoId, "Repo ID");
    services.database.localCache.repos.requireRepoVisibleToActiveAccount(id);
    const result = await services.sync.enqueueRepoSync(id, "manual_repo_sync", {
      priority: syncPriority.manual,
      reason: "manual_refresh",
      bypassCooldown: true
    });
    sendAppEvent("sync", { repoId: id });
    sendAppEvent("repos", { repoId: id });
    return result;
  });
  ipc.handle("reposRefreshAll", async () => {
    const result = await services.sync.enqueueWatchedRepos("manual_repo_sync");
    sendAppEvent("sync", {});
    sendAppEvent("repos", {});
    return result;
  });
  ipc.handle("reposGetIdentity", async (_event, repoId: string, caller?: string) => {
    const id = assertString(repoId, "Repo ID");
    services.database.localCache.repos.requireRepoVisibleToActiveAccount(id);
    const context = typeof caller === "string" && caller.trim() ? caller.trim().slice(0, 80) : "unknown";
    const startedAt = performance.now();
    const result = services.identity.get(id);
    const durationMs = performance.now() - startedAt;
    if (durationMs >= 25) {
      console.warn(`[perf] repos:get-identity caller=${context} repo=${id} duration=${Math.round(durationMs)}ms`);
    }
    return result;
  });
  ipc.handle("reposUpdateIdentity", async (_event, repoId: string, input) => {
    const id = assertString(repoId, "Repo ID");
    return localGitOperations.updateRepoIdentity(id, input);
  });
  ipc.handle("reposSigningReadiness", async (_event, repoId: string) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) => services.signingReadiness.readiness(id))
  );
  ipc.handle("reposVerifySigning", async (_event, repoId: string) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) => services.signingReadiness.verify(id))
  );
  ipc.handle("reposCheckCredentials", async (_event, repoId: string) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) => services.diagnostics.check(id))
  );
  ipc.handle("reposCommitTemplates", async (_event, repoId: string) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) => services.localGit.commitTemplates(id))
  );
  ipc.handle("reposSearchCommits", async (_event, repoId: string, input: CommitSearchInput) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) => services.historySearch.searchCommits(id, input))
  );
  ipc.handle("reposCancelCommitSearch", async (_event, requestId: string) =>
    services.historySearch.cancelSearch(assertString(requestId, "Request ID"))
  );
}

function withVisibleRepo<T>(services: AppServices, repoId: string, load: (repoId: string) => T): T {
  services.database.localCache.repos.requireRepoVisibleToActiveAccount(repoId);
  return load(repoId);
}

function emitWorkspaceEvents(repoId: string): void {
  sendAppEvent("repos", { repoId });
  sendAppEvent("localChanges", { repoId });
  sendAppEvent("sync", { repoId });
}

function validateCreateWorkspaceInput(input: CreateRepoWorkspaceInput | undefined): CreateRepoWorkspaceInput {
  const value = input ?? {};
  return {
    branchName: value.branchName == null ? undefined : assertGitBranchName(value.branchName),
    baseRef: value.baseRef == null ? undefined : assertGitRefName(value.baseRef, "Base ref"),
    path: value.path == null ? undefined : assertLocalPath(value.path),
    createBranch: value.createBranch == null ? undefined : assertBoolean(value.createBranch, "Create branch")
  };
}

function validateRemoveWorkspaceInput(input: RemoveRepoWorkspaceInput | undefined): RemoveRepoWorkspaceInput {
  return {
    force: input?.force == null ? undefined : assertBoolean(input.force, "Force remove")
  };
}
