import fs from "node:fs";
import path from "node:path";

export const envFiles = [".env.local", ".env"] as const;

export function loadLocalEnv(cwd = process.cwd()): void {
  for (const file of envFiles) {
    const envPath = path.join(cwd, file);
    if (fs.existsSync(envPath)) {
      for (const [key, value] of parseEnv(fs.readFileSync(envPath, "utf8"))) {
        if (!(key in process.env)) process.env[key] = value;
      }
    }
  }
}

export function parseEnv(contents: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) values.set(match[1], unquote(match[2] ?? ""));
  }
  return values;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
