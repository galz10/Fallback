import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const settingsView = await readFile("src/renderer/features/settings/SettingsView.tsx", "utf8");
const appUpdateService = await readFile("electron/main/app-update-service.ts", "utf8");
const lifecycle = await readFile("electron/main/app/lifecycle.ts", "utf8");
const releaseWorkflow = await readFile(".github/workflows/release.yml", "utf8");
const releaseScript = await readFile("scripts/release.ts", "utf8");
const readme = await readFile("README.md", "utf8");

assert.match(settingsView, /queryKey: \["appUpdate"\]/);
assert.match(settingsView, /window\.fallback\.events\.onAppUpdateChanged/);
assert.match(settingsView, /window\.fallback\.appUpdate\.check/);
assert.match(settingsView, /window\.fallback\.appUpdate\.download/);
assert.match(settingsView, /window\.fallback\.appUpdate\.install/);
assert.match(settingsView, /Check for updates/);
assert.match(settingsView, /Restart to install/);

assert.match(appUpdateService, /autoDownload = false/);
assert.match(appUpdateService, /autoInstallOnAppQuit = false/);
assert.match(appUpdateService, /allowPrerelease = false/);
assert.match(appUpdateService, /channel = "latest"/);
assert.match(appUpdateService, /FALLBACK_DISABLE_UPDATES/);
assert.match(appUpdateService, /development builds/);

assert.match(lifecycle, /services\.appUpdate\.start\(\)/);
assert.match(lifecycle, /services\.appUpdate\.stop\(\)/);

assert.match(releaseWorkflow, /release\/\*mac\*\.yml/);
assert.match(releaseWorkflow, /release\/\*\.zip/);
assert.match(releaseWorkflow, /release\/\*\.blockmap/);
assert.match(releaseWorkflow, /release\/\*linux\*\.yml/);
assert.match(readme, /production release matrix currently includes macOS arm64 and Linux x64/);
assert.match(readme, /Windows release artifacts are deferred/);
assert.match(readme, /GitHub write-back actions are intentionally supported/);
assert.match(readme, /Auto-update is intentionally disabled/);
assert.match(releaseScript, /Updater asset contract/);

console.log("App update UI wiring tests ok");
