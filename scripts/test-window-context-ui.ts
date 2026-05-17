import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rendererShell = [
  readFileSync(new URL("../src/renderer/shell/AppShell.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../src/renderer/shell/ShellChrome.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../src/renderer/shell/useStartupHydration.ts", import.meta.url), "utf8"),
  readFileSync(new URL("../src/renderer/shell/useWindowContext.ts", import.meta.url), "utf8"),
  readFileSync(new URL("../src/renderer/shell/WindowLogoControls.tsx", import.meta.url), "utf8")
].join("\n");
assert.match(rendererShell, /startupSnapshot\.windowContext/);
assert.match(rendererShell, /windowContextNotice/);
assert.match(rendererShell, /That saved window pointed at a repo that is no longer watched/);
assert.match(rendererShell, /Restored \$\{restoredContext\.navigationStack\.at\(-1\)\?\.label/);
assert.match(rendererShell, /window\.fallback\.window\s*\.\s*updateContext/);
assert.match(rendererShell, /window\.fallback\.window\s*\.\s*openContext/);
assert.match(rendererShell, /currentWindowRoute/);
assert.match(rendererShell, /code:\$\{activeTab\}/);
assert.match(rendererShell, /file:\$\{fileTarget\.path\}/);
assert.match(rendererShell, /commit:\$\{commitTarget\.sha\}/);
assert.match(rendererShell, /operation:\$\{selectedOperationId\}/);
assert.match(rendererShell, /WindowOperationContext/);
assert.match(rendererShell, /Open this view in a new window/);
assert.match(rendererShell, /selectedOperationContext/);
assert.match(rendererShell, /WorkspaceSelector repo=\{repo\}/);

const palette = readFileSync(new URL("../src/renderer/features/command-palette/CommandPalette.tsx", import.meta.url), "utf8");
const paletteCatalog = readFileSync(
  new URL("../src/renderer/features/command-palette/CommandPalette.action-catalog.ts", import.meta.url),
  "utf8"
);
assert.match(palette, /window\.fallback\.window\.listContexts/);
assert.match(palette, /Open commit in new window/);
assert.match(palette, /Open \$\{entityKind\} in new window/);
assert.match(palette, /selectedEntityId: `operation:\$\{operation\.id\}`/);
assert.match(palette, /buildCoreActionCatalog/);
assert.match(paletteCatalog, /Open current view in new window/);
assert.match(paletteCatalog, /Open selected repo in new window/);
assert.match(paletteCatalog, /Open commit graph in new window/);
assert.match(paletteCatalog, /Open Local Changes in new window/);
assert.match(paletteCatalog, /Switch to window context/);

const workspaceSelector = readFileSync(new URL("../src/renderer/features/repo-code/WorkspaceSelector.tsx", import.meta.url), "utf8");
assert.match(workspaceSelector, /Open workspace in new window/);
assert.match(workspaceSelector, /workspaceId: workspace\.id/);

const settings = readFileSync(new URL("../src/renderer/features/settings/SettingsView.tsx", import.meta.url), "utf8");
assert.match(settings, /Restore Windows on Launch/);
assert.match(settings, /restoreWindowsOnLaunch/);
assert.match(settings, /Private repository metadata is cached locally/);
assert.match(settings, /does not encrypt the SQLite cache/);
assert.match(settings, /revealPath\(settings\.workspacePath\)/);
assert.match(settings, /Existing data is not\s+migrated or deleted automatically/);

const preload = readFileSync(new URL("../electron/preload/index.ts", import.meta.url), "utf8");
assert.match(preload, /windowContext/);
assert.match(preload, /windowUpdateContext/);
assert.match(preload, /windowOpenContext/);
assert.match(preload, /windowListContexts/);

console.log("Window context UI wiring tests ok");
