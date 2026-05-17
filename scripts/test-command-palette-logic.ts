import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

type TestItem = {
  kind: "action" | "submenu" | "repo" | "file" | "commit" | "pull_request" | "issue" | "operation";
  value: string;
  title: string;
  searchTerms: string[];
};

const logic = await import(pathToFileURL(path.resolve("src/renderer/features/command-palette/CommandPalette.logic.ts")).href);
const actionCatalog = await import(
  pathToFileURL(path.resolve("src/renderer/features/command-palette/CommandPalette.action-catalog.ts")).href
);
const {
  actionQuery,
  detectPaletteMode,
  filterAndRankItems,
  filterGroups,
  normalizePaletteQuery,
  paletteGroupFilter,
  rankItemMatch,
  repoPickerQuery,
  resolveShortcutChord,
  stripPaletteGroupFilter
} = logic as {
  actionQuery: (query: string) => string;
  detectPaletteMode: (query: string) => string;
  filterAndRankItems: (items: TestItem[], query: string, limit?: number) => TestItem[];
  filterGroups: (
    groups: Array<{ value: string; label: string; items: TestItem[] }>,
    query: string,
    limitPerGroup?: number
  ) => Array<{
    value: string;
    label: string;
    items: TestItem[];
  }>;
  normalizePaletteQuery: (query: string) => string;
  paletteGroupFilter: (
    query: string,
    groups: Array<{ id: string; name: string; repoIds: string[]; createdAt: string; updatedAt: string }>
  ) => { id: string; name: string } | null;
  rankItemMatch: (item: TestItem, query: string) => number | null;
  repoPickerQuery: (query: string) => string;
  resolveShortcutChord: (
    items: Array<TestItem & { shortcut?: string[] }>,
    previousKeys: string[],
    key: string
  ) => { item: (TestItem & { shortcut?: string[] }) | null; pendingKeys: string[] };
  stripPaletteGroupFilter: (query: string) => string;
};
const { buildCurrentRepoActionCatalog, buildSyncSubmenuCatalog, commandActionItem, commandSubmenuItem } = actionCatalog as {
  buildCurrentRepoActionCatalog: (input: {
    repo: Record<string, unknown>;
    summary: null;
    closeAndSetView: (view: string, repoId?: string | null) => void;
    pushView: (view: { id: string; title: string }) => void;
    runAsync: (label: string, task: () => Promise<unknown>, repoId?: string | null) => Promise<void>;
  }) => Array<TestItem & { disabled?: string; run?: () => void | Promise<void> }>;
  buildSyncSubmenuCatalog: (
    repo: Record<string, unknown> | null,
    runAsync: (label: string, task: () => Promise<unknown>, repoId?: string | null) => Promise<void>
  ) => { items: Array<TestItem & { disabled?: string; run?: () => void | Promise<void> }> };
  commandActionItem: (definition: {
    id: string;
    title: string;
    description: string;
    shortcut?: string[];
    run: () => void;
  }) => TestItem & { shortcut?: string[]; run?: () => void };
  commandSubmenuItem: (definition: { id: string; title: string; description: string; run: () => void }) => TestItem & {
    keepOpen?: boolean;
    run?: () => void;
  };
};

const items: TestItem[] = [
  item("action", "action:settings", "Open Settings", ["settings", "preferences"]),
  item("repo", "repo:fallback", "openai/fallback", ["openai", "fallback"]),
  item("file", "file:deep", "CommandPalette.tsx", ["src/renderer/features/command-palette/CommandPalette.tsx"]),
  item("file", "file:contains", "styles.css", ["src/renderer/styles.css"]),
  item("action", "action:sync", "Sync selected repo", ["refresh repo"])
];

assert.equal(normalizePaletteQuery("  >settings   now "), ">settings now");
assert.equal(detectPaletteMode(">settings"), "action");
assert.equal(detectPaletteMode("@fallback"), "repo-picker");
assert.equal(detectPaletteMode("author:gal fix"), "commit");
assert.equal(detectPaletteMode("fallback"), "root");
assert.equal(actionQuery(">  settings"), "settings");
assert.equal(repoPickerQuery("@  openai"), "openai");

const groups = [
  { id: "g1", name: "Core Apps", repoIds: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  { id: "g2", name: "Experimental", repoIds: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" }
];
assert.equal(paletteGroupFilter('group:"Core Apps" settings', groups)?.id, "g1");
assert.equal(stripPaletteGroupFilter('group:"Core Apps" settings'), "settings");

assert.equal(filterAndRankItems(items, "settings")[0]?.value, "action:settings");
assert.equal(filterAndRankItems(items, "openai/fallback")[0]?.value, "repo:fallback");
assert.equal(filterAndRankItems(items, "CommandPalette")[0]?.value, "file:deep");
assert.ok((rankItemMatch(items[0], "settings") ?? 100) < (rankItemMatch(items[2], "settings") ?? 100));
assert.deepEqual(
  filterAndRankItems(items, "sync")
    .slice(0, 1)
    .map((result) => result.value),
  ["action:sync"]
);
assert.deepEqual(
  filterGroups(
    [
      { value: "actions", label: "Actions", items: [items[0], items[4]] },
      { value: "files", label: "Files", items: [items[2], items[3]] }
    ],
    "settings"
  ).map((group) => [group.value, group.items.map((result) => result.value)]),
  [["actions", ["action:settings"]]]
);

const shortcutItems = [
  { ...items[0], shortcut: ["G", "H"] },
  { ...items[1], shortcut: ["G", "M"] },
  { ...items[4], shortcut: ["N"] },
  { ...items[2], shortcut: ["Ctrl+M"] }
];
const pendingG = resolveShortcutChord(shortcutItems, [], "g");
assert.equal(pendingG.item, null);
assert.deepEqual(pendingG.pendingKeys, ["G"]);
assert.equal(resolveShortcutChord(shortcutItems, pendingG.pendingKeys, "h").item?.value, "action:settings");
assert.equal(resolveShortcutChord(shortcutItems, ["G"], "m").item?.value, "repo:fallback");
assert.equal(resolveShortcutChord(shortcutItems, [], "n").item?.value, "action:sync");
assert.equal(resolveShortcutChord(shortcutItems, [], { key: "m", ctrlKey: true } as KeyboardEvent).item?.value, "file:deep");
assert.deepEqual(resolveShortcutChord(shortcutItems, ["G"], "x").pendingKeys, []);

const catalogAction = commandActionItem({
  id: "refresh",
  title: "Refresh repo",
  description: "Sync selected repo",
  shortcut: ["R"],
  run: () => undefined
});
assert.equal(catalogAction.value, "action:refresh");
assert.deepEqual(catalogAction.searchTerms, ["refresh", "Refresh repo", "Sync selected repo"]);
assert.deepEqual(catalogAction.shortcut, ["R"]);
assert.equal(commandSubmenuItem({ id: "open", title: "Open", description: "Open objects", run: () => undefined }).keepOpen, true);

const adapterCalls: string[] = [];
(globalThis as typeof globalThis & { window: unknown }).window = {
  fallback: {
    repos: {
      fetchWorkspace: async (repoId: string) => adapterCalls.push(`fetch:${repoId}`),
      refresh: async (repoId: string) => adapterCalls.push(`refresh:${repoId}`),
      refreshAll: async () => adapterCalls.push("refresh-all"),
      pullWorkspace: async () => undefined,
      pushWorkspace: async () => undefined,
      publishWorkspace: async () => undefined,
      checkCredentials: async () => undefined,
      refreshWorkspaces: async () => undefined,
      pruneWorkspaces: async () => undefined,
      conflictState: async () => ({ isActive: false, files: [] }),
      openConflictFile: async () => undefined,
      openMergeTool: async () => undefined,
      abortConflict: async () => undefined
    },
    branchIntegrity: {
      auditRepo: async () => undefined,
      fetchSafetyRefs: async () => undefined,
      summary: async () => ({}),
      latestFindings: async () => [],
      createRecoveryBranch: async () => undefined
    },
    shell: {
      openPath: async () => undefined,
      openEditor: async () => undefined,
      openTerminal: async () => undefined,
      revealPath: async () => undefined,
      openExternal: async () => undefined
    },
    window: { openContext: async () => undefined }
  }
};
const watchedRepo = {
  id: "repo-1",
  fullName: "octo/repo",
  name: "repo",
  owner: "octo",
  localPath: "/tmp/repo",
  syncStatus: "fresh",
  syncProgressMessage: null,
  htmlUrl: "https://github.com/octo/repo"
};
const runAsyncCalls: string[] = [];
const runAsync = async (label: string, task: () => Promise<unknown>, repoId?: string | null) => {
  runAsyncCalls.push(`${label}:${repoId ?? "global"}`);
  await task();
};
const currentRepoCatalog = buildCurrentRepoActionCatalog({
  repo: watchedRepo,
  summary: null,
  closeAndSetView: (view, repoId) => adapterCalls.push(`view:${view}:${repoId ?? ""}`),
  pushView: (view) => adapterCalls.push(`submenu:${view.id}`),
  runAsync
});
assert.equal(currentRepoCatalog.find((item) => item.value === "action:repo-git-fetch")?.disabled, undefined);
await currentRepoCatalog.find((item) => item.value === "action:repo-git-fetch")?.run?.();
assert.deepEqual(runAsyncCalls.slice(-1), ["Fetch completed.:repo-1"]);
assert.deepEqual(adapterCalls.slice(-1), ["fetch:repo-1"]);
assert.equal(
  buildCurrentRepoActionCatalog({
    repo: { ...watchedRepo, localPath: null },
    summary: null,
    closeAndSetView: () => undefined,
    pushView: () => undefined,
    runAsync
  }).find((item) => item.value === "action:repo-git-fetch")?.disabled,
  "No local folder"
);
assert.equal(
  buildSyncSubmenuCatalog(null, runAsync).items.find((item) => item.value === "action:sync-selected")?.disabled,
  "No selected repo"
);

console.log("command palette logic tests passed");

function item(kind: TestItem["kind"], value: string, title: string, searchTerms: string[]): TestItem {
  return {
    kind,
    value,
    title,
    searchTerms
  };
}
