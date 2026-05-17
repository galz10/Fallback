import type { OperationRiskLevel } from "../../../../src/shared/domain/operation.js";

export interface LocalGitOperationPolicy {
  kind: string;
  riskLevel: OperationRiskLevel;
  capturesRecovery: boolean;
  createsSafetyRef: boolean;
  recoveryException?: string;
}

const localGitOperationPolicies = new Map<string, LocalGitOperationPolicy>([
  ["apply_repo_identity", policy("apply_repo_identity", "normal", true, false)],
  ["update_repo_identity", policy("update_repo_identity", "normal", true, false)],
  ["local_patch_stage", policy("local_patch_stage", "low", true, false)],
  ["local_patch_unstage", policy("local_patch_unstage", "low", true, false)],
  ["local_patch_discard", policy("local_patch_discard", "destructive", true, true)],
  ["fetch_branch", policy("fetch_branch", "low", true, false)],
  ["pull_branch", policy("pull_branch", "normal", true, true)],
  ["push_branch", policy("push_branch", "normal", true, false)],
  ["publish_branch", policy("publish_branch", "normal", true, false)],
  ["switch_branch", policy("switch_branch", "normal", true, true)],
  ["switch_workspace", policy("switch_workspace", "low", false, false)],
  ["create_workspace", policy("create_workspace", "normal", false, false)],
  ["remove_workspace", policy("remove_workspace", "normal", false, false)],
  [
    "remove_workspace_force",
    policy(
      "remove_workspace",
      "destructive",
      false,
      false,
      "Force-removing a non-primary Git worktree is recovered through Git worktree metadata and user confirmation, not a branch safety ref."
    )
  ],
  ["prune_workspaces", policy("prune_workspaces", "normal", false, false)],
  ["abort_conflict", policy("abort_conflict", "destructive", true, true)],
  ["open_merge_tool", policy("open_merge_tool", "normal", true, true)],
  ["resolve_conflict_file", policy("resolve_conflict_file", "normal", true, true)],
  ["stage_file", policy("stage_file", "low", true, false)],
  ["unstage_file", policy("unstage_file", "low", true, false)],
  ["stage_all", policy("stage_all", "low", true, false)],
  ["unstage_all", policy("unstage_all", "low", true, false)],
  ["discard_file", policy("discard_file", "destructive", true, true)],
  ["revert_commit", policy("revert_commit", "normal", true, true)],
  ["commit", policy("commit", "normal", true, true)],
  ["stash", policy("stash", "normal", true, true)],
  ["stash_files", policy("stash_files", "normal", true, true)],
  ["apply_stash", policy("apply_stash", "normal", true, true)],
  ["pop_stash", policy("pop_stash", "normal", true, true)],
  ["drop_stash", policy("drop_stash", "destructive", true, true)],
  ["pr_comment", policy("pr_comment", "normal", false, false)],
  ["pr_review", policy("pr_review", "normal", false, false)],
  ["issue_comment", policy("issue_comment", "normal", false, false)]
]);

export function localGitOperationPolicy(kind: string, riskLevel?: OperationRiskLevel): LocalGitOperationPolicy {
  const forcedKey = kind === "remove_workspace" && riskLevel === "destructive" ? "remove_workspace_force" : kind;
  return localGitOperationPolicies.get(forcedKey) ?? policy(kind, riskLevel ?? "normal", true, false);
}

export function allLocalGitOperationPolicies(): LocalGitOperationPolicy[] {
  return [...localGitOperationPolicies.values()];
}

function policy(
  kind: string,
  riskLevel: OperationRiskLevel,
  capturesRecovery: boolean,
  createsSafetyRef: boolean,
  recoveryException?: string
): LocalGitOperationPolicy {
  return { kind, riskLevel, capturesRecovery, createsSafetyRef, recoveryException };
}
