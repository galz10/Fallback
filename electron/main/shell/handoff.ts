import { execFile } from "node:child_process";

export type HandoffKind = "editor" | "terminal";

export interface LaunchCandidate {
  command: string;
  args: string[];
  cwd?: string;
  label: string;
}

export interface PathOpener {
  openPath(path: string): Promise<string>;
  showItemInFolder?(path: string): void;
}

export type HandoffExecFile = (
  command: string,
  args: readonly string[],
  options: { timeout: number; cwd?: string; env?: NodeJS.ProcessEnv; windowsHide?: boolean },
  callback: (error: Error | null, stdout: string, stderr: string) => void
) => void;

export interface HandoffOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  execFile?: HandoffExecFile;
  pathOpener?: PathOpener;
  preferredEditorCommand?: string | null;
  preferredTerminalCommand?: string | null;
  workspacePath?: string | null;
}

export async function openInEditor(targetPath: string, line?: number | null, options: HandoffOptions = {}): Promise<void> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const candidates = editorLaunchCandidates(targetPath, platform, env, {
    preferredCommand: options.preferredEditorCommand,
    line,
    workspacePath: options.workspacePath
  });
  const launched = await runFirstCandidate(candidates, options);
  if (launched) return;
  if (options.pathOpener) {
    const error = await options.pathOpener.openPath(targetPath);
    if (!error) return;
    throw new Error(`Editor handoff failed; default app open also failed: ${error}`);
  }
  throw new Error("Editor handoff failed. Configure FALLBACK_EDITOR, VISUAL, EDITOR, or install a supported editor CLI.");
}

export async function openInTerminal(targetPath: string, options: HandoffOptions = {}): Promise<void> {
  const platform = options.platform ?? process.platform;
  const env = options.preferredTerminalCommand
    ? { ...(options.env ?? process.env), FALLBACK_TERMINAL: options.preferredTerminalCommand }
    : (options.env ?? process.env);
  const candidates = terminalLaunchCandidates(targetPath, platform, env);
  const launched = await runFirstCandidate(candidates, options);
  if (launched) return;
  throw new Error("Terminal handoff failed. Configure FALLBACK_TERMINAL or install a supported terminal launcher.");
}

export async function revealPath(targetPath: string, options: HandoffOptions = {}): Promise<void> {
  const platform = options.platform ?? process.platform;
  if (options.pathOpener?.showItemInFolder) {
    options.pathOpener.showItemInFolder(targetPath);
    return;
  }
  if (options.pathOpener && platform !== "linux") {
    const error = await options.pathOpener.openPath(targetPath);
    if (!error) return;
    throw new Error(`Reveal failed: ${error}`);
  }
  const candidates = revealLaunchCandidates(targetPath, platform);
  const launched = await runFirstCandidate(candidates, options);
  if (launched) return;
  if (options.pathOpener) {
    const error = await options.pathOpener.openPath(targetPath);
    if (!error) return;
    throw new Error(`Reveal failed; default app open also failed: ${error}`);
  }
  throw new Error("Reveal failed. Install a platform file manager or xdg-utils.");
}

export function editorLaunchCandidates(
  targetPath: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  input: { preferredCommand?: string | null; line?: number | null; workspacePath?: string | null } = {}
): LaunchCandidate[] {
  const workspaceCwd = input.workspacePath && !input.line ? input.workspacePath : undefined;
  const configured = configuredCommand(
    input.preferredCommand ?? env.FALLBACK_EDITOR ?? env.VISUAL ?? env.EDITOR,
    editorTargetArgs(targetPath, platform, input.line, input.workspacePath),
    "Configured editor",
    workspaceCwd
  );
  if (configured) return [configured];
  const directTarget = targetPath;
  const lineTarget = editorTarget(targetPath, platform, input.line);
  const vscodeArgs = vscodeTargetArgs(directTarget, lineTarget, input.line, input.workspacePath);
  if (platform === "darwin") {
    if (input.workspacePath && !input.line) {
      const cursorArgs = ["."];
      return [
        launchCandidate("code", vscodeArgs, "Visual Studio Code", workspaceCwd),
        ...darwinAppCliCandidates("Visual Studio Code", "code", env, vscodeArgs, workspaceCwd),
        launchCandidate("/usr/bin/open", ["-n", "-b", "com.microsoft.VSCode", "--args", ...vscodeArgs], "Visual Studio Code", workspaceCwd),
        launchCandidate("open", ["-n", "-b", "com.microsoft.VSCode", "--args", ...vscodeArgs], "Visual Studio Code", workspaceCwd),
        launchCandidate("cursor", cursorArgs, "Cursor", workspaceCwd),
        ...darwinAppCliCandidates("Cursor", "cursor", env, cursorArgs, workspaceCwd),
        launchCandidate("open", ["-n", "-a", "Cursor", "--args", ...cursorArgs], "Cursor", workspaceCwd),
        launchCandidate("subl", ["."], "Sublime Text", workspaceCwd),
        launchCandidate("open", ["-n", "-a", "Sublime Text", "."], "Sublime Text", workspaceCwd)
      ];
    }
    const vscodeUri = vscodeFileUri(directTarget, input.line);
    return [
      { command: "code", args: vscodeArgs, label: "Visual Studio Code" },
      ...darwinAppCliCandidates("Visual Studio Code", "code", env, vscodeArgs),
      { command: "/usr/bin/open", args: [vscodeUri], label: "Visual Studio Code" },
      { command: "/usr/bin/open", args: ["-b", "com.microsoft.VSCode", directTarget], label: "Visual Studio Code" },
      { command: "open", args: [vscodeUri], label: "Visual Studio Code" },
      { command: "open", args: ["-b", "com.microsoft.VSCode", directTarget], label: "Visual Studio Code" },
      { command: "open", args: ["-a", "Visual Studio Code", directTarget], label: "Visual Studio Code" },
      { command: "cursor", args: input.line ? ["-g", lineTarget] : [directTarget], label: "Cursor" },
      ...darwinAppCliCandidates("Cursor", "cursor", env, input.line ? ["-g", lineTarget] : [directTarget]),
      { command: "open", args: ["-a", "Cursor", directTarget], label: "Cursor" },
      { command: "subl", args: [lineTarget], label: "Sublime Text" },
      { command: "open", args: ["-a", "Sublime Text", directTarget], label: "Sublime Text" }
    ];
  }
  if (platform === "win32") {
    return [
      launchCandidate("code.cmd", vscodeArgs, "Visual Studio Code", workspaceCwd),
      ...windowsEditorCandidates("Microsoft VS Code", "Code.exe", env, vscodeArgs, workspaceCwd),
      launchCandidate(
        "cursor.cmd",
        input.workspacePath && !input.line ? ["."] : input.line ? ["-g", lineTarget] : [directTarget],
        "Cursor",
        workspaceCwd
      ),
      ...windowsEditorCandidates(
        "Cursor",
        "Cursor.exe",
        env,
        input.workspacePath && !input.line ? ["."] : input.line ? ["-g", lineTarget] : [directTarget],
        workspaceCwd
      ),
      { command: "sublime_text.exe", args: [lineTarget], label: "Sublime Text" }
    ];
  }
  return [
    launchCandidate("code", vscodeArgs, "Visual Studio Code", workspaceCwd),
    launchCandidate(
      "cursor",
      input.workspacePath && !input.line ? ["."] : input.line ? ["-g", lineTarget] : [directTarget],
      "Cursor",
      workspaceCwd
    ),
    launchCandidate(
      "codium",
      input.workspacePath && !input.line ? ["."] : input.line ? ["-g", lineTarget] : [directTarget],
      "VSCodium",
      workspaceCwd
    ),
    { command: "subl", args: [lineTarget], label: "Sublime Text" },
    { command: "idea", args: input.line ? ["--line", String(input.line), directTarget] : [directTarget], label: "IntelliJ IDEA" },
    { command: "webstorm", args: input.line ? ["--line", String(input.line), directTarget] : [directTarget], label: "WebStorm" },
    { command: "kate", args: input.line ? [`${directTarget}:${input.line}`] : [directTarget], label: "Kate" },
    { command: "gnome-text-editor", args: [directTarget], label: "GNOME Text Editor" },
    { command: "gedit", args: input.line ? [`+${input.line}`, directTarget] : [directTarget], label: "gedit" }
  ];
}

export function terminalLaunchCandidates(targetPath: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): LaunchCandidate[] {
  const configured = configuredCommand(env.FALLBACK_TERMINAL, [targetPath], "Configured terminal");
  if (configured) return [configured];
  if (platform === "darwin") {
    return [
      { command: "open", args: ["-a", "Terminal", targetPath], label: "Terminal" },
      { command: "open", args: ["-a", "iTerm", targetPath], label: "iTerm" }
    ];
  }
  if (platform === "win32") {
    return [{ command: "cmd.exe", args: ["/c", "start", "", "/D", targetPath, "cmd.exe"], label: "Command Prompt" }];
  }
  return [
    { command: "x-terminal-emulator", args: ["--working-directory", targetPath], label: "x-terminal-emulator" },
    { command: "gnome-terminal", args: ["--working-directory", targetPath], label: "GNOME Terminal" },
    { command: "konsole", args: ["--workdir", targetPath], label: "Konsole" },
    { command: "xfce4-terminal", args: ["--working-directory", targetPath], label: "Xfce Terminal" },
    { command: "alacritty", args: ["--working-directory", targetPath], label: "Alacritty" },
    { command: "kitty", args: ["--directory", targetPath], label: "kitty" },
    { command: "wezterm", args: ["start", "--cwd", targetPath], label: "WezTerm" }
  ];
}

export function revealLaunchCandidates(targetPath: string, platform: NodeJS.Platform): LaunchCandidate[] {
  if (platform === "darwin") return [{ command: "open", args: ["-R", targetPath], label: "Finder" }];
  if (platform === "win32") return [{ command: "explorer.exe", args: ["/select,", targetPath], label: "Explorer" }];
  return [
    { command: "xdg-open", args: [targetPath], label: "xdg-open" },
    { command: "gio", args: ["open", targetPath], label: "GIO" },
    { command: "dolphin", args: ["--select", targetPath], label: "Dolphin" },
    { command: "nautilus", args: [targetPath], label: "Files" }
  ];
}

async function runFirstCandidate(candidates: LaunchCandidate[], options: HandoffOptions): Promise<boolean> {
  const execFileLike = options.execFile ?? (execFile as unknown as HandoffExecFile);
  const env = options.env ?? process.env;
  for (const candidate of candidates) {
    try {
      await runCandidate(candidate, execFileLike, env);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

function runCandidate(candidate: LaunchCandidate, execFileLike: HandoffExecFile, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    execFileLike(candidate.command, candidate.args, { timeout: 10_000, cwd: candidate.cwd, env, windowsHide: true }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function launchCandidate(command: string, args: string[], label: string, cwd?: string): LaunchCandidate {
  return cwd ? { command, args, cwd, label } : { command, args, label };
}

function configuredCommand(value: string | null | undefined, targetArgs: string[], label: string, cwd?: string): LaunchCandidate | null {
  const parsed = parseCommandLine(value);
  if (!parsed) return null;
  return launchCandidate(parsed.command, [...parsed.args, ...targetArgs], label, cwd);
}

export function validateHandoffCommand(value: string, label = "Command"): string {
  const parsed = parseCommandLine(value);
  if (!parsed) throw new Error(`${label} is required.`);
  if (!isExecutableCommandToken(parsed.command)) {
    throw new Error(`${label} must start with a command name or an absolute executable path.`);
  }
  for (const arg of parsed.args) {
    if (arg.includes("\0")) throw new Error(`${label} contains an invalid argument.`);
  }
  return [parsed.command, ...parsed.args].join(" ");
}

function darwinAppCliCandidates(appName: string, cliName: string, env: NodeJS.ProcessEnv, args: string[], cwd?: string): LaunchCandidate[] {
  const appCliPath = `${appName}.app/Contents/Resources/app/bin/${cliName}`;
  return uniqueCommands(
    [
      `/Applications/${appCliPath}`,
      env.HOME ? `${env.HOME}/Applications/${appCliPath}` : null,
      env.HOME ? `${env.HOME}/Applications/Utilities/${appCliPath}` : null
    ],
    args,
    appName,
    cwd
  );
}

function windowsEditorCandidates(
  appFolder: string,
  executable: string,
  env: NodeJS.ProcessEnv,
  args: string[],
  cwd?: string
): LaunchCandidate[] {
  return uniqueCommands(
    [
      env.LOCALAPPDATA ? `${env.LOCALAPPDATA}\\Programs\\${appFolder}\\${executable}` : null,
      env.PROGRAMFILES ? `${env.PROGRAMFILES}\\${appFolder}\\${executable}` : null,
      env["PROGRAMFILES(X86)"] ? `${env["PROGRAMFILES(X86)"]}\\${appFolder}\\${executable}` : null
    ],
    args,
    appFolder === "Microsoft VS Code" ? "Visual Studio Code" : appFolder,
    cwd
  );
}

function uniqueCommands(commands: Array<string | null>, args: string[], label: string, cwd?: string): LaunchCandidate[] {
  const seen = new Set<string>();
  return commands.flatMap((command) => {
    if (!command || seen.has(command)) return [];
    seen.add(command);
    return [launchCandidate(command, args, label, cwd)];
  });
}

function parseCommandLine(value: string | null | undefined): { command: string; args: string[] } | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const parts = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((part) => part.replace(/^["']|["']$/g, "")) ?? [];
  if (!parts[0]) return null;
  return { command: parts[0], args: parts.slice(1) };
}

function isExecutableCommandToken(command: string): boolean {
  if (command.includes("\0")) return false;
  if (pathIsAbsolute(command)) return true;
  return /^[A-Za-z0-9._+-]+$/.test(command);
}

function pathIsAbsolute(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

function editorTarget(targetPath: string, platform: NodeJS.Platform, line: number | null | undefined): string {
  const validLine = Number.isInteger(line) && Number(line) > 0 ? Number(line) : null;
  if (!validLine) return targetPath;
  return platform === "win32" ? `${targetPath}:${validLine}:1` : `${targetPath}:${validLine}`;
}

function editorTargetArgs(
  targetPath: string,
  platform: NodeJS.Platform,
  line: number | null | undefined,
  workspacePath: string | null | undefined
): string[] {
  const lineTarget = editorTarget(targetPath, platform, line);
  if (workspacePath && !line) return ["."];
  return workspacePath && line ? [workspacePath, lineTarget] : [lineTarget];
}

function vscodeTargetArgs(
  targetPath: string,
  lineTarget: string,
  line: number | null | undefined,
  workspacePath: string | null | undefined
): string[] {
  if (workspacePath && line) return ["--reuse-window", workspacePath, "-g", lineTarget];
  if (workspacePath) return ["."];
  return line ? ["-g", lineTarget] : [targetPath];
}

function vscodeFileUri(targetPath: string, line: number | null | undefined): string {
  const validLine = Number.isInteger(line) && Number(line) > 0 ? Number(line) : null;
  const suffix = validLine ? `:${validLine}:1` : "";
  return `vscode://file${encodeURI(targetPath)}${suffix}`;
}
