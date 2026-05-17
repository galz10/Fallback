import { readdir, readFile, stat } from "node:fs/promises";
import { relative } from "node:path";

const root = new URL("../", import.meta.url);
const configUrl = new URL("../.repo-limits.json", import.meta.url);
const textDecoder = new TextDecoder("utf-8", { fatal: false });

const config = JSON.parse(await readFile(configUrl, "utf8"));

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
}

function globToRegex(pattern) {
  const normalized = pattern.replaceAll("\\", "/");
  const parts = normalized.split(/(\*\*)|(\*)/u).filter(Boolean);
  const source = parts
    .map((part) => {
      if (part === "**") return ".*";
      if (part === "*") return "[^/]*";
      return escapeRegex(part);
    })
    .join("");

  return new RegExp(`^${source}$`, "u");
}

const ignoredPatterns = config.ignore.map(globToRegex);
const overrides = config.overrides.map((override) => ({
  ...override,
  regex: globToRegex(override.pattern)
}));

function isIgnored(path) {
  return ignoredPatterns.some((pattern) => pattern.test(path));
}

function limitsFor(path) {
  const override = overrides.find(({ regex }) => regex.test(path));

  return {
    maxBytes: override?.maxBytes ?? config.maxBytes,
    maxLines: override?.maxLines ?? config.maxLines
  };
}

async function listFiles(directoryUrl) {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directoryUrl);
    const path = relative(root.pathname, entryUrl.pathname).replaceAll("\\", "/");

    if (isIgnored(path) || isIgnored(`${path}/`)) continue;

    if (entry.isDirectory()) {
      files.push(...(await listFiles(entryUrl)));
      continue;
    }

    if (entry.isFile()) files.push({ path, url: entryUrl });
  }

  return files;
}

const violations = [];

for (const file of await listFiles(root)) {
  const fileStat = await stat(file.url);
  const { maxBytes, maxLines } = limitsFor(file.path);
  const bytes = fileStat.size;

  if (bytes > maxBytes) {
    violations.push(`${file.path}: ${bytes} bytes exceeds ${maxBytes} bytes`);
    continue;
  }

  const contents = textDecoder.decode(await readFile(file.url));
  const lines = contents.length === 0 ? 0 : contents.split(/\r\n|\r|\n/u).length;

  if (lines > maxLines) violations.push(`${file.path}: ${lines} lines exceeds ${maxLines} lines`);
}

if (violations.length > 0) {
  process.stderr.write(`File size limits failed:\n${violations.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("File size limits passed.\n");
}
