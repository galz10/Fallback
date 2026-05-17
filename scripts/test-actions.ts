import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DatabaseService } from "../electron/main/database-service.js";
import type { ActionCheckSummary } from "../src/shared/domain/github-work.js";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-actions-"));
const database = new DatabaseService(path.join(tempDir, "fallback.sqlite"));

try {
  const now = "2026-01-01T00:00:00Z";
  database.db
    .prepare(
      `INSERT INTO repos (
         id, github_repo_id, owner, name, full_name, is_private, is_fork, watch_enabled, sync_status, created_at, updated_at
       ) VALUES ('repo', 1, 'octo', 'repo', 'octo/repo', 0, 0, 1, 'fresh', ?, ?)`
    )
    .run(now, now);
  database.db
    .prepare(
      `INSERT INTO pull_requests (
         id, repo_id, github_pr_id, number, title, state, is_draft, merged, head_branch, head_sha, created_at, updated_at
       ) VALUES ('pr', 'repo', 10, 7, 'Fix CI', 'open', 0, 0, 'feature/checks', 'abc123', ?, ?)`
    )
    .run(now, now);
  database.db
    .prepare(
      `INSERT INTO check_runs (
         id, repo_id, pr_number, commit_sha, github_check_run_id, name, status, conclusion,
         started_at, completed_at, html_url, details_url, last_synced_at
       ) VALUES
         ('check-pass', 'repo', 7, 'abc123', 101, 'Unit Tests', 'completed', 'success', ?, ?, 'https://github.com/check/pass', null, ?),
         ('check-fail', 'repo', 7, 'abc123', 102, 'Lint', 'completed', 'failure', ?, ?, 'https://github.com/check/fail', null, ?),
         ('check-pending', 'repo', 7, 'abc123', 103, 'Deploy Preview', 'in_progress', null, ?, null, null, null, ?)`
    )
    .run(now, now, now, now, now, now, now, now);
  database.db
    .prepare(
      `INSERT INTO commit_statuses (
         id, repo_id, commit_sha, context, state, description, target_url, created_at, updated_at, last_synced_at
       ) VALUES ('status-unknown', 'repo', 'abc123', 'legacy/coverage', 'expected', 'Waiting for provider', 'https://github.com/status', ?, ?, ?)`
    )
    .run(now, now, now);
  database.db
    .prepare(
      `INSERT INTO workflow_runs (
         id, repo_id, github_workflow_run_id, workflow_name, display_title, run_number, event, status, conclusion,
         head_branch, head_sha, html_url, run_started_at, created_at, updated_at, last_synced_at
       ) VALUES ('workflow', 'repo', 201, 'CI', 'Fix CI', 44, 'pull_request', 'completed', 'success',
         'feature/checks', 'abc123', 'https://github.com/run', ?, ?, ?, ?)`
    )
    .run(now, now, now, now);

  const checks = database.localCache.githubWork.listActionChecks("repo");
  assert.equal(checks.length, 4);
  assert.equal(checks[0]?.state, "failing");
  assert.equal(checks.find((check) => check.id === "check-pass")?.state, "passing");
  assert.equal(checks.find((check) => check.id === "check-pending")?.state, "pending");
  assert.equal(checks.find((check) => check.id === "status-unknown")?.state, "unknown");
  assert.equal(checks.find((check) => check.id === "check-fail")?.prNumber, 7);
  assert.equal(checks.find((check) => check.id === "check-fail")?.branch, "feature/checks");

  const workflowRuns = database.localCache.githubWork.listWorkflowRuns("repo");
  assert.equal(workflowRuns.length, 1);
  assert.equal(workflowRuns[0]?.state, "passing");

  const html = renderToStaticMarkup(
    React.createElement(
      "section",
      null,
      checks.map((check) => React.createElement(ActionCheckStatePreview, { key: check.id, check }))
    )
  );
  assert.match(html, /Unit Tests/);
  assert.match(html, /feature\/checks/);
  assert.match(html, /#7/);
  assert.match(html, /Passing/);
  assert.match(html, /Lint/);
  assert.match(html, /Failing/);
  assert.match(html, /Deploy Preview/);
  assert.match(html, /Pending/);
  assert.match(html, /legacy\/coverage/);
  assert.match(html, /Unknown/);

  console.log("Actions checks and workflow tests ok");
} finally {
  database.close();
  await rm(tempDir, { recursive: true, force: true });
}

function ActionCheckStatePreview({ check }: { check: ActionCheckSummary }) {
  return React.createElement("div", null, check.name, " ", stateLabel(check.state), " ", check.branch, " ", `#${check.prNumber ?? "none"}`);
}

function stateLabel(state: ActionCheckSummary["state"]): string {
  if (state === "passing") return "Passing";
  if (state === "failing") return "Failing";
  if (state === "pending") return "Pending";
  return "Unknown";
}
