import { shell } from "electron";
import type { AppServices } from "../app-services.js";
import { openInEditor, openInTerminal, revealPath } from "../shell/handoff.js";
import { assertTrustedLocalPath } from "../shell/trusted-paths.js";
import { assertHttpsUrl, assertOptionalNumber } from "./validation.js";
import { createIpcHandlerRegistrar } from "./ipc-handler-registry.js";

export function registerShellHandlers(services: AppServices): void {
  const ipc = createIpcHandlerRegistrar(services);
  ipc.handle("shellOpenExternal", async (_event, url: string) => {
    await shell.openExternal(assertHttpsUrl(url));
  });
  ipc.handle("shellOpenPath", async (_event, targetPath: string) => {
    const error = await shell.openPath(assertTrustedLocalPath(services, targetPath));
    if (error) throw new Error(error);
  });
  ipc.handle("shellOpenEditor", async (_event, targetPath: string) => {
    const settings = services.settings.get();
    await openInEditor(assertTrustedLocalPath(services, targetPath), null, {
      pathOpener: shell,
      preferredEditorCommand: settings.shell.preferredEditorCommand
    });
  });
  ipc.handle("shellOpenEditorAtLine", async (_event, targetPath: string, line?: number | null, workspacePath?: string | null) => {
    const settings = services.settings.get();
    const trustedWorkspacePath = workspacePath ? assertTrustedLocalPath(services, workspacePath) : null;
    await openInEditor(assertTrustedLocalPath(services, targetPath), assertOptionalNumber(line, "Line"), {
      pathOpener: shell,
      preferredEditorCommand: settings.shell.preferredEditorCommand,
      workspacePath: trustedWorkspacePath
    });
  });
  ipc.handle("shellOpenTerminal", async (_event, targetPath: string) => {
    const settings = services.settings.get();
    await openInTerminal(assertTrustedLocalPath(services, targetPath), {
      preferredTerminalCommand: settings.shell.preferredTerminalCommand
    });
  });
  ipc.handle("shellRevealPath", async (_event, targetPath: string) => {
    await revealPath(assertTrustedLocalPath(services, targetPath), { pathOpener: shell });
  });
}
