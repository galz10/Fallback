import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { diffStatSuspicion, parsePullRequestNumbersFromCommitMessage } from "../src/shared/branch-integrity.js";

const execFileAsync = promisify(execFile);

interface Finding {
  severity: "critical" | "high" | "medium" | "low";
  kind: string;
  commitSha: string;
  expectedTree?: string | null;
  landedTree?: string | null;
  prNumbers: number[];
  summary: string;
}

const options = parseArgs(process.argv.slice(2));
const repoPath = path.resolve(options.repo ?? ".");
const auditedAt = new Date().toISOString();

await git(["fetch", "origin", "--prune"]).catch(() => "");
await git(["fetch", "origin", "+refs/fallback/*:refs/fallback/*"], [0, 1, 128]).catch(() => "");

const branch = await resolveAuditRef(options.branch ?? "origin/main");
const commits = await firstParentCommits(branch, options);
const fallbackRefs = await fallbackMergeGroupRefs();
const findings: Finding[] = [];

for (const commit of commits) {
  const stat = await commitStat(commit.parentSha, commit.sha);
  const prNumbers = parsePullRequestNumbersFromCommitMessage(`${commit.subject}\n${commit.body}`);
  if (fallbackRefs.length === 1 && fallbackRefs[0].treeSha && fallbackRefs[0].treeSha !== commit.treeSha) {
    findings.push({
      severity: "critical",
      kind: "tested_tree_mismatch",
      commitSha: commit.sha,
      expectedTree: fallbackRefs[0].treeSha,
      landedTree: commit.treeSha,
      prNumbers,
      summary: "Landed tree differs from the preserved merge-group tree."
    });
  }
  const suspicion = diffStatSuspicion(stat, expectedStatFromCli(options));
  if (suspicion.suspicious && suspicion.kind) {
    findings.push({
      severity: "high",
      kind: suspicion.kind,
      commitSha: commit.sha,
      landedTree: commit.treeSha,
      prNumbers,
      summary: suspicion.summary ?? "Landed diff shape is suspicious."
    });
  }
  if (stat.deletions >= 500 && stat.deletions >= Math.max(1, stat.additions) * 3) {
    findings.push({
      severity: "high",
      kind: "possible_reversion",
      commitSha: commit.sha,
      landedTree: commit.treeSha,
      prNumbers,
      summary: `Commit removes ${stat.deletions} lines while adding ${stat.additions}; this may be a broad rollback.`
    });
  }
  if (prNumbers.length === 0 && stat.additions + stat.deletions >= 50) {
    findings.push({
      severity: "medium",
      kind: "unknown_merge_source",
      commitSha: commit.sha,
      landedTree: commit.treeSha,
      prNumbers,
      summary: "Material first-parent branch update has no PR number in the commit message."
    });
  }
}

const report = {
  repoPath,
  branch,
  auditedAt,
  range: { since: options.since ?? null, until: options.until ?? null },
  commitsAudited: commits.length,
  findings
};
const outDir = await mkdtemp(path.join(tmpdir(), "fallback-branch-integrity-"));
const reportPath = path.join(outDir, "report.json");
await writeFile(reportPath, JSON.stringify(report, null, 2));

if (options.json) {
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
} else {
  console.log(`Branch Integrity audit for ${branch}`);
  console.log(`Repository: ${repoPath}`);
  console.log(`Commits audited: ${commits.length}`);
  console.log(`Findings: ${findings.length}`);
  for (const finding of findings) {
    console.log(`- [${finding.severity}] ${finding.kind} ${finding.commitSha.slice(0, 7)}: ${finding.summary}`);
  }
  console.log(`JSON report: ${reportPath}`);
}

if (shouldFail(findings, options.failOn)) process.exitCode = 1;

async function firstParentCommits(ref: string, input: Record<string, string | undefined>) {
  const args = ["log", "--first-parent", "--format=%H%x00%P%x00%T%x00%cI%x00%s%x00%B%x1e"];
  if (input.since) args.push(`--since=${input.since}`);
  if (input.until) args.push(`--until=${input.until}`);
  args.push(`-${input.limit ?? "80"}`, ref);
  const stdout = await git(args);
  return stdout
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha = "", parents = "", treeSha = "", committedAt = "", subject = "", body = ""] = record.split("\0");
      return { sha, parentSha: parents.split(/\s+/).filter(Boolean)[0] ?? null, treeSha, committedAt, subject, body };
    });
}

async function resolveAuditRef(ref: string): Promise<string> {
  if (await refExists(ref)) return ref;
  const localBranch = ref.startsWith("origin/") ? ref.slice("origin/".length) : null;
  if (localBranch && (await refExists(localBranch))) return localBranch;
  if (await refExists("HEAD")) return "HEAD";
  return ref;
}

async function refExists(ref: string): Promise<boolean> {
  return git(["rev-parse", "--verify", `${ref}^{commit}`])
    .then(() => true)
    .catch(() => false);
}

async function commitStat(parentSha: string | null, sha: string) {
  const range = parentSha ? [parentSha, sha] : [`${sha}^!`];
  const [numstat, names] = await Promise.all([git(["diff", "--numstat", ...range]), git(["diff", "--name-only", ...range])]);
  const totals = numstat
    .split("\n")
    .filter(Boolean)
    .reduce(
      (sum, line) => {
        const [additions, deletions] = line.split("\t");
        return {
          additions: sum.additions + (additions === "-" ? 0 : Number(additions) || 0),
          deletions: sum.deletions + (deletions === "-" ? 0 : Number(deletions) || 0)
        };
      },
      { additions: 0, deletions: 0 }
    );
  return { ...totals, changedFiles: names.split("\n").filter(Boolean).length };
}

async function fallbackMergeGroupRefs() {
  const stdout = await git(["for-each-ref", "--format=%(refname)%00%(objectname)", "refs/fallback/merge-groups"]).catch(() => "");
  const refs = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [ref, sha] = line.split("\0");
      return { ref, sha };
    })
    .filter((item): item is { ref: string; sha: string } => Boolean(item.ref && item.sha));
  return Promise.all(refs.map(async (item) => ({ ...item, treeSha: await git(["rev-parse", `${item.sha}^{tree}`]).catch(() => null) })));
}

async function git(args: string[], allowExitCodes = [0]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: repoPath, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    return stdout.trim();
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? Number((error as { code: unknown }).code) : 1;
    if (allowExitCodes.includes(code)) return String((error as { stdout?: string }).stdout ?? "").trim();
    throw error;
  }
}

function expectedStatFromCli(input: Record<string, string | undefined>) {
  const additions = input.expectedAdditions ? Number(input.expectedAdditions) : null;
  const deletions = input.expectedDeletions ? Number(input.expectedDeletions) : null;
  if (additions == null || deletions == null || !Number.isFinite(additions) || !Number.isFinite(deletions)) return null;
  return { additions, deletions, changedFiles: input.expectedChangedFiles ? Number(input.expectedChangedFiles) || 0 : 0 };
}

function parseArgs(args: string[]): Record<string, string | undefined> {
  const parsed: Record<string, string | undefined> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replaceAll(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    const next = args[index + 1];
    parsed[key] = next && !next.startsWith("--") ? next : "true";
    if (next && !next.startsWith("--")) index += 1;
  }
  return parsed;
}

function shouldFail(findings: Finding[], failOn?: string): boolean {
  if (!failOn) return false;
  const severityRank = { low: 1, medium: 2, high: 3, critical: 4 };
  const threshold = severityRank[failOn as keyof typeof severityRank];
  if (!threshold) return false;
  return findings.some((finding) => severityRank[finding.severity] >= threshold);
}
