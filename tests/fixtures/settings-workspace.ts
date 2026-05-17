import path from "node:path";
import { SettingsService } from "../../electron/main/settings-service.js";
import { WorkspaceService } from "../../electron/main/workspace-service.js";
import { withTempDir } from "./temp.js";

export async function withSettingsWorkspace<T>(
  prefix: string,
  run: (input: { tempDir: string; settings: SettingsService; workspace: WorkspaceService }) => Promise<T>
): Promise<T> {
  return withTempDir(prefix, async (tempDir) => {
    const settings = new SettingsService({ workspacePointerPath: path.join(tempDir, "settings-pointer.json") });
    settings.update({ workspacePath: tempDir });
    const workspace = new WorkspaceService(() => settings.get());
    return run({ tempDir, settings, workspace });
  });
}
