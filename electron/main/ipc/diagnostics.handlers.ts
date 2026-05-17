import type { AppServices } from "../app-services.js";
import { sendAppEvent } from "./app-events.js";
import { assertOptionalString, assertString } from "./validation.js";
import { createIpcHandlerRegistrar } from "./ipc-handler-registry.js";

export function registerDiagnosticsHandlers(services: AppServices): void {
  const ipc = createIpcHandlerRegistrar(services);
  ipc.handle("searchQuery", async (_event, query: string, filters) =>
    services.database.localCache.searchIndex.searchForActiveAccount(assertString(query, "Search query"), filters)
  );
  ipc.handle("healthSummary", async () => services.health.summary());
  ipc.handle("healthRunProbe", async (_event, repoId?: string) => {
    const id = assertOptionalString(repoId, "Repo ID");
    const result = await services.health.runProbe(id);
    sendAppEvent("health", { repoId: id });
    return result;
  });
  ipc.handle("healthMatrix", async () => services.health.matrix());
  ipc.handle("healthHistory", async () => services.health.history());
  ipc.handle("healthOfflineStatus", async () => services.health.offlineStatus());
}
