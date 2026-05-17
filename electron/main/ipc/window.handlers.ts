import type { FallbackWindowContextInput } from "../../../src/shared/domain/window-context.js";
import { handleIpc } from "./ipc-handler-registry.js";
import { closeSenderWindow, minimizeSenderWindow, toggleSenderWindowMaximized } from "../shell/window-actions.js";
import type { WindowManager } from "../window-manager.js";

export function registerWindowHandlers(windowManager: WindowManager): void {
  handleIpc("windowContext", (event) => windowManager.contextForEvent(event));
  handleIpc("windowUpdateContext", (event, input: FallbackWindowContextInput) =>
    windowManager.updateContextForEvent(event, validateWindowContextInput(input))
  );
  handleIpc("windowOpenContext", (_event, input: FallbackWindowContextInput) =>
    windowManager.openContext(validateWindowContextInput(input))
  );
  handleIpc("windowListContexts", () => windowManager.listContexts());
  handleIpc("windowClose", (event) => closeSenderWindow(event));
  handleIpc("windowMinimize", (event) => minimizeSenderWindow(event));
  handleIpc("windowToggleMaximize", (event) => toggleSenderWindowMaximized(event));
}

function validateWindowContextInput(input: FallbackWindowContextInput | undefined): FallbackWindowContextInput {
  if (!input || typeof input !== "object") return {};
  const text = (value: unknown) => (typeof value === "string" && value.length <= 500 ? value : null);
  const view = text(input.view);
  if (
    view &&
    !["home", "My Work", "Code", "Local Changes", "Issues", "Pull requests", "Actions", "Branch Integrity", "Settings", "Status"].includes(
      view
    )
  ) {
    throw new Error("Unsupported window view.");
  }
  return {
    repoId: text(input.repoId),
    workspaceId: text(input.workspaceId),
    view: view as FallbackWindowContextInput["view"],
    selectedEntityId: text(input.selectedEntityId),
    accountId: text(input.accountId),
    navigationStack: Array.isArray(input.navigationStack) ? input.navigationStack.slice(-30) : undefined
  };
}
