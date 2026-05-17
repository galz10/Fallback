import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SettingsService, validateSettingsPatch } from "../electron/main/settings-service.js";
import { validateHandoffCommand } from "../electron/main/shell/handoff.js";
import { assertTrustedLocalPath } from "../electron/main/shell/trusted-paths.js";

assert.deepEqual(validateSettingsPatch({ syncFrequencyMinutes: 15 }), { syncFrequencyMinutes: 15 });
assert.deepEqual(validateSettingsPatch({ closedIssueRetentionDays: 180 }), { closedIssueRetentionDays: 180 });
assert.equal(new SettingsService().get().restoreWindowsOnLaunch, false);
assert.equal(new SettingsService().get().closedIssueRetentionDays, 365);
assert.deepEqual(validateSettingsPatch({ shell: { preferredEditorCommand: "code --reuse-window" } }), {
  shell: { preferredEditorCommand: "code --reuse-window", preferredTerminalCommand: null }
});
assert.equal(new SettingsService().get().keybindings.commandPalette["my-work"], "Ctrl+M");
assert.equal(
  validateSettingsPatch({ keybindings: { commandPalette: { "my-work": "ctrl+shift+m" } } }).keybindings?.commandPalette["my-work"],
  "Ctrl+Shift+M"
);
assert.equal(validateSettingsPatch({ keybindings: { commandPalette: { "my-work": null } } }).keybindings?.commandPalette["my-work"], null);
assert.deepEqual(
  validateSettingsPatch({ shell: { preferredEditorCommand: "/Applications/Cursor.app/Contents/Resources/app/bin/cursor" } }),
  {
    shell: {
      preferredEditorCommand: "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
      preferredTerminalCommand: null
    }
  }
);
assert.equal(validateHandoffCommand("open -a Terminal"), "open -a Terminal");
assert.equal(validateHandoffCommand("/usr/local/bin/code --reuse-window"), "/usr/local/bin/code --reuse-window");

assert.throws(() => validateSettingsPatch({ unknownFlag: true }), /Unknown settings key/);
assert.throws(() => validateSettingsPatch({ syncFrequencyMinutes: "fast" }), /finite number/);
assert.throws(() => validateSettingsPatch({ closedIssueRetentionDays: "forever" }), /finite number/);
assert.throws(() => validateSettingsPatch({ workspacePath: "relative/workspace" }), /absolute path/);
assert.throws(() => validateSettingsPatch({ shell: { unknown: "code" } }), /Unknown shell settings key/);
assert.throws(() => validateSettingsPatch({ keybindings: { commandPalette: { unknown: "Ctrl+M" } } }), /Unknown commandPalette keybinding/);
assert.throws(() => validateSettingsPatch({ keybindings: { commandPalette: { "my-work": "Ctrl" } } }), /keybinding must be/);
assert.throws(() => validateSettingsPatch({ shell: { preferredEditorCommand: "tools/code" } }), /command name or an absolute/);
assert.throws(() => validateSettingsPatch({ attention: { collapseBotActivity: "yes" } }), /boolean/);
assert.throws(() => validateHandoffCommand("./code"), /command name or an absolute/);
assert.throws(() => validateHandoffCommand("code bad\u0000arg"), /invalid argument/);

const trustedWorkspacePath = path.resolve(path.join(path.sep, "Users", "mona", "Fallback"));
const trustedRepoPath = path.resolve(path.join(path.sep, "Users", "mona", "src", "octo-repo"));
const trustedWorktreePath = path.resolve(path.join(path.sep, "Users", "mona", "src", "octo-repo-worktree"));

const trustedPathServices = {
  settings: { get: () => ({ workspacePath: trustedWorkspacePath }) },
  database: {
    listWatchedReposForActiveAccount: () => [{ id: "octo-repo", localPath: trustedRepoPath }],
    listRepoWorkspaces: (repoId: string) => (repoId === "octo-repo" ? [{ localPath: trustedWorktreePath }] : [])
  }
};

assert.equal(
  assertTrustedLocalPath(trustedPathServices, path.join(trustedRepoPath, "src", "index.ts")),
  path.join(trustedRepoPath, "src", "index.ts")
);
assert.equal(
  assertTrustedLocalPath(trustedPathServices, path.join(trustedWorktreePath, "README.md")),
  path.join(trustedWorktreePath, "README.md")
);
assert.equal(
  assertTrustedLocalPath(trustedPathServices, path.join(trustedWorkspacePath, ".fallback", "fallback.sqlite")),
  path.join(trustedWorkspacePath, ".fallback", "fallback.sqlite")
);
assert.throws(
  () => assertTrustedLocalPath(trustedPathServices, path.join(path.sep, "Users", "mona", "Downloads", "secret.txt")),
  /outside Fallback's trusted workspaces/
);

const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-settings-pointer-test-"));
try {
  const pointerPath = path.join(tempDir, "app-config", "workspace-pointer.json");
  const workspacePath = path.join(tempDir, "custom-workspace");
  const settings = new SettingsService({ workspacePointerPath: pointerPath });
  settings.update({ workspacePath });
  const pointer = JSON.parse(await readFile(pointerPath, "utf8")) as { workspacePath?: string };
  assert.equal(pointer.workspacePath, workspacePath);

  const restarted = new SettingsService({ workspacePointerPath: pointerPath });
  assert.equal(restarted.get().workspacePath, workspacePath);

  const corruptWorkspace = path.join(tempDir, "corrupt-workspace");
  const corruptPointerPath = path.join(tempDir, "corrupt-pointer", "workspace-pointer.json");
  await mkdir(path.join(corruptWorkspace, ".fallback"), { recursive: true });
  await mkdir(path.dirname(corruptPointerPath), { recursive: true });
  await writeFile(path.join(corruptWorkspace, ".fallback", "config.json"), "{ not json");
  await writeFile(corruptPointerPath, JSON.stringify({ workspacePath: corruptWorkspace }));
  const corruptRestart = new SettingsService({ workspacePointerPath: corruptPointerPath });
  assert.equal(corruptRestart.get().workspacePath, corruptWorkspace);
  assert.equal(corruptRestart.diagnostics().configStatus, "corrupt");
  assert.equal(await readFile(path.join(corruptWorkspace, ".fallback", "config.json"), "utf8"), "{ not json");
} finally {
  await rm(tempDir, { force: true, recursive: true });
}

console.log("Settings validation tests ok");
