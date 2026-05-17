import fs from "node:fs";
import path from "node:path";
import type {
  BranchIntegrityFinding,
  BranchIntegrityFindingDraft,
  BranchIntegritySeverity,
  BranchIntegrityStatusSummary,
  BranchSnapshot,
  CompareCacheRecord,
  MergeEvidence,
  PullRequestCommitRecord
} from "../../../src/shared/domain/branch-integrity.js";
import { nowIso } from "../path-utils.js";
import { LocalCacheStoreBase } from "./store-base.js";
import {
  branchFindingId,
  branchIntegrityMessage,
  branchSnapshotId,
  mapBranchIntegrityFinding,
  mapBranchSnapshot,
  mapCompareCacheRecord,
  mapMergeEvidence,
  mapPullRequestCommitRecord,
  mergeEvidenceId
} from "./store-helpers.js";

export class BranchIntegrityStore extends LocalCacheStoreBase {
  upsertBranchSnapshot(snapshot: BranchSnapshot): BranchSnapshot {
    const id = snapshot.id ?? branchSnapshotId(snapshot);
    this.db
      .prepare(
        `INSERT INTO branch_snapshots (
          id, repo_id, branch_name, remote_name, head_sha, tree_sha, parent_sha, first_parent_sha,
          committed_at, observed_at, source, checkpoint_ref, notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(repo_id, branch_name, head_sha, source) DO UPDATE SET
          tree_sha = excluded.tree_sha,
          parent_sha = excluded.parent_sha,
          first_parent_sha = excluded.first_parent_sha,
          committed_at = excluded.committed_at,
          observed_at = excluded.observed_at,
          checkpoint_ref = excluded.checkpoint_ref,
          notes = excluded.notes`
      )
      .run(
        id,
        snapshot.repoId,
        snapshot.branchName,
        snapshot.remoteName,
        snapshot.headSha,
        snapshot.treeSha,
        snapshot.parentSha,
        snapshot.firstParentSha,
        snapshot.committedAt,
        snapshot.observedAt,
        snapshot.source,
        snapshot.checkpointRef,
        snapshot.notes
      );
    return this.latestBranchSnapshot(snapshot.repoId, snapshot.branchName) ?? { ...snapshot, id };
  }

  latestBranchSnapshot(repoId: string, branchName?: string | null): BranchSnapshot | null {
    const row = branchName
      ? (this.db
          .prepare("SELECT * FROM branch_snapshots WHERE repo_id = ? AND branch_name = ? ORDER BY observed_at DESC LIMIT 1")
          .get(repoId, branchName) as Record<string, unknown> | undefined)
      : (this.db.prepare("SELECT * FROM branch_snapshots WHERE repo_id = ? ORDER BY observed_at DESC LIMIT 1").get(repoId) as
          | Record<string, unknown>
          | undefined);
    return row ? mapBranchSnapshot(row) : null;
  }

  latestBranchSnapshotBySource(
    repoId: string,
    branchName: string | null | undefined,
    source: BranchSnapshot["source"]
  ): BranchSnapshot | null {
    const row = branchName
      ? (this.db
          .prepare("SELECT * FROM branch_snapshots WHERE repo_id = ? AND branch_name = ? AND source = ? ORDER BY observed_at DESC LIMIT 1")
          .get(repoId, branchName, source) as Record<string, unknown> | undefined)
      : (this.db
          .prepare("SELECT * FROM branch_snapshots WHERE repo_id = ? AND source = ? ORDER BY observed_at DESC LIMIT 1")
          .get(repoId, source) as Record<string, unknown> | undefined);
    return row ? mapBranchSnapshot(row) : null;
  }

  listBranchSnapshots(repoId: string, branchName?: string | null, limit = 50): BranchSnapshot[] {
    const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 250);
    const rows = branchName
      ? (this.db
          .prepare("SELECT * FROM branch_snapshots WHERE repo_id = ? AND branch_name = ? ORDER BY observed_at DESC LIMIT ?")
          .all(repoId, branchName, boundedLimit) as Record<string, unknown>[])
      : (this.db
          .prepare("SELECT * FROM branch_snapshots WHERE repo_id = ? ORDER BY observed_at DESC LIMIT ?")
          .all(repoId, boundedLimit) as Record<string, unknown>[]);
    return rows.map(mapBranchSnapshot);
  }

  upsertMergeEvidence(evidence: MergeEvidence): MergeEvidence {
    const id = evidence.id ?? mergeEvidenceId(evidence);
    this.db
      .prepare(
        `INSERT INTO merge_evidence (
          id, repo_id, branch_name, landed_sha, landed_tree_sha, landed_parent_sha, pr_numbers_json,
          merge_method, merge_source, expected_head_sha, expected_tree_sha, tested_sha, tested_tree_sha,
          merge_group_ref, workflow_run_id, workflow_run_url, check_state, observed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          landed_tree_sha = excluded.landed_tree_sha,
          landed_parent_sha = excluded.landed_parent_sha,
          pr_numbers_json = excluded.pr_numbers_json,
          merge_method = excluded.merge_method,
          merge_source = excluded.merge_source,
          expected_head_sha = excluded.expected_head_sha,
          expected_tree_sha = excluded.expected_tree_sha,
          tested_sha = excluded.tested_sha,
          tested_tree_sha = excluded.tested_tree_sha,
          merge_group_ref = excluded.merge_group_ref,
          workflow_run_id = excluded.workflow_run_id,
          workflow_run_url = excluded.workflow_run_url,
          check_state = excluded.check_state,
          observed_at = excluded.observed_at`
      )
      .run(
        id,
        evidence.repoId,
        evidence.branchName,
        evidence.landedSha,
        evidence.landedTreeSha,
        evidence.landedParentSha,
        JSON.stringify(evidence.prNumbers),
        evidence.mergeMethod,
        evidence.mergeSource,
        evidence.expectedHeadSha,
        evidence.expectedTreeSha,
        evidence.testedSha,
        evidence.testedTreeSha,
        evidence.mergeGroupRef,
        evidence.workflowRunId,
        evidence.workflowRunUrl,
        evidence.checkState,
        evidence.observedAt
      );
    return { ...evidence, id };
  }

  upsertPullRequestCommit(commit: PullRequestCommitRecord): PullRequestCommitRecord {
    this.db
      .prepare(
        `INSERT INTO pull_request_commits (
          repo_id, pr_number, sha, tree_sha, message, authored_at, committed_at, last_synced_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(repo_id, pr_number, sha) DO UPDATE SET
          tree_sha = excluded.tree_sha,
          message = excluded.message,
          authored_at = excluded.authored_at,
          committed_at = excluded.committed_at,
          last_synced_at = excluded.last_synced_at`
      )
      .run(
        commit.repoId,
        commit.prNumber,
        commit.sha,
        commit.treeSha,
        commit.message,
        commit.authoredAt,
        commit.committedAt,
        commit.lastSyncedAt
      );
    return commit;
  }

  listPullRequestCommits(repoId: string, prNumber: number): PullRequestCommitRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM pull_request_commits WHERE repo_id = ? AND pr_number = ? ORDER BY committed_at ASC, sha ASC")
        .all(repoId, prNumber) as Record<string, unknown>[]
    ).map(mapPullRequestCommitRecord);
  }

  upsertCompareCache(record: CompareCacheRecord): CompareCacheRecord {
    this.db
      .prepare(
        `INSERT INTO compare_cache (
          repo_id, base_sha, head_sha, status, ahead_by, behind_by, total_commits,
          additions, deletions, changed_files, payload_json, last_synced_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(repo_id, base_sha, head_sha) DO UPDATE SET
          status = excluded.status,
          ahead_by = excluded.ahead_by,
          behind_by = excluded.behind_by,
          total_commits = excluded.total_commits,
          additions = excluded.additions,
          deletions = excluded.deletions,
          changed_files = excluded.changed_files,
          payload_json = excluded.payload_json,
          last_synced_at = excluded.last_synced_at`
      )
      .run(
        record.repoId,
        record.baseSha,
        record.headSha,
        record.status,
        record.aheadBy,
        record.behindBy,
        record.totalCommits,
        record.additions,
        record.deletions,
        record.changedFiles,
        record.payload ? JSON.stringify(record.payload) : null,
        record.lastSyncedAt
      );
    return record;
  }

  getCompareCache(repoId: string, baseSha: string, headSha: string): CompareCacheRecord | null {
    const row = this.db
      .prepare("SELECT * FROM compare_cache WHERE repo_id = ? AND base_sha = ? AND head_sha = ?")
      .get(repoId, baseSha, headSha) as Record<string, unknown> | undefined;
    return row ? mapCompareCacheRecord(row) : null;
  }

  listMergeEvidence(repoId: string, branchName?: string | null, limit = 50): MergeEvidence[] {
    const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 250);
    const rows = branchName
      ? (this.db
          .prepare("SELECT * FROM merge_evidence WHERE repo_id = ? AND branch_name = ? ORDER BY observed_at DESC LIMIT ?")
          .all(repoId, branchName, boundedLimit) as Record<string, unknown>[])
      : (this.db
          .prepare("SELECT * FROM merge_evidence WHERE repo_id = ? ORDER BY observed_at DESC LIMIT ?")
          .all(repoId, boundedLimit) as Record<string, unknown>[]);
    return rows.map(mapMergeEvidence);
  }

  upsertBranchIntegrityFinding(repoId: string, draft: BranchIntegrityFindingDraft): BranchIntegrityFinding {
    const now = nowIso();
    const id = branchFindingId(repoId, draft);
    const recoveryPlan = draft.recoveryPlan ?? null;
    this.db
      .prepare(
        `INSERT INTO branch_integrity_findings (
          id, repo_id, branch_name, severity, kind, status, title, summary, landed_sha, expected_sha,
          landed_tree_sha, expected_tree_sha, pr_numbers_json, evidence_json, recovery_plan_json,
          confidence, first_seen_at, last_seen_at, resolved_at
        )
        VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET
          severity = excluded.severity,
          title = excluded.title,
          summary = excluded.summary,
          landed_tree_sha = excluded.landed_tree_sha,
          expected_tree_sha = excluded.expected_tree_sha,
          pr_numbers_json = excluded.pr_numbers_json,
          evidence_json = excluded.evidence_json,
          recovery_plan_json = excluded.recovery_plan_json,
          confidence = excluded.confidence,
          last_seen_at = excluded.last_seen_at,
          status = CASE WHEN branch_integrity_findings.status = 'resolved' THEN 'resolved' ELSE 'open' END`
      )
      .run(
        id,
        repoId,
        draft.branchName,
        draft.severity,
        draft.kind,
        draft.title,
        draft.summary,
        draft.landedSha,
        draft.expectedSha,
        draft.landedTreeSha,
        draft.expectedTreeSha,
        JSON.stringify(draft.prNumbers),
        JSON.stringify(draft.evidence),
        recoveryPlan ? JSON.stringify(recoveryPlan) : null,
        draft.confidence,
        now,
        now
      );
    const row = this.db.prepare("SELECT * FROM branch_integrity_findings WHERE id = ?").get(id) as Record<string, unknown>;
    return mapBranchIntegrityFinding(row);
  }

  listBranchIntegrityFindings(repoId?: string | null): BranchIntegrityFinding[] {
    const rows = repoId
      ? (this.db
          .prepare("SELECT * FROM branch_integrity_findings WHERE repo_id = ? ORDER BY status ASC, last_seen_at DESC")
          .all(repoId) as Record<string, unknown>[])
      : (this.db.prepare("SELECT * FROM branch_integrity_findings ORDER BY status ASC, last_seen_at DESC").all() as Record<
          string,
          unknown
        >[]);
    return rows.map(mapBranchIntegrityFinding);
  }

  markBranchIntegrityFindingResolved(id: string): BranchIntegrityFinding | null {
    const resolvedAt = nowIso();
    this.db.prepare("UPDATE branch_integrity_findings SET status = 'resolved', resolved_at = ? WHERE id = ?").run(resolvedAt, id);
    const row = this.db.prepare("SELECT * FROM branch_integrity_findings WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapBranchIntegrityFinding(row) : null;
  }

  branchIntegritySummary(repoId: string): BranchIntegrityStatusSummary {
    const repo = this.getRepo(repoId);
    const snapshot = this.latestBranchSnapshot(repoId, repo?.defaultBranch ?? null);
    const auditSnapshot = this.latestBranchSnapshotBySource(repoId, repo?.defaultBranch ?? null, "audit");
    const rows = this.db
      .prepare(
        `SELECT severity, COUNT(*) AS count, MAX(last_seen_at) AS last_seen_at
         FROM branch_integrity_findings
         WHERE repo_id = ? AND status = 'open'
         GROUP BY severity`
      )
      .all(repoId) as Array<{ severity: BranchIntegritySeverity; count: number; last_seen_at: string | null }>;
    const count = (severity: BranchIntegritySeverity) => rows.find((row) => row.severity === severity)?.count ?? 0;
    const criticalFindings = count("critical");
    const highFindings = count("high");
    const mediumFindings = count("medium");
    const lowFindings = count("low");
    const openFindings = criticalFindings + highFindings + mediumFindings + lowFindings;
    const latestFindingAt =
      rows
        .map((row) => row.last_seen_at)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null;
    const hasLocalRepo = Boolean(repo?.localPath && fs.existsSync(path.join(repo.localPath, ".git")));
    const status: BranchIntegrityStatusSummary["status"] = !hasLocalRepo
      ? "unavailable"
      : !snapshot
        ? "monitoring"
        : criticalFindings > 0
          ? "incident"
          : highFindings > 0
            ? "at_risk"
            : mediumFindings + lowFindings > 0
              ? "warning"
              : auditSnapshot && auditSnapshot.headSha === snapshot.headSha
                ? "clean"
                : auditSnapshot && auditSnapshot.headSha !== snapshot.headSha
                  ? "needs_audit"
                  : "monitoring";
    return {
      repoId,
      status,
      branchName: snapshot?.branchName ?? repo?.defaultBranch ?? null,
      headSha: snapshot?.headSha ?? null,
      treeSha: snapshot?.treeSha ?? null,
      observedAt: snapshot?.observedAt ?? null,
      lastAuditAt: auditSnapshot?.observedAt ?? latestFindingAt,
      openFindings,
      criticalFindings,
      highFindings,
      mediumFindings,
      lowFindings,
      message: branchIntegrityMessage(status)
    };
  }
}
