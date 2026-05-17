import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isAllowedRendererNavigation } from "../electron/main/shell/navigation-guards.js";
import { ipcAuditCategories, ipcAuditReport } from "../src/shared/ipc.js";
import { safeExternalUrlForTest } from "../src/renderer/features/github-work/MarkdownBody.js";

const distIndex = path.resolve("/tmp/fallback/dist/index.html");
const distAsset = pathToFileURL(path.resolve("/tmp/fallback/dist/assets/index.js")).toString();

assert.equal(isAllowedRendererNavigation(distAsset, { kind: "file", value: distIndex }), true);
assert.equal(isAllowedRendererNavigation("https://github.com/fallback/app", { kind: "file", value: distIndex }), false);
assert.equal(isAllowedRendererNavigation("file:///tmp/fallback/other/index.html", { kind: "file", value: distIndex }), false);
assert.equal(isAllowedRendererNavigation("http://127.0.0.1:5173/src/main.tsx", { kind: "url", value: "http://127.0.0.1:5173" }), true);
assert.equal(isAllowedRendererNavigation("http://localhost:5173/src/main.tsx", { kind: "url", value: "http://127.0.0.1:5173" }), false);
assert.equal(safeExternalUrlForTest("https://github.com/org/repo"), "https://github.com/org/repo");
assert.equal(safeExternalUrlForTest("http://example.com"), null);
assert.equal(safeExternalUrlForTest("javascript:alert(1)"), null);

const mainWindowSource = readFileSync(new URL("../electron/main/shell/create-main-window.ts", import.meta.url), "utf8");
assert.match(mainWindowSource, /sandbox:\s*true/);
assert.match(mainWindowSource, /setWindowOpenHandler/);
assert.match(mainWindowSource, /will-navigate/);

const rendererHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(rendererHtml, /Content-Security-Policy/);
assert.match(rendererHtml, /default-src 'self'/);

const authHandlers = readFileSync(new URL("../electron/main/ipc/auth.handlers.ts", import.meta.url), "utf8");
assert.match(authHandlers, /assertHttpsUrl\(flow\.authorizationUrl\)/);
assert.match(authHandlers, /assertHttpsUrl\(flow\.verificationUriComplete \?\? flow\.verificationUri\)/);

for (const [category, channels] of Object.entries(ipcAuditCategories)) {
  assert.ok(channels.length > 0, `Expected IPC audit category ${category} to list at least one channel.`);
}

for (const [category, entries] of Object.entries(ipcAuditReport)) {
  assert.equal(entries.length, ipcAuditCategories[category as keyof typeof ipcAuditCategories].length);
  for (const entry of entries) {
    assert.ok(entry.key);
    assert.ok(entry.channel.includes(":"));
    assert.ok(entry.group);
    assert.ok(entry.risk);
  }
}

console.log(`Electron security tests ok: IPC report categories ${Object.keys(ipcAuditReport).join(", ")}`);
