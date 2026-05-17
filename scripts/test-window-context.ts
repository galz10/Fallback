import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const windowManager = readFileSync(new URL("../electron/main/window-manager.ts", import.meta.url), "utf8");
assert.match(windowManager, /class WindowManager/);
assert.match(windowManager, /createInitialWindows/);
assert.match(windowManager, /restoreWindowsOnLaunch/);
assert.match(windowManager, /window-contexts\.json/);
assert.match(windowManager, /activateWorkspace/);
assert.match(windowManager, /repoWorkspaces\.switch/);
assert.match(windowManager, /sendAppEvent\("localChanges"/);

const lifecycle = readFileSync(new URL("../electron/main/app/lifecycle.ts", import.meta.url), "utf8");
assert.match(lifecycle, /createInitialWindows/);
assert.match(lifecycle, /prepareForQuit/);

const startup = readFileSync(new URL("../electron/main/ipc/startup.handlers.ts", import.meta.url), "utf8");
assert.match(
  startup,
  /const windowContext = timeStartupPart\(timings, "window-context", \(\) => windowManager\.contextForEvent\(event\)\)/
);
assert.match(startup, /windowContext,/);

const operationService = readFileSync(new URL("../electron/main/operation-service.ts", import.meta.url), "utf8");
assert.match(operationService, /activeScopes/);
assert.match(operationService, /Another operation is already running/);
assert.match(operationService, /operationScopeKey/);

console.log("Window context main-process tests ok");
