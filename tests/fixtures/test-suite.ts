import path from "node:path";
import { pathToFileURL } from "node:url";

installStableGitLineEndingConfig();

export async function runScriptTests(scriptPaths: string[]): Promise<void> {
  for (const scriptPath of scriptPaths) {
    await import(pathToFileURL(path.resolve(scriptPath)).href);
  }
}

function installStableGitLineEndingConfig(): void {
  const existingCount = Number(process.env.GIT_CONFIG_COUNT ?? "0");
  const start = Number.isSafeInteger(existingCount) && existingCount >= 0 ? existingCount : 0;
  const entries: Array<[key: string, value: string]> = [
    ["core.autocrlf", "false"],
    ["core.eol", "lf"]
  ];

  for (const [index, [key, value]] of entries.entries()) {
    const configIndex = start + index;
    process.env[`GIT_CONFIG_KEY_${configIndex}`] = key;
    process.env[`GIT_CONFIG_VALUE_${configIndex}`] = value;
  }
  process.env.GIT_CONFIG_COUNT = String(start + entries.length);
}
