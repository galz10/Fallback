import fs from "node:fs";
import path from "node:path";
import type { PullRequestDiff, PullRequestSummary } from "../../src/shared/domain/github-work.js";
import type {
  BranchIntegrityAuditOptions,
  BranchIntegrityAuditResult,
  BranchIntegrityAuditSummary,
  BranchIntegrityFinding,
  BranchRecoveryPullRequest,
  BranchIntegrityStatusSummary,
  BranchRecoveryPlan,
  BranchRecoveryResult,
  BranchSnapshot,
  MergeEvidence
} from "../../src/shared/domain/branch-integrity.js";
import { buildRecoveryPlan, classifyBranchIntegrity } from "../../src/shared/branch-integrity.js";
import type { DatabaseService } from "./database-service.js";
import type { GitHubClient, GitHubCreatedPullRequest } from "./github-client.js";
import type { LocalGitService } from "./local-git-service.js";
import type { SettingsService } from "./settings-service.js";

export class BranchIntegrityService {
  constructor(
    private readonly database: DatabaseService,
    private readonly localGit: LocalGitService,
    private readonly github?: GitHubClient,
    private readonly settings?: SettingsService
  ) {}

  async recordSnapshot(repoId: string, options: BranchIntegrityAuditOptions = {}): Promise<BranchSnapshot> {
    const snapshot = await this.localGit.branchSnapshot({
      repoId,
      branch: options.branch,
      remote: options.remote,
      source: options.mode === "full" ? "audit" : "sync"
    });
    return this.database.localCache.branchIntegrity.upsertBranchSnapshot(snapshot);
  }

  async auditRepo(repoId: string, options: BranchIntegrityAuditOptions = {}): Promise<BranchIntegrityAuditResult> {
    const auditedAt = new Date().toISOString();
    const repo = this.database.localCache.repos.getRepo(repoId);
    if (!repo) throw new Error("Repository is not watched.");
    if (!isLocalGitRepo(repo.localPath)) throw new Error("Clone the repository locally to audit branch integrity.");
    const branchName = options.branch ?? repo.defaultBranch ?? "main";
    const policy = this.settings?.get().branchIntegrity;
    const [snapshot, safetyRefsAvailable] = await Promise.all([
      this.recordSnapshot(repoId, { ...options, branch: branchName, mode: "full" }).catch(() => null),
      policy?.fetchSafetyRefs === false
        ? Promise.resolve(false)
        : this.localGit.fetchFallbackSafetyRefs(repoId, options.remote ?? "origin").catch(() => false)
    ]);
    const [commits, fallbackRefs] = await Promise.all([
      this.localGit.firstParentAudit(repoId, { ...options, branch: branchName }),
      this.localGit.listFallbackSafetyRefs(repoId).catch(() => [])
    ]);

    const storedFindings: BranchIntegrityFinding[] = [];
    for (const commit of commits) {
      const prs = matchingPullRequests(this.database.localCache.githubWork.listPullRequests(repoId), commit.prNumbers);
      const prCommitShas = commit.prNumbers.flatMap((number) =>
        this.database.localCache.branchIntegrity.listPullRequestCommits(repoId, number).map((item) => item.sha)
      );
      const tested = nearestTestedRef(fallbackRefs, commit.treeSha);
      const evidence: MergeEvidence = this.database.localCache.branchIntegrity.upsertMergeEvidence({
        repoId,
        branchName,
        landedSha: commit.sha,
        landedTreeSha: commit.treeSha,
        landedParentSha: commit.firstParentSha,
        prNumbers: commit.prNumbers,
        mergeMethod:
          commit.firstParentSha && commit.parentSha !== commit.sha ? mergeMethodForCommit(commit.prNumbers, commit.subject) : "unknown",
        mergeSource: mergeSourceForCommit(commit.prNumbers, commit.subject, tested?.ref ?? null),
        expectedHeadSha: prs.find((pr) => pr.headSha)?.headSha ?? null,
        expectedTreeSha: null,
        testedSha: tested?.sha ?? null,
        testedTreeSha: tested?.treeSha ?? null,
        mergeGroupRef: tested?.ref ?? null,
        workflowRunId: workflowRunIdFromRef(tested?.ref ?? null),
        workflowRunUrl: null,
        checkState: aggregateCheckState(prs),
        observedAt: auditedAt,
        additions: commit.additions,
        deletions: commit.deletions,
        changedFiles: commit.changedFiles
      });
      const drafts = classifyBranchIntegrity({
        repoId,
        branchName,
        commit,
        evidence: { ...evidence, prCommitShas } as MergeEvidence,
        pullRequests: prs,
        safetyRefsAvailable,
        largeDiffRatioThreshold: this.settings?.get().branchIntegrity.largeDiffRatioThreshold,
        largeDiffAbsoluteThreshold: this.settings?.get().branchIntegrity.largeDiffAbsoluteThreshold
      });
      for (const draft of drafts) {
        const persisted = this.database.localCache.branchIntegrity.upsertBranchIntegrityFinding(repoId, {
          ...draft,
          recoveryPlan: buildRecoveryPlan({
            repoId,
            branchName,
            findingIds: [],
            landedSha: draft.landedSha,
            baseSha: commit.firstParentSha,
            targetTreeSha: draft.expectedTreeSha,
            restoreRef: typeof draft.evidence.mergeGroupRef === "string" ? draft.evidence.mergeGroupRef : null
          })
        });
        storedFindings.push({
          ...persisted,
          recoveryPlan: persisted.recoveryPlan ? { ...persisted.recoveryPlan, findingIds: [persisted.id] } : null
        });
      }
    }

    return {
      repoId,
      branchName,
      auditedAt,
      snapshot,
      commitsAudited: commits.length,
      safetyRefsAvailable,
      findings: storedFindings
    };
  }

  async auditAllWatchedRepos(options: BranchIntegrityAuditOptions = {}): Promise<BranchIntegrityAuditSummary> {
    const auditedAt = new Date().toISOString();
    const repos = this.database.localCache.repos.listWatchedReposForActiveAccount().filter((repo) => isLocalGitRepo(repo.localPath));
    const findings: BranchIntegrityFinding[] = [];
    const failures: Array<{ repoId: string; message: string }> = [];
    for (const repo of repos) {
      try {
        const result = await this.auditRepo(repo.id, options);
        findings.push(...result.findings);
      } catch (error) {
        failures.push({ repoId: repo.id, message: error instanceof Error ? error.message : String(error) });
      }
    }
    return { auditedAt, repoCount: repos.length, findings, failures };
  }

  latestFindings(repoId?: string): BranchIntegrityFinding[] {
    return this.database.localCache.branchIntegrity.listBranchIntegrityFindings(repoId);
  }

  markFindingResolved(id: string): BranchIntegrityFinding | null {
    return this.database.localCache.branchIntegrity.markBranchIntegrityFindingResolved(id);
  }

  summary(repoId: string): BranchIntegrityStatusSummary {
    return this.database.localCache.branchIntegrity.branchIntegritySummary(repoId);
  }

  summaryMany(repoIds: string[]): BranchIntegrityStatusSummary[] {
    return repoIds.map((repoId) => this.summary(repoId));
  }

  recoveryPlan(repoId: string, findingIds: string[]): BranchRecoveryPlan {
    const findings = this.database.localCache.branchIntegrity
      .listBranchIntegrityFindings(repoId)
      .filter((finding) => findingIds.includes(finding.id));
    const first = findings[0];
    if (!first) throw new Error("Select at least one branch integrity finding.");
    return buildRecoveryPlan({
      repoId,
      branchName: first.branchName,
      findingIds,
      landedSha: first.landedSha,
      baseSha:
        typeof first.evidence.commit === "object" && first.evidence.commit !== null
          ? String((first.evidence.commit as { firstParentSha?: unknown }).firstParentSha ?? "")
          : null,
      targetTreeSha: first.expectedTreeSha,
      restoreRef: evidenceString(first.evidence, "mergeGroupRef")
    });
  }

  async inspectDiff(repoId: string, findingId: string, mode: "landed" | "expected" | "recovery" = "landed"): Promise<PullRequestDiff> {
    const finding = this.requireFinding(repoId, findingId);
    const commit = evidenceCommit(finding.evidence);
    const landed = finding.landedSha;
    if (mode === "landed") {
      if (!landed || !commit?.firstParentSha) throw new Error("Landed commit diff evidence is incomplete.");
      return this.localGit.branchDiff(repoId, commit.firstParentSha, landed);
    }
    if (mode === "expected") {
      const expected =
        finding.expectedSha ?? evidenceString(finding.evidence, "testedSha") ?? evidenceString(finding.evidence, "expectedHeadSha");
      if (!expected || !landed) throw new Error("Expected/tested diff evidence is incomplete.");
      return this.localGit.branchDiff(repoId, expected, landed);
    }
    const plan = finding.recoveryPlan ?? this.recoveryPlan(repoId, [finding.id]);
    return this.localGit.branchDiff(repoId, `${plan.baseSha}^{tree}`, "HEAD");
  }

  async createRecoveryBranch(
    repoId: string,
    findingIds: string[],
    strategy?: BranchRecoveryPlan["strategy"]
  ): Promise<BranchRecoveryResult> {
    const plan = this.recoveryPlan(repoId, findingIds);
    const nextPlan = strategy && strategy !== plan.strategy ? { ...plan, strategy } : plan;
    return this.localGit.createBranchIntegrityRecovery(repoId, nextPlan);
  }

  async openRecoveryPullRequest(repoId: string, findingIds: string[]): Promise<BranchRecoveryPullRequest> {
    if (!this.github) throw new Error("GitHub is not connected.");
    this.database.localCache.repos.requireRepoVisibleToActiveAccount(repoId);
    const repo = this.database.localCache.repos.getRepo(repoId);
    if (!repo) throw new Error("Repository is not watched.");
    const plan = this.recoveryPlan(repoId, findingIds);
    const changes = await this.localGit.changes(repoId);
    if (!changes.isDirty || changes.branch !== plan.recoveryBranchName) {
      await this.localGit.createBranchIntegrityRecovery(repoId, plan);
    }
    await this.localGit.commit(repoId, {
      summary: `Restore ${plan.branchName} after branch integrity finding`,
      description: recoveryPrBody(
        plan,
        this.database.localCache.branchIntegrity.listBranchIntegrityFindings(repoId).filter((finding) => findingIds.includes(finding.id))
      ),
      bypassIdentityWarning: false
    });
    await this.localGit.pushCurrentBranch(repoId, plan.recoveryBranchName);
    const created = await this.github.post<GitHubCreatedPullRequest>(`/repos/${repo.owner}/${repo.name}/pulls`, {
      title: `Restore ${plan.branchName} branch integrity`,
      head: plan.recoveryBranchName,
      base: plan.branchName,
      body: recoveryPrBody(
        plan,
        this.database.localCache.branchIntegrity.listBranchIntegrityFindings(repoId).filter((finding) => findingIds.includes(finding.id))
      )
    });
    return {
      repoId,
      number: created.number,
      htmlUrl: created.html_url,
      headBranch: created.head?.ref ?? plan.recoveryBranchName,
      baseBranch: created.base?.ref ?? plan.branchName
    };
  }

  async fetchSafetyRefs(repoId: string): Promise<boolean> {
    return this.localGit.fetchFallbackSafetyRefs(repoId, "origin", { force: true });
  }

  private requireFinding(repoId: string, findingId: string): BranchIntegrityFinding {
    const finding = this.database.localCache.branchIntegrity.listBranchIntegrityFindings(repoId).find((item) => item.id === findingId);
    if (!finding) throw new Error("Branch integrity finding was not found.");
    return finding;
  }
}

function isLocalGitRepo(localPath: string | null | undefined): localPath is string {
  return Boolean(localPath && fs.existsSync(path.join(localPath, ".git")));
}

function matchingPullRequests(prs: PullRequestSummary[], numbers: number[]): PullRequestSummary[] {
  const set = new Set(numbers);
  return prs.filter((pr) => set.has(pr.number));
}

function mergeMethodForCommit(prNumbers: number[], subject: string): MergeEvidence["mergeMethod"] {
  if (/merge pull request/i.test(subject)) return "merge";
  if (prNumbers.length > 0) return "squash";
  return "unknown";
}

function mergeSourceForCommit(prNumbers: number[], subject: string, mergeGroupRef: string | null): MergeEvidence["mergeSource"] {
  if (mergeGroupRef || /merge queue|merge group/i.test(subject)) return "merge_queue";
  if (prNumbers.length > 0) return "pull_request";
  return "unknown";
}

function aggregateCheckState(prs: PullRequestSummary[]): string | null {
  if (prs.some((pr) => pr.checkState === "failing")) return "failing";
  if (prs.some((pr) => pr.checkState === "pending")) return "pending";
  if (prs.some((pr) => pr.checkState === "passing")) return "passing";
  return null;
}

function nearestTestedRef(
  refs: Array<{ ref: string; sha: string; treeSha: string | null }>,
  landedTreeSha: string
): { ref: string; sha: string; treeSha: string | null } | null {
  const mergeGroupRefs = refs.filter((ref) => ref.ref.includes("refs/fallback/merge-groups/"));
  return mergeGroupRefs.find((ref) => ref.treeSha === landedTreeSha) ?? null;
}

function workflowRunIdFromRef(ref: string | null): number | null {
  const match = ref?.match(/refs\/fallback\/merge-groups\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

function evidenceCommit(evidence: Record<string, unknown>): { firstParentSha?: string | null } | null {
  return typeof evidence.commit === "object" && evidence.commit !== null ? (evidence.commit as { firstParentSha?: string | null }) : null;
}

function evidenceString(evidence: Record<string, unknown>, key: string): string | null {
  const value = evidence[key];
  return typeof value === "string" && value ? value : null;
}

function recoveryPrBody(plan: BranchRecoveryPlan, findings: BranchIntegrityFinding[]): string {
  const findingLines = findings
    .map(
      (finding) =>
        `- Severity: ${finding.severity}\n- Kind: ${finding.kind}\n- Landed commit: ${finding.landedSha ?? "unknown"}\n- Expected/tested tree: ${
          finding.expectedTreeSha ?? "unknown"
        }\n- Landed tree: ${finding.landedTreeSha ?? "unknown"}`
    )
    .join("\n\n");
  return `## Branch Integrity Recovery

Fallback detected a branch integrity issue on \`${plan.branchName}\`.

### Finding

${findingLines || "- No finding details were available."}

### Recovery

This PR was generated from recovery strategy: \`${plan.strategy}\`.

### Verification

- [ ] Review expected vs landed diff
- [ ] Confirm missing PRs are restored
- [ ] Confirm CI passes
- [ ] Confirm deploy/release gate is safe to resume
`;
}
