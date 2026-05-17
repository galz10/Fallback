import { execFile } from "node:child_process";
import type { CredentialDiagnosticResult } from "../../src/shared/domain/repo-identity.js";
import { errorMessage } from "./error-classification.js";
import keytar from "keytar";
import { editorLaunchCandidates, terminalLaunchCandidates } from "./shell/handoff.js";

type DiagnosticBody = Omit<CredentialDiagnosticResult, "surface" | "durationMs">;
type ExecFileLike = (
  command: string,
  args: readonly string[],
  options: { timeout: number; env?: NodeJS.ProcessEnv },
  callback: (error: Error | null, stdout: string, stderr: string) => void
) => void;

export interface SecretServiceProbe {
  findCredentials?(service: string): Promise<unknown[]>;
  getPassword?(service: string, account: string): Promise<string | null>;
}

export interface LinuxDesktopDiagnosticsOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  gitCommand?: string;
  execFile?: ExecFileLike;
  secureStore?: SecretServiceProbe;
}

export async function runLinuxDesktopDiagnostics(options: LinuxDesktopDiagnosticsOptions = {}): Promise<CredentialDiagnosticResult[]> {
  const platform = options.platform ?? process.platform;
  if (platform !== "linux") return [];
  const env = options.env ?? process.env;
  const run = commandRunner(options.execFile ?? execFile, env);
  const gitCommand = options.gitCommand ?? "git";
  const secureStore = options.secureStore ?? keytar;
  return [
    await timed("credential_helper", () => checkCredentialHelper(run, gitCommand)),
    await timed("secret_service", () => checkSecretService(env, secureStore)),
    await timed("ssh_agent", () => checkSshAgent(env)),
    await timed("gpg_agent", () => checkGpgAgent(run)),
    await timed("open_url", () => checkOpenUrl(run)),
    await timed("editor_handoff", () => checkEditorHandoff(run, env)),
    await timed("terminal_handoff", () => checkTerminalHandoff(run, env)),
    await timed("linux_package", () => checkLinuxPackageEnvironment(env))
  ];
}

async function checkCredentialHelper(run: Runner, gitCommand: string): Promise<DiagnosticBody> {
  const [local, global, system] = await Promise.all([
    run(gitCommand, ["config", "--get", "credential.helper"]).catch(() => ""),
    run(gitCommand, ["config", "--global", "--get", "credential.helper"]).catch(() => ""),
    run(gitCommand, ["config", "--system", "--get", "credential.helper"]).catch(() => "")
  ]);
  const helpers = [local, global, system].map((value) => value.trim()).filter(Boolean);
  if (helpers.length === 0) {
    return warning(
      "Git credential helper unavailable.",
      "Git did not report a local, global, or system credential.helper.",
      "Configure a Linux credential helper such as libsecret or rely on GitHub OAuth for API access.",
      "git config --global credential.helper <helper>"
    );
  }
  return ok("Git credential helper configured.", helpers.join(", "), null, "git config --get credential.helper");
}

async function checkSecretService(env: NodeJS.ProcessEnv, secureStore: SecretServiceProbe): Promise<DiagnosticBody> {
  if (!env.DBUS_SESSION_BUS_ADDRESS) {
    return failed(
      "Secret Service unavailable.",
      "DBUS_SESSION_BUS_ADDRESS is not set.",
      "Start Fallback from a desktop session with GNOME Keyring or KWallet, and install libsecret.",
      "keytar.findCredentials Fallback"
    );
  }
  try {
    if (secureStore.findCredentials) {
      await secureStore.findCredentials("Fallback");
    } else if (secureStore.getPassword) {
      await secureStore.getPassword("Fallback", "__fallback_secret_service_probe__");
    }
    return ok("Secret Service available.", "keytar can reach the desktop secret store.", null, "keytar.findCredentials Fallback");
  } catch (error) {
    return failed(
      "Secret Service unavailable.",
      errorMessage(error),
      "Unlock or start the desktop keyring, install libsecret, then reconnect GitHub.",
      "keytar.findCredentials Fallback"
    );
  }
}

async function checkSshAgent(env: NodeJS.ProcessEnv): Promise<DiagnosticBody> {
  const socket = env.SSH_AUTH_SOCK?.trim();
  if (!socket) {
    return warning(
      "SSH agent unavailable.",
      "SSH_AUTH_SOCK is not set.",
      "Start an SSH agent or add keys before using SSH remotes and SSH commit signing.",
      "ssh-add -l"
    );
  }
  return ok("SSH agent available.", "SSH_AUTH_SOCK is set.", null, "ssh-add -l");
}

async function checkGpgAgent(run: Runner): Promise<DiagnosticBody> {
  try {
    await run("gpg-connect-agent", ["/bye"]);
    return ok("GPG agent running.", "gpg-connect-agent completed.", null, "gpg-connect-agent /bye");
  } catch (error) {
    return warning(
      "GPG agent not running.",
      errorMessage(error),
      "Start gpg-agent or run gpg once from the desktop session before using GPG signing.",
      "gpg-connect-agent /bye"
    );
  }
}

async function checkOpenUrl(run: Runner): Promise<DiagnosticBody> {
  try {
    await run("xdg-open", ["--version"]);
    return ok("xdg-open available.", "Desktop URL and file handoff can use xdg-open.", null, "xdg-open <url>");
  } catch (error) {
    return failed(
      "xdg-open unavailable.",
      errorMessage(error),
      "Install xdg-utils and retry browser, file, editor, and terminal handoff.",
      "xdg-open <url>"
    );
  }
}

async function checkEditorHandoff(run: Runner, env: NodeJS.ProcessEnv): Promise<DiagnosticBody> {
  const candidates = editorLaunchCandidates("/tmp", "linux", env);
  const available = await firstAvailableCommand(
    run,
    candidates.map((candidate) => candidate.command)
  );
  if (!available) {
    return warning(
      "Editor handoff unavailable.",
      "Fallback could not find a supported editor launcher on PATH.",
      "Configure a preferred editor command in Settings or install a supported editor CLI such as code, cursor, subl, kate, or gedit.",
      "command -v <editor>"
    );
  }
  return ok("Editor handoff available.", `${available} is on PATH.`, null, "command -v <editor>");
}

async function checkTerminalHandoff(run: Runner, env: NodeJS.ProcessEnv): Promise<DiagnosticBody> {
  const candidates = terminalLaunchCandidates("/tmp", "linux", env);
  const available = await firstAvailableCommand(
    run,
    candidates.map((candidate) => candidate.command)
  );
  if (!available) {
    return warning(
      "Terminal handoff unavailable.",
      "Fallback could not find a supported terminal launcher on PATH.",
      "Configure a preferred terminal command in Settings or install x-terminal-emulator, gnome-terminal, konsole, kitty, or wezterm.",
      "command -v <terminal>"
    );
  }
  return ok("Terminal handoff available.", `${available} is on PATH.`, null, "command -v <terminal>");
}

async function checkLinuxPackageEnvironment(env: NodeJS.ProcessEnv): Promise<DiagnosticBody> {
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) {
    return warning(
      "WSL GUI is unsupported.",
      "Linux beta validation does not cover WSL GUI sessions.",
      "Use Ubuntu LTS GNOME or Fedora KDE on a regular desktop session.",
      null
    );
  }
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) {
    return warning(
      "Desktop session unavailable.",
      "Neither DISPLAY nor WAYLAND_DISPLAY is set.",
      "Run the AppImage or deb package from a graphical desktop session, or use xvfb-run for package smoke tests.",
      "xvfb-run -a Fallback*.AppImage --no-sandbox"
    );
  }
  if (env.APPIMAGE) {
    return ok("AppImage environment detected.", "Running from an AppImage desktop session.", null, null);
  }
  if (env.XDG_CURRENT_DESKTOP) {
    return ok("Linux desktop session detected.", `XDG_CURRENT_DESKTOP=${env.XDG_CURRENT_DESKTOP}`, null, null);
  }
  return ok("Linux package environment detected.", "A graphical desktop session is available.", null, null);
}

type Runner = (command: string, args: readonly string[], timeoutMs?: number) => Promise<string>;

function commandRunner(execFileLike: ExecFileLike, env: NodeJS.ProcessEnv): Runner {
  return (command, args, timeoutMs = 10_000) =>
    new Promise((resolve, reject) => {
      execFileLike(command, args, { timeout: timeoutMs, env }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(`${stdout}${stderr}`);
      });
    });
}

async function firstAvailableCommand(run: Runner, commands: string[]): Promise<string | null> {
  for (const command of commands) {
    try {
      await run("sh", ["-lc", `command -v ${shellQuote(command)}`], 5_000);
      return command;
    } catch {
      continue;
    }
  }
  return null;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function timed(
  surface: CredentialDiagnosticResult["surface"],
  run: () => Promise<DiagnosticBody>
): Promise<CredentialDiagnosticResult> {
  const started = Date.now();
  return { surface, ...(await run()), durationMs: Date.now() - started };
}

function ok(summary: string, detail: string | null, remediation: string | null, redactedCommand: string | null): DiagnosticBody {
  return { status: "ok", summary, detail, remediation, redactedCommand };
}

function warning(summary: string, detail: string | null, remediation: string | null, redactedCommand: string | null): DiagnosticBody {
  return { status: "warning", summary, detail, remediation, redactedCommand };
}

function failed(summary: string, detail: string | null, remediation: string | null, redactedCommand: string | null): DiagnosticBody {
  return { status: "failed", summary, detail, remediation, redactedCommand };
}
