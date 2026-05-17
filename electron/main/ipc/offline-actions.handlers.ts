import type { OfflineActionListInput, UpdateOfflineActionInput } from "../../../src/shared/domain/offline-action.js";
import type { AppServices } from "../app-services.js";
import { createIpcHandlerRegistrar } from "./ipc-handler-registry.js";
import { assertString } from "./validation.js";

export function registerOfflineActionsHandlers(services: AppServices): void {
  const ipc = createIpcHandlerRegistrar(services);

  ipc.handle("offlineActionsList", async (_event, input?: OfflineActionListInput) => {
    const options = normalizeListInput(input);
    if (options.repoId) services.database.localCache.repos.requireRepoVisibleToActiveAccount(options.repoId);
    return services.offlineWritebacks.list(options);
  });

  ipc.handle("offlineActionsSummary", async () => services.offlineWritebacks.summary());

  ipc.handle("offlineActionsGet", async (_event, id: string) => requireVisibleAction(services, assertString(id, "Queued action ID")));

  ipc.handle("offlineActionsUpdate", async (_event, id: string, input: UpdateOfflineActionInput) =>
    services.offlineWritebacks.update(requireVisibleAction(services, assertString(id, "Queued action ID")).id, normalizeUpdateInput(input))
  );

  ipc.handle("offlineActionsCancel", async (_event, id: string) =>
    services.offlineWritebacks.cancel(requireVisibleAction(services, assertString(id, "Queued action ID")).id)
  );

  ipc.handle("offlineActionsRetry", async (_event, id: string) => {
    await services.offlineWritebacks.retryNow(requireVisibleAction(services, assertString(id, "Queued action ID")).id);
  });

  ipc.handle("offlineActionsFlush", async () => {
    await services.offlineWritebacks.flushDueActions("manual_flush");
  });
}

function normalizeListInput(input: OfflineActionListInput | undefined): OfflineActionListInput {
  return {
    repoId: typeof input?.repoId === "string" && input.repoId ? input.repoId : null,
    entityType: input?.entityType === "pull_request" || input?.entityType === "issue" ? input.entityType : null,
    entityNumber: typeof input?.entityNumber === "number" && Number.isFinite(input.entityNumber) ? input.entityNumber : null,
    includeCompleted: Boolean(input?.includeCompleted)
  };
}

function normalizeUpdateInput(input: UpdateOfflineActionInput): UpdateOfflineActionInput {
  if (!input || typeof input !== "object") throw new Error("Queued action update is required.");
  return input;
}

function requireVisibleAction(services: AppServices, id: string) {
  const action = services.database.localCache.offlineActions.getOfflineAction(id);
  if (!action) throw new Error("Queued action not found.");
  services.database.localCache.repos.requireRepoVisibleToActiveAccount(action.repoId);
  const activeAccount = services.database.localCache.accounts.getGitHubAccount();
  if (action.accountId && action.accountId !== activeAccount?.id) throw new Error("Queued action belongs to another GitHub account.");
  return action;
}
