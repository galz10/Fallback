import fs from "node:fs";
import path from "node:path";

export type RepoPathInspection =
  | { kind: "file"; absolutePath: string; stat: fs.Stats }
  | { kind: "directory"; absolutePath: string; stat: fs.Stats }
  | { kind: "symlink"; absolutePath: string; stat: fs.Stats }
  | { kind: "other"; absolutePath: string; stat: fs.Stats }
  | { kind: "missing"; absolutePath: string }
  | { kind: "outside"; absolutePath: string };

export function inspectRepoPath(repoRoot: string, repoRelativePath: string): RepoPathInspection {
  const root = canonicalPath(repoRoot);
  if (path.isAbsolute(repoRelativePath)) return { kind: "outside", absolutePath: repoRelativePath };

  const absolutePath = path.resolve(root, repoRelativePath);
  if (!pathContains(root, absolutePath)) return { kind: "outside", absolutePath };
  if (!fs.existsSync(absolutePath)) return { kind: "missing", absolutePath };

  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink()) return { kind: "symlink", absolutePath, stat };
  if (stat.isFile()) {
    const realPath = canonicalPath(absolutePath);
    if (!pathContains(root, realPath)) return { kind: "outside", absolutePath: realPath };
    return { kind: "file", absolutePath, stat };
  }
  if (stat.isDirectory()) {
    const realPath = canonicalPath(absolutePath);
    if (!pathContains(root, realPath)) return { kind: "outside", absolutePath: realPath };
    return { kind: "directory", absolutePath, stat };
  }
  return { kind: "other", absolutePath, stat };
}

export function pathContains(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

function canonicalPath(value: string): string {
  try {
    return fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}
