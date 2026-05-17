import type { PullRequestSummary } from "./domain/github-work.js";
import type {
  BranchCommitObservation,
  BranchIntegrityConfidence,
  BranchIntegrityFindingDraft,
  BranchRecoveryStep,
  BranchRecoveryPlan,
  MergeEvidence
} from "./domain/branch-integrity.js";

export interface DiffStat {
  additions: number;
  deletions: number;
  changedFiles: number;
}

export interface SuspicionScore {
  suspicious: boolean;
  kind: "landed_diff_too_large" | "landed_diff_too_small" | null;
  ratio: number | null;
  delta: number;
  summary: string | null;
}

export interface TreeComparison {
  matchesTested: boolean | null;
  matchesExpected: boolean | null;
  confidence: BranchIntegrityConfidence;
}

export interface BranchIntegrityInput {
  repoId: string;
  branchName: string;
  commit: BranchCommitObservation;
  evidence: MergeEvidence;
  pullRequests: PullRequestSummary[];
  safetyRefsAvailable?: boolean;
  largeDiffRatioThreshold?: number;
  largeDiffAbsoluteThreshold?: number;
}

export function parsePullRequestNumbersFromCommitMessage(message: string): number[] {
  const proofPatterns = [/Merge pull request #(\d+)/gi, /Pull request #(\d+)/gi, /\bPR #(\d+)/gi, /\(#(\d+)\)/g];
  const numbers = new Set<number>();
  for (const pattern of proofPatterns) {
    for (const match of message.matchAll(pattern)) {
      const number = Number(match[1]);
      if (Number.isSafeInteger(number) && number > 0) numbers.add(number);
    }
  }
  return [...numbers].sort((a, b) => a - b);
}

export function diffStatSuspicion(
  landed: DiffStat,
  expected: DiffStat | null,
  thresholds: { ratio?: number; absolute?: number } = {}
): SuspicionScore {
  if (!expected) return { suspicious: false, kind: null, ratio: null, delta: 0, summary: null };
  const landedLines = landed.additions + landed.deletions;
  const expectedLines = expected.additions + expected.deletions;
  const delta = Math.abs(landedLines - expectedLines);
  if (expectedLines === 0 && landedLines >= 250) {
    return {
      suspicious: true,
      kind: "landed_diff_too_large",
      ratio: null,
      delta,
      summary: `The landed commit changed ${landedLines} lines, but cached PR metadata expected no material diff.`
    };
  }
  if (expectedLines >= 100 && landedLines <= Math.max(20, Math.floor(expectedLines * 0.1))) {
    return {
      suspicious: true,
      kind: "landed_diff_too_small",
      ratio: landedLines / expectedLines,
      delta,
      summary: `The landed commit changed ${landedLines} lines, much less than the ${expectedLines} lines cached for the PR.`
    };
  }
  const ratio = expectedLines > 0 ? landedLines / expectedLines : null;
  const ratioThreshold = thresholds.ratio ?? 5;
  const absoluteThreshold = thresholds.absolute ?? 500;
  if (ratio !== null && ratio >= ratioThreshold && delta >= absoluteThreshold) {
    return {
      suspicious: true,
      kind: "landed_diff_too_large",
      ratio,
      delta,
      summary: `The landed commit changed ${landedLines} lines, about ${ratio.toFixed(1)}x the cached PR diff.`
    };
  }
  return { suspicious: false, kind: null, ratio, delta, summary: null };
}

export function compareTrees(landedTree: string | null, expectedTree: string | null, testedTree: string | null): TreeComparison {
  return {
    matchesTested: landedTree && testedTree ? landedTree === testedTree : null,
    matchesExpected: landedTree && expectedTree ? landedTree === expectedTree : null,
    confidence: testedTree ? "exact" : expectedTree ? "strong" : "weak"
  };
}

export function classifyBranchIntegrity(input: BranchIntegrityInput): BranchIntegrityFindingDraft[] {
  const findings: BranchIntegrityFindingDraft[] = [];
  const { commit, evidence } = input;
  const tree = compareTrees(evidence.landedTreeSha, evidence.expectedTreeSha, evidence.testedTreeSha);
  const prNumbers = uniqueNumbers([...commit.prNumbers, ...evidence.prNumbers]);

  if (tree.matchesTested === false) {
    findings.push(
      finding({
        branchName: input.branchName,
        severity: "critical",
        kind: "tested_tree_mismatch",
        confidence: "exact",
        title: "Landed tree differs from tested merge-group tree",
        summary: "The protected branch head does not match the preserved tree that was tested by the merge queue.",
        landedSha: evidence.landedSha,
        expectedSha: evidence.testedSha,
        landedTreeSha: evidence.landedTreeSha,
        expectedTreeSha: evidence.testedTreeSha,
        prNumbers,
        evidence: { ...evidence, commit }
      })
    );
  }

  if (tree.matchesExpected === false) {
    findings.push(
      finding({
        branchName: input.branchName,
        severity: "critical",
        kind: "expected_tree_mismatch",
        confidence: tree.confidence,
        title: "Landed tree differs from expected tree",
        summary: "Fallback computed or cached an expected protected-branch tree and the landed tree is different.",
        landedSha: evidence.landedSha,
        expectedSha: evidence.expectedHeadSha,
        landedTreeSha: evidence.landedTreeSha,
        expectedTreeSha: evidence.expectedTreeSha,
        prNumbers,
        evidence: { ...evidence, commit }
      })
    );
  }

  const expectedPrStat = expectedDiffStat(input.pullRequests);
  const suspicion = diffStatSuspicion(
    { additions: commit.additions, deletions: commit.deletions, changedFiles: commit.changedFiles },
    expectedPrStat,
    { ratio: input.largeDiffRatioThreshold, absolute: input.largeDiffAbsoluteThreshold }
  );
  if (suspicion.suspicious && suspicion.kind) {
    findings.push(
      finding({
        branchName: input.branchName,
        severity: "high",
        kind: suspicion.kind,
        confidence: "moderate",
        title:
          suspicion.kind === "landed_diff_too_large"
            ? "Landed diff is much larger than PR metadata"
            : "Landed diff is much smaller than PR metadata",
        summary: suspicion.summary ?? "The landed diff shape differs materially from cached pull request metadata.",
        landedSha: evidence.landedSha,
        expectedSha: expectedSha(input.pullRequests),
        landedTreeSha: evidence.landedTreeSha,
        expectedTreeSha: evidence.expectedTreeSha,
        prNumbers,
        evidence: { ...evidence, commit, expectedPrStat, suspicion }
      })
    );
  }

  if (commit.deletions >= 500 && commit.deletions >= Math.max(1, commit.additions) * 3) {
    findings.push(
      finding({
        branchName: input.branchName,
        severity: "high",
        kind: "possible_reversion",
        confidence: "moderate",
        title: "Commit shape looks like a broad reversion",
        summary: `The landed commit removed ${commit.deletions} lines while adding ${commit.additions}, which can indicate recently landed code was lost.`,
        landedSha: evidence.landedSha,
        expectedSha: null,
        landedTreeSha: evidence.landedTreeSha,
        expectedTreeSha: evidence.expectedTreeSha,
        prNumbers,
        evidence: { ...evidence, commit }
      })
    );
  }

  const prCommitShas = Array.isArray((evidence as unknown as { prCommitShas?: unknown }).prCommitShas)
    ? (evidence as unknown as { prCommitShas: unknown[] }).prCommitShas.filter((sha): sha is string => typeof sha === "string")
    : [];
  if (evidence.mergeMethod === "merge" && prCommitShas.length > 0 && !prCommitShas.some((sha) => commit.parentShas.includes(sha))) {
    findings.push(
      finding({
        branchName: input.branchName,
        severity: "high",
        kind: "missing_pr_content",
        confidence: "strong",
        title: "Merge commit does not point at cached PR commits",
        summary: "Fallback cached commits for the referenced PR, but the landed merge commit does not include any of them as parents.",
        landedSha: evidence.landedSha,
        expectedSha: prCommitShas.at(-1) ?? null,
        landedTreeSha: evidence.landedTreeSha,
        expectedTreeSha: evidence.expectedTreeSha,
        prNumbers,
        evidence: { ...evidence, commit, prCommitShas }
      })
    );
  }

  if (prNumbers.length === 0 && commit.additions + commit.deletions >= 50 && !isLikelyAutomation(commit)) {
    findings.push(
      finding({
        branchName: input.branchName,
        severity: "medium",
        kind: "unknown_merge_source",
        confidence: "weak",
        title: "Protected branch changed without clear PR evidence",
        summary: "Fallback found a material first-parent branch update with no PR number in the commit message or cached merge evidence.",
        landedSha: evidence.landedSha,
        expectedSha: null,
        landedTreeSha: evidence.landedTreeSha,
        expectedTreeSha: null,
        prNumbers,
        evidence: { ...evidence, commit }
      })
    );
  }

  if (!input.safetyRefsAvailable && evidence.mergeSource === "merge_queue") {
    findings.push(
      finding({
        branchName: input.branchName,
        severity: "low",
        kind: "missing_merge_group_evidence",
        confidence: "weak",
        title: "Merge queue safety refs were not available",
        summary: "Fallback could not fetch preserved refs/fallback merge-group evidence for this audit.",
        landedSha: evidence.landedSha,
        expectedSha: null,
        landedTreeSha: evidence.landedTreeSha,
        expectedTreeSha: null,
        prNumbers,
        evidence: { ...evidence, commit }
      })
    );
  }

  return findings;
}

export function buildRecoveryPlan(input: {
  repoId: string;
  branchName: string;
  findingIds: string[];
  landedSha: string | null;
  baseSha: string | null;
  targetTreeSha?: string | null;
  restoreRef?: string | null;
  strategy?: BranchRecoveryPlan["strategy"];
}): BranchRecoveryPlan {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const branch = `recover/${input.branchName.replaceAll(/[^A-Za-z0-9._/-]/g, "-")}-integrity-${date}`;
  const baseSha = input.baseSha ?? input.landedSha ?? "HEAD";
  const strategy = input.strategy ?? (input.restoreRef ? "restore_tested_tree" : input.landedSha ? "revert_bad_commit" : "manual");
  const steps: BranchRecoveryStep[] = [
    {
      type: "create_safety_ref" as const,
      title: "Preserve the current branch head",
      command: `git update-ref refs/fallback/recovery/${branch} ${baseSha}`
    },
    {
      type: "create_branch" as const,
      title: "Create a recovery branch",
      command: `git switch -c ${branch} ${baseSha}`
    }
  ];
  if (strategy === "revert_bad_commit" && input.landedSha) {
    steps.push({
      type: "revert_commit" as const,
      title: "Revert the suspicious landed commit",
      command: `git revert --no-commit ${input.landedSha}`
    });
    steps.push({
      type: "commit_recovery" as const,
      title: "Commit the reviewed recovery diff",
      command: `git commit -m "Recover ${input.branchName} branch integrity"`
    });
  } else {
    if (strategy === "restore_tested_tree" && input.restoreRef) {
      steps.push({
        type: "restore_tree" as const,
        title: "Restore the preserved tested tree",
        command: `git restore --source ${input.restoreRef} --worktree --staged .`
      });
      steps.push({
        type: "commit_recovery" as const,
        title: "Commit the restored tested state",
        command: `git commit -m "Restore tested branch state"`
      });
    } else {
      steps.push({
        type: "manual_instruction" as const,
        title: "Reconstruct the intended tree",
        body: "Use the preserved evidence to restore the reviewed or tested state, then open a normal pull request."
      });
    }
  }
  steps.push({ type: "open_pull_request" as const, title: "Open a recovery pull request" });
  return {
    repoId: input.repoId,
    branchName: input.branchName,
    findingIds: input.findingIds,
    strategy,
    baseSha,
    targetTreeSha: input.targetTreeSha ?? undefined,
    recoveryBranchName: branch,
    steps,
    risks: ["Review the recovery diff before merging.", "Do not force-push a protected branch from Fallback."]
  };
}

function finding(input: BranchIntegrityFindingDraft): BranchIntegrityFindingDraft {
  return input;
}

function expectedDiffStat(prs: PullRequestSummary[]): DiffStat | null {
  if (prs.length === 0) return null;
  if (!prs.every(hasDiffStat)) return null;
  return prs.reduce(
    (sum, pr) => ({
      additions: sum.additions + pr.additions,
      deletions: sum.deletions + pr.deletions,
      changedFiles: sum.changedFiles + (pr.changedFiles ?? 0)
    }),
    { additions: 0, deletions: 0, changedFiles: 0 }
  );
}

function hasDiffStat(pr: PullRequestSummary): pr is PullRequestSummary & { additions: number; deletions: number } {
  return Number.isFinite(pr.additions) && Number.isFinite(pr.deletions);
}

function expectedSha(prs: PullRequestSummary[]): string | null {
  return prs.find((pr) => pr.headSha)?.headSha ?? null;
}

function isLikelyAutomation(commit: BranchCommitObservation): boolean {
  const text = `${commit.authorName ?? ""} ${commit.authorEmail ?? ""}`.toLowerCase();
  return text.includes("[bot]") || text.includes("github-actions") || text.includes("dependabot");
}

function uniqueNumbers(numbers: number[]): number[] {
  return [...new Set(numbers.filter((number) => Number.isSafeInteger(number) && number > 0))].sort((a, b) => a - b);
}
