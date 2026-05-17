import type { AppServices } from "../app-services.js";
import { createIpcHandlerRegistrar } from "./ipc-handler-registry.js";

export function registerAppUpdateHandlers(services: AppServices): void {
  const ipc = createIpcHandlerRegistrar(services);
  ipc.handle("appUpdateGetState", async () => services.appUpdate.getState());
  ipc.handle("appUpdateCheck", async () => services.appUpdate.check());
  ipc.handle("appUpdateDownload", async () => services.appUpdate.download());
  ipc.handle("appUpdateInstall", async () => services.appUpdate.install());
}
