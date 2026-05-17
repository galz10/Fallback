import assert from "node:assert/strict";
import {
  editorLaunchCandidates,
  openInEditor,
  openInTerminal,
  revealLaunchCandidates,
  revealPath,
  terminalLaunchCandidates,
  validateHandoffCommand,
  type HandoffExecFile
} from "../electron/main/shell/handoff.js";

const repoPath = "/home/mona/work/repo with spaces";

assert.deepEqual(editorLaunchCandidates(repoPath, "linux", { FALLBACK_EDITOR: "code --reuse-window" })[0], {
  command: "code",
  args: ["--reuse-window", repoPath],
  label: "Configured editor"
});
assert.equal(editorLaunchCandidates(repoPath, "linux", {})[0]?.command, "code");
assert.deepEqual(editorLaunchCandidates(repoPath, "linux", {}, { preferredCommand: "code --reuse-window", line: 42 })[0], {
  command: "code",
  args: ["--reuse-window", `${repoPath}:42`],
  label: "Configured editor"
});
assert.deepEqual(editorLaunchCandidates(repoPath, "linux", {}, { line: 42 })[0], {
  command: "code",
  args: ["-g", `${repoPath}:42`],
  label: "Visual Studio Code"
});
assert.deepEqual(editorLaunchCandidates(`${repoPath}/src/index.ts`, "linux", {}, { line: 42, workspacePath: repoPath })[0], {
  command: "code",
  args: ["--reuse-window", repoPath, "-g", `${repoPath}/src/index.ts:42`],
  label: "Visual Studio Code"
});
assert.deepEqual(editorLaunchCandidates(repoPath, "linux", {}, { workspacePath: repoPath })[0], {
  command: "code",
  args: ["."],
  cwd: repoPath,
  label: "Visual Studio Code"
});
assert.deepEqual(editorLaunchCandidates(repoPath, "darwin", { HOME: "/Users/mona" }, { line: 42 }).slice(0, 4), [
  {
    command: "code",
    args: ["-g", `${repoPath}:42`],
    label: "Visual Studio Code"
  },
  {
    command: "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
    args: ["-g", `${repoPath}:42`],
    label: "Visual Studio Code"
  },
  {
    command: "/Users/mona/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
    args: ["-g", `${repoPath}:42`],
    label: "Visual Studio Code"
  },
  {
    command: "/Users/mona/Applications/Utilities/Visual Studio Code.app/Contents/Resources/app/bin/code",
    args: ["-g", `${repoPath}:42`],
    label: "Visual Studio Code"
  }
]);
assert.deepEqual(
  editorLaunchCandidates(`${repoPath}/src/index.ts`, "darwin", { HOME: "/Users/mona" }, { line: 42, workspacePath: repoPath })[0],
  {
    command: "code",
    args: ["--reuse-window", repoPath, "-g", `${repoPath}/src/index.ts:42`],
    label: "Visual Studio Code"
  }
);
assert.deepEqual(editorLaunchCandidates(repoPath, "darwin", { HOME: "/Users/mona" }, { workspacePath: repoPath })[0], {
  command: "code",
  args: ["."],
  cwd: repoPath,
  label: "Visual Studio Code"
});
assert.ok(
  !editorLaunchCandidates(repoPath, "darwin", { HOME: "/Users/mona" }, { workspacePath: repoPath }).some(
    (candidate) => candidate.command.includes("open") && candidate.args[0]?.startsWith("vscode://file")
  )
);
assert.ok(
  !editorLaunchCandidates(repoPath, "darwin", { HOME: "/Users/mona" }, { workspacePath: repoPath }).some(
    (candidate) =>
      candidate.command.includes("open") && candidate.args.includes("com.microsoft.VSCode") && !candidate.args.includes("--args")
  )
);
assert.ok(
  editorLaunchCandidates(repoPath, "darwin", { HOME: "/Users/mona" }, { workspacePath: repoPath }).some(
    (candidate) =>
      candidate.command === "/usr/bin/open" &&
      candidate.args.join(" ") === "-n -b com.microsoft.VSCode --args ." &&
      candidate.cwd === repoPath
  )
);
assert.ok(
  editorLaunchCandidates(`${repoPath}/src/index.ts`, "darwin", { HOME: "/Users/mona" }, { line: 42, workspacePath: repoPath }).some(
    (candidate) =>
      candidate.command === "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" &&
      candidate.args[0] === "--reuse-window" &&
      candidate.args[1] === repoPath &&
      candidate.args[2] === "-g" &&
      candidate.args[3] === `${repoPath}/src/index.ts:42`
  )
);
assert.ok(
  editorLaunchCandidates(repoPath, "darwin", { HOME: "/Users/mona" }).findIndex((candidate) => candidate.command === "open") <
    editorLaunchCandidates(repoPath, "darwin", { HOME: "/Users/mona" }).findIndex((candidate) => candidate.command === "subl")
);
assert.ok(
  editorLaunchCandidates(repoPath, "darwin", { HOME: "/Users/mona" }, { line: 42 }).some(
    (candidate) => candidate.command === "/usr/bin/open" && candidate.args[0] === "vscode://file/home/mona/work/repo%20with%20spaces:42:1"
  )
);
assert.ok(
  editorLaunchCandidates(repoPath, "darwin", { HOME: "/Users/mona" }).findIndex(
    (candidate) => candidate.command === "/usr/bin/open" && candidate.args.includes("com.microsoft.VSCode")
  ) < editorLaunchCandidates(repoPath, "darwin", { HOME: "/Users/mona" }).findIndex((candidate) => candidate.command === "cursor")
);
assert.deepEqual(terminalLaunchCandidates(repoPath, "linux", {})[0], {
  command: "x-terminal-emulator",
  args: ["--working-directory", repoPath],
  label: "x-terminal-emulator"
});
assert.deepEqual(terminalLaunchCandidates(repoPath, "linux", { FALLBACK_TERMINAL: "gnome-terminal --working-directory" })[0], {
  command: "gnome-terminal",
  args: ["--working-directory", repoPath],
  label: "Configured terminal"
});
assert.deepEqual(terminalLaunchCandidates(repoPath, "darwin", {})[0], {
  command: "open",
  args: ["-a", "Terminal", repoPath],
  label: "Terminal"
});
assert.deepEqual(revealLaunchCandidates(repoPath, "linux")[0], {
  command: "xdg-open",
  args: [repoPath],
  label: "xdg-open"
});
assert.equal(validateHandoffCommand("code --reuse-window"), "code --reuse-window");
assert.equal(validateHandoffCommand("/usr/local/bin/code --reuse-window"), "/usr/local/bin/code --reuse-window");
assert.throws(() => validateHandoffCommand("./code"), /command name or an absolute/);

const editorAttempts: string[] = [];
await openInEditor(repoPath, null, {
  platform: "linux",
  env: {},
  execFile: fakeExec(
    editorAttempts,
    new Set(["code", "cursor", "codium", "subl", "idea", "webstorm", "kate", "gnome-text-editor", "gedit"])
  ),
  pathOpener: {
    async openPath(path) {
      editorAttempts.push(`openPath ${path}`);
      return "";
    }
  }
});
assert.deepEqual(editorAttempts.slice(0, 3), [
  "code /home/mona/work/repo with spaces",
  "cursor /home/mona/work/repo with spaces",
  "codium /home/mona/work/repo with spaces"
]);
assert.equal(editorAttempts.at(-1), "openPath /home/mona/work/repo with spaces");

const terminalAttempts: string[] = [];
await openInTerminal(repoPath, {
  platform: "linux",
  env: {},
  execFile: fakeExec(terminalAttempts, new Set(["x-terminal-emulator", "gnome-terminal"]))
});
assert.deepEqual(terminalAttempts.slice(0, 3), [
  "x-terminal-emulator --working-directory /home/mona/work/repo with spaces",
  "gnome-terminal --working-directory /home/mona/work/repo with spaces",
  "konsole --workdir /home/mona/work/repo with spaces"
]);

await assert.rejects(
  openInTerminal(repoPath, {
    platform: "linux",
    env: {},
    execFile: fakeExec([], new Set(["x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal", "alacritty", "kitty", "wezterm"]))
  }),
  /Terminal handoff failed/
);

const revealAttempts: string[] = [];
await revealPath(repoPath, {
  platform: "linux",
  execFile: fakeExec(revealAttempts, new Set(["xdg-open"])),
  pathOpener: {
    async openPath(path) {
      revealAttempts.push(`openPath ${path}`);
      return "";
    }
  }
});
assert.deepEqual(revealAttempts.slice(0, 2), ["xdg-open /home/mona/work/repo with spaces", "gio open /home/mona/work/repo with spaces"]);

console.log("Shell handoff tests ok");

function fakeExec(attempts: string[], failures: Set<string>): HandoffExecFile {
  return (command, args, _options, callback) => {
    attempts.push(`${command} ${args.join(" ")}`.trim());
    callback(failures.has(command) ? new Error(`${command} unavailable`) : null, "", "");
  };
}
