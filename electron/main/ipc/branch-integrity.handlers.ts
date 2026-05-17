import type { BranchIntegrityAuditOptions, BranchRecoveryPlan } from "../../../src/shared/domain/branch-integrity.js";
import type { AppServices } from "../app-services.js";
import { sendAppEvent } from "./app-events.js";
import { assertString, assertStringArray } from "./validation.js";
import { createIpcHandlerRegistrar } from "./ipc-handler-registry.js";

export function registerBranchIntegrityHandlers(services: AppServices): void {
  const ipc = createIpcHandlerRegistrar(services);
  ipc.handle("branchIntegrityAuditRepo", async (_event, repoId: string, options?: BranchIntegrityAuditOptions) => {
    const id = assertString(repoId, "Repo ID");
    services.database.localCache.repos.requireRepoVisibleToActiveAccount(id);
    const result = await services.branchIntegrity.auditRepo(id, options);
    sendAppEvent("branchIntegrity", { repoId: id });
    return result;
  });
  ipc.handle("branchIntegrityAuditAll", async (_event, options?: BranchIntegrityAuditOptions) => {
    const result = await services.branchIntegrity.auditAllWatchedRepos(options);
    sendAppEvent("branchIntegrity", {});
    return result;
  });
  ipc.handle("branchIntegrityLatestFindings", async (_event, repoId?: string) =>
    repoId
      ? services.branchIntegrity.latestFindings(visibleRepoId(services, assertString(repoId, "Repo ID")))
      : services.branchIntegrity
          .latestFindings()
          .filter((finding) => services.database.localCache.repos.repoIsVisibleToAccount(finding.repoId))
  );
  ipc.handle("branchIntegritySummary", async (_event, repoId: string) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) => services.branchIntegrity.summary(id))
  );
  ipc.handle("branchIntegritySummaryMany", async (_event, repoIds: string[]) =>
    services.branchIntegrity.summaryMany(
      assertStringArray(repoIds, "Repo IDs").filter((repoId) => services.database.localCache.repos.repoIsVisibleToAccount(repoId))
    )
  );
  ipc.handle("branchIntegrityResolveFinding", async (_event, findingId: string) => {
    const result = await services.branchIntegrity.markFindingResolved(assertString(findingId, "Finding ID"));
    sendAppEvent("branchIntegrity", { repoId: result?.repoId });
    return result;
  });
  ipc.handle("branchIntegrityRecordSnapshot", async (_event, repoId: string, options?: BranchIntegrityAuditOptions) => {
    const id = assertString(repoId, "Repo ID");
    services.database.localCache.repos.requireRepoVisibleToActiveAccount(id);
    const result = await services.branchIntegrity.recordSnapshot(id, options);
    sendAppEvent("branchIntegrity", { repoId: id });
    return result;
  });
  ipc.handle("branchIntegrityFetchSafetyRefs", async (_event, repoId: string) => {
    const id = assertString(repoId, "Repo ID");
    services.database.localCache.repos.requireRepoVisibleToActiveAccount(id);
    const result = await services.branchIntegrity.fetchSafetyRefs(id);
    sendAppEvent("branchIntegrity", { repoId: id });
    return result;
  });
  ipc.handle("branchIntegrityRecoveryPlan", async (_event, repoId: string, findingIds: string[]) =>
    services.branchIntegrity.recoveryPlan(
      visibleRepoId(services, assertString(repoId, "Repo ID")),
      findingIds.map((id) => assertString(id, "Finding ID"))
    )
  );
  ipc.handle("branchIntegrityInspectDiff", async (_event, repoId: string, findingId: string, mode?: "landed" | "expected" | "recovery") =>
    services.branchIntegrity.inspectDiff(
      visibleRepoId(services, assertString(repoId, "Repo ID")),
      assertString(findingId, "Finding ID"),
      mode
    )
  );
  ipc.handle(
    "branchIntegrityCreateRecoveryBranch",
    async (_event, repoId: string, findingIds: string[], strategy?: BranchRecoveryPlan["strategy"]) =>
      services.branchIntegrity.createRecoveryBranch(
        visibleRepoId(services, assertString(repoId, "Repo ID")),
        findingIds.map((id) => assertString(id, "Finding ID")),
        strategy
      )
  );
  ipc.handle("branchIntegrityOpenRecoveryPr", async (_event, repoId: string, findingIds: string[]) =>
    services.branchIntegrity.openRecoveryPullRequest(
      visibleRepoId(services, assertString(repoId, "Repo ID")),
      findingIds.map((id) => assertString(id, "Finding ID"))
    )
  );
}

function visibleRepoId(services: AppServices, repoId: string): string {
  services.database.localCache.repos.requireRepoVisibleToActiveAccount(repoId);
  return repoId;
}

function withVisibleRepo<T>(services: AppServices, repoId: string, load: (repoId: string) => T): T {
  return load(visibleRepoId(services, repoId));
}
