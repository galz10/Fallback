import assert from "node:assert/strict";
import {
  isRepoRefreshDue,
  repoHasRecentGitHubActivity,
  repoSyncPriority,
  repoSyncReason,
  syncCooldownMs,
  syncFreshnessMs,
  syncPriority
} from "../src/shared/sync-policy.js";

const now = Date.parse("2026-01-01T12:00:00Z");

assert.ok(syncPriority.manual > syncPriority.activeDetail);
assert.ok(syncPriority.activeDetail > syncPriority.maintenance);
assert.ok(syncFreshnessMs.activeDetail < syncFreshnessMs.repoMetadata);

assert.equal(
  isRepoRefreshDue({ syncStatus: "queued", lastSuccessfulSyncAt: null, lastSyncedAt: null }, syncFreshnessMs.activeRepo, now),
  false
);
assert.equal(
  isRepoRefreshDue(
    { syncStatus: "fresh", lastSuccessfulSyncAt: "2026-01-01T11:58:30Z", lastSyncedAt: "2026-01-01T11:58:30Z" },
    syncFreshnessMs.activeDetail,
    now
  ),
  false
);
assert.equal(
  isRepoRefreshDue(
    { syncStatus: "fresh", lastSuccessfulSyncAt: "2026-01-01T11:00:00Z", lastSyncedAt: "2026-01-01T11:00:00Z" },
    syncFreshnessMs.activeRepo,
    now
  ),
  true
);
assert.ok(syncCooldownMs("failed", 3) > syncCooldownMs("failed", 1));
assert.ok(syncCooldownMs("auth_error") > syncCooldownMs("offline"));
assert.equal(
  repoHasRecentGitHubActivity(
    {
      pushedAt: "2026-01-01T11:30:00Z",
      githubUpdatedAt: "2026-01-01T11:30:00Z",
      lastSuccessfulSyncAt: "2026-01-01T11:00:00Z",
      lastSyncedAt: "2026-01-01T11:00:00Z"
    },
    now
  ),
  true
);
assert.equal(
  repoSyncPriority(
    {
      watchPriority: 0,
      openPullRequests: 0,
      lastSuccessfulSyncAt: "2026-01-01T11:00:00Z",
      lastSyncedAt: "2026-01-01T11:00:00Z",
      syncStatus: "fresh",
      pushedAt: "2026-01-01T11:30:00Z",
      githubUpdatedAt: "2026-01-01T11:30:00Z"
    },
    { now }
  ),
  syncPriority.recentActivity
);
assert.equal(
  repoSyncReason(
    {
      watchPriority: 0,
      openPullRequests: 0,
      lastSuccessfulSyncAt: "2026-01-01T11:00:00Z",
      lastSyncedAt: "2026-01-01T11:00:00Z",
      syncStatus: "fresh",
      pushedAt: "2026-01-01T11:30:00Z",
      githubUpdatedAt: "2026-01-01T11:30:00Z"
    },
    { hasLocalChanges: true, now }
  ),
  "local_changes"
);

console.log("Sync policy tests ok");
