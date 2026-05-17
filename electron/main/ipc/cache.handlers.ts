import type { AppServices } from "../app-services.js";
import { assertBoolean, assertString } from "./validation.js";
import { createIpcHandlerRegistrar } from "./ipc-handler-registry.js";

export function registerCacheHandlers(services: AppServices): void {
  const ipc = createIpcHandlerRegistrar(services);
  ipc.handle("cacheSummary", async () => services.cache.summary());
  ipc.handle("cacheSummaryDetailed", async () => services.cache.summaryDetailed());
  ipc.handle("cacheDeleteRepo", async (_event, repoId: string) => services.cache.deleteRepo(assertString(repoId, "Repo ID")));
  ipc.handle("cacheDeleteAll", async () => services.cache.deleteAll());
  ipc.handle("cacheExportDiagnostics", async (_event, includeSensitive?: boolean) =>
    services.cache.exportDiagnostics(
      includeSensitive === undefined ? false : assertBoolean(includeSensitive, "Include sensitive diagnostics")
    )
  );
}
