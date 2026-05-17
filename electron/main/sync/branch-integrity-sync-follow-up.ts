import type { BranchIntegrityService } from "../branch-integrity-service.js";
import type { DatabaseService } from "../database-service.js";
import type { SettingsService } from "../settings-service.js";
import { branchIntegrityAutomaticAuditLimit } from "../../../src/shared/branch-integrity-config.js";

export interface BranchIntegritySyncDecisionInput {
  enabled: boolean;
  automaticAuditAfterSync: boolean;
  repoLocalPath: string | null | undefined;
  beforeHeadSha: string | null | undefined;
  afterHeadSha: string | null | undefined;
}

export interface BranchIntegritySyncDecision {
  recordSnapshot: boolean;
  runAudit: boolean;
  headChanged: boolean;
}

export function branchIntegritySyncDecision(input: BranchIntegritySyncDecisionInput): BranchIntegritySyncDecision {
  const recordSnapshot = input.enabled && Boolean(input.repoLocalPath);
  const headChanged = Boolean(input.beforeHeadSha && input.afterHeadSha && input.beforeHeadSha !== input.afterHeadSha);
  return {
    recordSnapshot,
    runAudit: recordSnapshot && input.automaticAuditAfterSync && headChanged,
    headChanged
  };
}

export interface BranchIntegritySyncFollowUpInput {
  database: DatabaseService;
  settings?: SettingsService;
  branchIntegrity?: BranchIntegrityService;
  repoId: string;
  fullName: string;
  progress(message: string): void;
  onChanged?(repoId: string): void;
}

export async function recordBranchIntegrityAfterSync(input: BranchIntegritySyncFollowUpInput): Promise<void> {
  const integrityPolicy = input.settings?.get().branchIntegrity;
  const integrityRepo = input.database.localCache.repos.getRepo(input.repoId);
  const integrityLocalPath = integrityRepo?.watchMode === "cloned" ? integrityRepo.localPath : null;
  const snapshotDecision = branchIntegritySyncDecision({
    enabled: Boolean(input.branchIntegrity && integrityPolicy?.enabled !== false),
    automaticAuditAfterSync: integrityPolicy?.automaticAuditAfterSync !== false,
    repoLocalPath: integrityLocalPath,
    beforeHeadSha: null,
    afterHeadSha: null
  });
  if (!input.branchIntegrity || !snapshotDecision.recordSnapshot) return;

  input.progress("Recording branch snapshot");
  const beforeSnapshot = input.database.localCache.branchIntegrity.latestBranchSnapshot(input.repoId, integrityRepo?.defaultBranch ?? null);
  const snapshot = await input.branchIntegrity.recordSnapshot(input.repoId, { mode: "snapshot" }).catch((error) => {
    console.warn(`Failed to record branch integrity snapshot for ${input.fullName}.`, error);
    return null;
  });
  if (snapshot) input.onChanged?.(input.repoId);
  const afterSnapshot = input.database.localCache.branchIntegrity.latestBranchSnapshot(input.repoId, integrityRepo?.defaultBranch ?? null);
  const auditDecision = branchIntegritySyncDecision({
    enabled: true,
    automaticAuditAfterSync: integrityPolicy?.automaticAuditAfterSync !== false,
    repoLocalPath: integrityLocalPath,
    beforeHeadSha: beforeSnapshot?.headSha,
    afterHeadSha: afterSnapshot?.headSha
  });
  if (!auditDecision.runAudit) return;

  input.progress("Auditing branch integrity");
  await input.branchIntegrity.auditRepo(input.repoId, { mode: "full", limit: branchIntegrityAutomaticAuditLimit }).catch((error) => {
    console.warn(`Failed to audit branch integrity for ${input.fullName}.`, error);
  });
  input.onChanged?.(input.repoId);
}
