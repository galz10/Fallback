import path from "node:path";
import { pathToFileURL } from "node:url";

export async function runScriptTests(scriptPaths: string[]): Promise<void> {
  for (const scriptPath of scriptPaths) {
    await import(pathToFileURL(path.resolve(scriptPath)).href);
  }
}
