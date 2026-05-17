export interface ParsedGitWorktree {
  localPath: string;
  headSha: string | null;
  branch: string | null;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  lockReason: string | null;
  prunable: boolean;
  pruneReason: string | null;
}

export function parseGitWorktreePorcelain(stdout: string): ParsedGitWorktree[] {
  const blocks = stdout
    .replaceAll("\0", "\n")
    .split(/\n(?=worktree )/)
    .map((block) => block.trim())
    .filter(Boolean);
  return blocks.flatMap((block) => {
    const lines = block.split("\n").map((line) => line.trimEnd());
    const first = lines[0] ?? "";
    if (!first.startsWith("worktree ")) return [];
    const worktree: ParsedGitWorktree = {
      localPath: first.slice("worktree ".length),
      headSha: null,
      branch: null,
      detached: false,
      bare: false,
      locked: false,
      lockReason: null,
      prunable: false,
      pruneReason: null
    };

    for (const line of lines.slice(1)) {
      if (line.startsWith("HEAD ")) {
        worktree.headSha = line.slice("HEAD ".length);
        continue;
      }
      if (line.startsWith("branch ")) {
        worktree.branch = normalizeBranchName(line.slice("branch ".length));
        continue;
      }
      if (line === "detached") {
        worktree.detached = true;
        continue;
      }
      if (line === "bare") {
        worktree.bare = true;
        continue;
      }
      if (line === "locked" || line.startsWith("locked ")) {
        worktree.locked = true;
        worktree.lockReason = line === "locked" ? null : line.slice("locked ".length).trim() || null;
        continue;
      }
      if (line === "prunable" || line.startsWith("prunable ")) {
        worktree.prunable = true;
        worktree.pruneReason = line === "prunable" ? null : line.slice("prunable ".length).trim() || null;
      }
    }

    if (!worktree.branch) worktree.detached = true;
    return [worktree];
  });
}

function normalizeBranchName(ref: string): string {
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}
