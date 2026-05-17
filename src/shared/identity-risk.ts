import type { RepoIdentity } from "./domain/repo-identity.js";

export type IdentityRiskAction = "commit" | "git" | "github" | "sync";

export interface IdentityRisk {
  level: "ok" | "warning";
  message: string | null;
}

export function identityRisk(identity: RepoIdentity | undefined | null, action: IdentityRiskAction): IdentityRisk {
  const actionLabel =
    action === "commit" ? "commit" : action === "sync" ? "sync" : action === "github" ? "write to GitHub" : "change this repo";
  if (!identity) {
    return {
      level: "warning",
      message: `Identity is still loading. Confirm the repo account before you ${actionLabel}.`
    };
  }
  if (!identity.accountId || !identity.accountLogin) {
    return {
      level: "warning",
      message: `No GitHub account is bound to this repo. Bind an account before you ${actionLabel}.`
    };
  }
  if (identity.accountStatus && identity.accountStatus !== "connected") {
    return {
      level: "warning",
      message: `The bound GitHub account is ${identity.accountStatus.replaceAll("_", " ")}. Fix account access before you ${actionLabel}.`
    };
  }
  if (identity.mismatchReason) {
    return {
      level: "warning",
      message: identity.mismatchReason
    };
  }
  if (identity.lastCheckStatus === "failed") {
    return {
      level: "warning",
      message: `The latest credential check failed. Run diagnostics before you ${actionLabel}.`
    };
  }
  if (identity.lastCheckStatus === "warning") {
    return {
      level: "warning",
      message: `The latest credential check has warnings. Review identity details before you ${actionLabel}.`
    };
  }
  if ((action === "commit" || action === "git") && !(identity.gitEmail ?? identity.currentGitEmail)) {
    return {
      level: "warning",
      message: `No commit email is configured for this repo. Set an author email before you ${actionLabel}.`
    };
  }
  if (action === "commit" && identity.verifiedEmailStatus === "failed") {
    return {
      level: "warning",
      message: `The commit email is not verified for the bound GitHub account. Fix the author email before you ${actionLabel}.`
    };
  }
  return { level: "ok", message: null };
}
