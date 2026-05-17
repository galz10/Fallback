import type { AppServices } from "../app-services.js";
import { validateSettingsPatch } from "../settings-service.js";
import { createIpcHandlerRegistrar } from "./ipc-handler-registry.js";

export function registerSettingsHandlers(services: AppServices): void {
  const ipc = createIpcHandlerRegistrar(services);
  ipc.handle("settingsGet", async () => services.settings.get());
  ipc.handle("settingsUpdate", async (_event, patch) => services.settings.update(validateSettingsPatch(patch)));
}
