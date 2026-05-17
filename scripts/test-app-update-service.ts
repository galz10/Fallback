import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { AppUpdater, ProgressInfo, UpdateInfo } from "electron-updater";
import { AppUpdateService, parseUpdateRepository } from "../electron/main/app-update-service.js";

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowPrerelease = true;
  channel = "beta";
  feedURL: unknown = null;
  checkCount = 0;
  downloadCount = 0;
  installed = false;
  updateInfo: UpdateInfo | null = null;

  setFeedURL(feedURL: unknown): void {
    this.feedURL = feedURL;
  }

  async checkForUpdates(): Promise<unknown> {
    this.checkCount += 1;
    this.emit("checking-for-update");
    if (this.updateInfo) {
      this.emit("update-available", this.updateInfo);
      return { updateInfo: this.updateInfo };
    }
    const current = updateInfo("1.0.0");
    this.emit("update-not-available", current);
    return { updateInfo: current };
  }

  async downloadUpdate(): Promise<string[]> {
    this.downloadCount += 1;
    this.emit("download-progress", { percent: 37 } satisfies Pick<ProgressInfo, "percent">);
    this.emit("update-downloaded", this.updateInfo ?? updateInfo("1.0.1"));
    return [];
  }

  quitAndInstall(): void {
    this.installed = true;
  }
}

assert.deepEqual(parseUpdateRepository("owner/repo"), { owner: "owner", repo: "repo" });
assert.deepEqual(parseUpdateRepository("https://github.com/owner/repo.git"), { owner: "owner", repo: "repo" });
assert.equal(parseUpdateRepository("owner/repo/extra"), null);

const disabledDev = new AppUpdateService(undefined, {
  isPackaged: false,
  updateRepository: "owner/repo",
  env: {}
});
assert.equal(disabledDev.getState().enabled, false);
assert.equal(disabledDev.getState().status, "disabled");
assert.match(disabledDev.getState().message ?? "", /development/);

const disabledByEnv = new AppUpdateService(undefined, {
  isPackaged: true,
  updateRepository: "owner/repo",
  env: { FALLBACK_DISABLE_UPDATES: "1" }
});
assert.equal(disabledByEnv.getState().enabled, false);
assert.match(disabledByEnv.getState().message ?? "", /environment/);

const updater = new FakeUpdater();
const service = new AppUpdateService(undefined, {
  updater: updater as unknown as AppUpdater,
  isPackaged: true,
  updateRepository: "owner/repo",
  currentVersion: "1.0.0",
  env: {},
  now: () => "2026-05-11T12:00:00.000Z"
});
assert.equal(service.getState().enabled, true);
assert.equal(updater.autoDownload, false);
assert.equal(updater.autoInstallOnAppQuit, false);
assert.equal(updater.allowPrerelease, false);
assert.equal(updater.channel, "latest");
assert.deepEqual(updater.feedURL, { provider: "github", owner: "owner", repo: "repo" });

const rejectedDownload = await service.download();
assert.equal(rejectedDownload.accepted, false);
assert.equal(updater.downloadCount, 0);

updater.updateInfo = updateInfo("1.1.0");
const check = await service.check();
assert.equal(check.checked, true);
assert.equal(check.state.status, "available");
assert.equal(check.state.availableVersion, "1.1.0");
assert.equal(check.state.checkedAt, "2026-05-11T12:00:00.000Z");
assert.equal(updater.downloadCount, 0);

const download = await service.download();
assert.equal(download.accepted, true);
assert.equal(download.state.status, "downloaded");
assert.equal(download.state.downloadedVersion, "1.1.0");
assert.equal(download.state.downloadPercent, 100);
assert.equal(updater.downloadCount, 1);

const install = await service.install();
assert.equal(install.accepted, true);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(updater.installed, true);

const idleUpdater = new FakeUpdater();
const idleService = new AppUpdateService(undefined, {
  updater: idleUpdater as unknown as AppUpdater,
  isPackaged: true,
  updateRepository: "owner/repo",
  env: {}
});
const idleCheck = await idleService.check();
assert.equal(idleCheck.state.status, "idle");
assert.equal(idleCheck.state.availableVersion, "1.0.0");
assert.match(idleCheck.state.message ?? "", /No update/);

console.log("App update service tests ok");

function updateInfo(version: string): UpdateInfo {
  return {
    version,
    releaseName: `Fallback ${version}`,
    releaseNotes: `Release ${version}`,
    releaseDate: "2026-05-11T12:00:00.000Z",
    files: [],
    path: "",
    sha512: ""
  } as UpdateInfo;
}
