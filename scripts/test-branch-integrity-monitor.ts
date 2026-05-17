import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BranchIntegrityService } from "../electron/main/branch-integrity-service.js";
import { branchIntegritySyncDecision } from "../electron/main/sync-service.js";
import type { DatabaseService } from "../electron/main/database-service.js";
import type { LocalGitService } from "../electron/main/local-git-service.js";
import { SettingsService } from "../electron/main/settings-service.js";
import { fallbackSettings } from "../src/renderer/app/default-settings.js";
import type { WatchedRepo } from "../src/shared/domain/watched-repo.js";
import type { BranchSnapshot } from "../src/shared/domain/branch-integrity.js";

const workspacePath = await mkdtemp(path.join(os.tmpdir(), "fallback-branch-integrity-monitor-"));

try {
  await mkdir(path.join(workspacePath, ".fallback"), { recursive: true });
  await writeFile(
    path.join(workspacePath, ".fallback", "config.json"),
    JSON.stringify(
      {
        branchIntegrity: {
          enabled: true,
          fetchSafetyRefs: true,
          alertThreshold: "high",
          largeDiffRatioThreshold: 5,
          largeDiffAbsoluteThreshold: 500,
          requireExactMergeGroupTreeForReleases: true
        }
      },
      null,
      2
    )
  );
  const settings = new SettingsService();
  settings.update({ workspacePath });

  assert.equal(settings.get().branchIntegrity.automaticAuditAfterSync, true);
  assert.equal(fallbackSettings.branchIntegrity.automaticAuditAfterSync, true);

  assert.deepEqual(
    branchIntegritySyncDecision({
      enabled: true,
      automaticAuditAfterSync: true,
      repoLocalPath: "/tmp/repo",
      beforeHeadSha: "abc123",
      afterHeadSha: "abc123"
    }),
    { recordSnapshot: true, runAudit: false, headChanged: false }
  );

  assert.deepEqual(
    branchIntegritySyncDecision({
      enabled: true,
      automaticAuditAfterSync: true,
      repoLocalPath: "/tmp/repo",
      beforeHeadSha: "abc123",
      afterHeadSha: "def456"
    }),
    { recordSnapshot: true, runAudit: true, headChanged: true }
  );

  assert.deepEqual(
    branchIntegritySyncDecision({
      enabled: true,
      automaticAuditAfterSync: false,
      repoLocalPath: "/tmp/repo",
      beforeHeadSha: "abc123",
      afterHeadSha: "def456"
    }),
    { recordSnapshot: true, runAudit: false, headChanged: true }
  );

  assert.deepEqual(
    branchIntegritySyncDecision({
      enabled: true,
      automaticAuditAfterSync: true,
      repoLocalPath: "/tmp/repo",
      beforeHeadSha: null,
      afterHeadSha: "def456"
    }),
    { recordSnapshot: true, runAudit: false, headChanged: false }
  );

  assert.deepEqual(
    branchIntegritySyncDecision({
      enabled: true,
      automaticAuditAfterSync: true,
      repoLocalPath: null,
      beforeHeadSha: "abc123",
      afterHeadSha: "def456"
    }),
    { recordSnapshot: false, runAudit: false, headChanged: true }
  );

  const localRepoPath = path.join(workspacePath, "gemini-cli");
  await mkdir(path.join(localRepoPath, ".git"), { recursive: true });
  let auditReadLocalRepo = false;
  const staleWatchModeRepo = {
    id: "repo:galz10/gemini-cli",
    fullName: "galz10/gemini-cli",
    defaultBranch: "main",
    localPath: localRepoPath,
    watchMode: "metadata-only"
  } as WatchedRepo;
  const branchIntegrity = new BranchIntegrityService(
    {
      localCache: {
        repos: {
          getRepo: () => staleWatchModeRepo,
          listWatchedReposForActiveAccount: () => [staleWatchModeRepo]
        },
        branchIntegrity: {
          upsertBranchSnapshot: (snapshot: BranchSnapshot) => snapshot,
          listPullRequestCommits: () => []
        },
        githubWork: {
          listPullRequests: () => []
        }
      }
    } as unknown as DatabaseService,
    {
      branchSnapshot: async () => ({
        repoId: staleWatchModeRepo.id,
        branchName: "main",
        remoteName: "origin",
        headSha: "abc123",
        treeSha: "tree123",
        parentSha: null,
        firstParentSha: null,
        committedAt: null,
        observedAt: new Date().toISOString(),
        source: "audit",
        checkpointRef: null,
        notes: null
      }),
      fetchFallbackSafetyRefs: async () => false,
      firstParentAudit: async () => {
        auditReadLocalRepo = true;
        return [];
      },
      listFallbackSafetyRefs: async () => []
    } as unknown as LocalGitService,
    undefined,
    {
      get: () => fallbackSettings
    } as unknown as SettingsService
  );
  const auditResult = await branchIntegrity.auditRepo(staleWatchModeRepo.id, { mode: "full" });
  assert.equal(auditResult.commitsAudited, 0);
  assert.equal(auditReadLocalRepo, true);
} finally {
  await rm(workspacePath, { force: true, recursive: true });
}

console.log("branch integrity monitor tests passed");
