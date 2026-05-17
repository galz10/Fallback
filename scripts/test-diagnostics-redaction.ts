import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CacheService } from "../electron/main/cache-service.js";
import { DatabaseService } from "../electron/main/database-service.js";
import { SettingsService } from "../electron/main/settings-service.js";
import { WorkspaceService } from "../electron/main/workspace-service.js";
import { createOperationRecordFixture, insertWatchedRepoFixture } from "./helpers/operation-record-fixtures.js";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-diagnostics-test-"));
const settings = new SettingsService();
settings.update({ workspacePath: tempDir });

const database = new DatabaseService(settings.databasePath());
const workspace = new WorkspaceService(() => settings.get());
const cache = new CacheService(database, settings, workspace);
const secretRepo = "secret-org/secret-repo";
const secretRepoId = `github.com/${secretRepo}`;

try {
  insertWatchedRepoFixture(database, {
    id: secretRepoId,
    fullName: secretRepo,
    isPrivate: true,
    watchMode: "metadata-only",
    cloneEnabled: false,
    cloneStatus: null,
    syncStatus: "stale"
  });

  const job = database.localCache.syncJobs.createSyncJob(secretRepoId, "repo_sync");
  database.localCache.syncJobs.updateSyncJob(job.id, {
    status: "failed",
    errorCode: "github_auth",
    errorMessage: "Bad credentials",
    completedAt: "2026-01-01T00:00:01Z",
    githubRateLimitRemaining: 42,
    githubRateLimitResetAt: "2026-01-01T01:00:00Z"
  });
  database.localCache.health.recordHealthProbes([
    {
      repoId: secretRepoId,
      repoFullName: secretRepo,
      surface: "sync",
      status: "auth_error",
      latencyMs: null,
      httpStatus: 403,
      errorCode: "github_auth",
      errorMessage: "Bad credentials",
      checkedAt: "2026-01-01T00:00:01Z"
    }
  ]);
  database.localCache.diagnostics.recordDiagnosticEvent({
    source: "credential_diagnostics",
    level: "error",
    code: "credential_api_failed",
    message: `${secretRepo}: GitHub token rejected for ${secretRepoId}`
  });
  database.localCache.repoIdentities.upsertRepoIdentity(secretRepoId, {
    signingMode: "ssh",
    signingKeyHint: "ssh-ed25519 AAAAC3NzaSensitiveMaterial"
  });
  const secretWorkspacePath = path.join(tempDir, "secret-worktree");
  createOperationRecordFixture(database, {
    repoId: secretRepoId,
    workspacePath: secretWorkspacePath,
    workspaceBranch: "customer-alpha-secret-feature",
    kind: "commit",
    status: "failed",
    commandSummary: `Commit customer-alpha-secret-feature in ${secretRepo} from https://x-access-token:supersecret@github.com/${secretRepo}.git`,
    redactedCommand: "git commit -m <summary>",
    recoveryHeadSha: "a".repeat(40),
    recoveryBranch: "customer-alpha-secret-feature",
    recoveryHint: `Inspect ${secretWorkspacePath} before retrying ${secretRepo} on customer-alpha-secret-feature.`
  });

  const redacted = cache.exportDiagnostics();
  const redactedBody = await readFile(redacted.path, "utf8");
  assert.equal(redacted.redacted, true);
  assert.equal(redactedBody.includes(secretRepo), false);
  assert.equal(redactedBody.includes(secretRepoId), false);
  assert.equal(redactedBody.includes(secretWorkspacePath), false);
  assert.equal(redactedBody.includes(tempDir), false);
  assert.equal(redactedBody.includes("customer-alpha-secret-feature"), false);
  assert.equal(redactedBody.includes("supersecret"), false);
  assert.match(redactedBody, /"workspacePath": "\[redacted\]"/);
  assert.match(redactedBody, /"workspace"/);
  assert.match(redactedBody, /"configStatus": "ok"/);
  assert.equal(redactedBody.includes(settings.configPath()), false);
  assert.match(redactedBody, /"credentialChecks"/);
  assert.match(redactedBody, /"repoSigning"/);
  assert.match(redactedBody, /"signingMode": "ssh"/);
  assert.equal(redactedBody.includes("SensitiveMaterial"), false);
  assert.match(redactedBody, /repo-1: GitHub token rejected for repo-1/);
  assert.match(redactedBody, /"errorCode": "github_auth"/);
  assert.match(redactedBody, /"remaining": 42/);

  const sensitive = cache.exportDiagnostics(true);
  const sensitiveBody = await readFile(sensitive.path, "utf8");
  assert.equal(sensitive.redacted, false);
  assert.match(sensitiveBody, new RegExp(secretRepo.replace("/", "\\/")));
  assert.match(sensitiveBody, new RegExp(secretWorkspacePath.replaceAll("/", "\\/")));

  console.log("Diagnostics redaction tests ok");
} finally {
  database.close();
  await rm(tempDir, { force: true, recursive: true });
}
