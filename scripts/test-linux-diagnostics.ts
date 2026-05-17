import assert from "node:assert/strict";
import { runLinuxDesktopDiagnostics } from "../electron/main/linux-desktop-diagnostics.js";

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

const missingTools = fakeExec({
  failures: new Set(["git", "gpg-connect-agent", "xdg-open", "sh"])
});

let report = await runLinuxDesktopDiagnostics({
  platform: "linux",
  env: {},
  execFile: missingTools,
  secureStore: {
    async findCredentials() {
      throw new Error("No such interface org.freedesktop.Secret.Service");
    }
  }
});

assert.equal(result(report, "credential_helper")?.summary, "Git credential helper unavailable.");
assert.equal(result(report, "secret_service")?.summary, "Secret Service unavailable.");
assert.equal(result(report, "secret_service")?.status, "failed");
assert.equal(result(report, "gpg_agent")?.summary, "GPG agent not running.");
assert.equal(result(report, "ssh_agent")?.summary, "SSH agent unavailable.");
assert.equal(result(report, "open_url")?.summary, "xdg-open unavailable.");
assert.equal(result(report, "open_url")?.status, "failed");
assert.equal(result(report, "editor_handoff")?.summary, "Editor handoff unavailable.");
assert.equal(result(report, "terminal_handoff")?.summary, "Terminal handoff unavailable.");
assert.equal(result(report, "linux_package")?.summary, "Desktop session unavailable.");

report = await runLinuxDesktopDiagnostics({
  platform: "linux",
  env: {
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
    SSH_AUTH_SOCK: "/run/user/1000/keyring/ssh",
    DISPLAY: ":0",
    XDG_CURRENT_DESKTOP: "GNOME"
  },
  execFile: fakeExec({
    outputs: new Map([
      ["git config --global --get credential.helper", "libsecret\n"],
      ["gpg-connect-agent /bye", "OK\n"],
      ["xdg-open --version", "xdg-open 1.2.1\n"],
      ["sh -lc command -v 'code'", "/usr/bin/code\n"],
      ["sh -lc command -v 'x-terminal-emulator'", "/usr/bin/x-terminal-emulator\n"]
    ])
  }),
  secureStore: {
    async findCredentials() {
      return [];
    }
  }
});

assert.equal(result(report, "credential_helper")?.status, "ok");
assert.equal(result(report, "credential_helper")?.detail, "libsecret");
assert.equal(result(report, "secret_service")?.status, "ok");
assert.equal(result(report, "ssh_agent")?.status, "ok");
assert.equal(result(report, "gpg_agent")?.status, "ok");
assert.equal(result(report, "open_url")?.status, "ok");
assert.equal(result(report, "editor_handoff")?.status, "ok");
assert.equal(result(report, "terminal_handoff")?.status, "ok");
assert.equal(result(report, "linux_package")?.summary, "Linux desktop session detected.");

report = await runLinuxDesktopDiagnostics({
  platform: "linux",
  env: {
    DISPLAY: ":0",
    WSL_DISTRO_NAME: "Ubuntu"
  },
  execFile: fakeExec(),
  secureStore: {
    async findCredentials() {
      return [];
    }
  }
});

assert.equal(result(report, "linux_package")?.summary, "WSL GUI is unsupported.");
assert.deepEqual(await runLinuxDesktopDiagnostics({ platform: "darwin" }), []);

console.log("Linux diagnostics tests ok");

function result(results: Awaited<ReturnType<typeof runLinuxDesktopDiagnostics>>, surface: string) {
  return results.find((item) => item.surface === surface);
}

function fakeExec(input: { outputs?: Map<string, string>; failures?: Set<string> } = {}) {
  return (command: string, args: readonly string[], _options: { timeout: number; env?: NodeJS.ProcessEnv }, callback: ExecCallback) => {
    const key = `${command} ${args.join(" ")}`;
    if (input.failures?.has(command) || input.failures?.has(key)) {
      callback(new Error(`${command} unavailable`), "", "");
      return;
    }
    callback(null, input.outputs?.get(key) ?? "", "");
  };
}
