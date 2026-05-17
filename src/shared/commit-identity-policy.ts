import type { RepoIdentity, RepoSigningEnforcement, RepoSigningMode } from "./domain/repo-identity.js";

export type CommitIdentityStatus = "ok" | "warning" | "blocked";

export interface CommitIdentityPolicyState {
  status: CommitIdentityStatus;
  message: string | null;
  action: string | null;
  canBypass: boolean;
  quickFix: "apply_repo_identity" | null;
  expectedSigningMode: RepoSigningMode;
  signingKeyHint: string | null;
  signingEnforcement: RepoSigningEnforcement;
}

export function commitIdentityPolicy(
  identity: RepoIdentity | undefined | null,
  options: { bypassed?: boolean } = {}
): CommitIdentityPolicyState {
  const warning = (message: string, action: string, canBypass = true): CommitIdentityPolicyState => ({
    status: canBypass && options.bypassed ? "ok" : "warning",
    message,
    action,
    canBypass,
    quickFix: null,
    ...signingPolicyContext(identity)
  });
  const blocked = (message: string, action: string, quickFix: CommitIdentityPolicyState["quickFix"] = null): CommitIdentityPolicyState => ({
    status: "blocked",
    message,
    action,
    canBypass: false,
    quickFix,
    ...signingPolicyContext(identity)
  });

  if (!identity) return warning("Commit identity is still loading.", "Wait for the repo identity check to finish.", false);

  const configuredEmail = identity.currentGitEmail;
  const boundEmail = identity.gitEmail;
  if (!configuredEmail) {
    return blocked(
      "No repo-local commit email is configured.",
      "Apply the repo identity or set user.email before committing.",
      "apply_repo_identity"
    );
  }
  if (boundEmail && configuredEmail !== boundEmail) {
    return blocked(
      `Repo-local commit email is ${configuredEmail}, but the bound identity email is ${boundEmail}.`,
      "Apply the repo identity before committing.",
      "apply_repo_identity"
    );
  }
  if (!identity.accountId || !identity.accountLogin) {
    return warning("No GitHub account is bound to this repo.", "Bind an account to verify the commit identity before committing.");
  }
  if (identity.accountStatus && identity.accountStatus !== "connected") {
    return blocked(
      `The bound GitHub account is ${identity.accountStatus.replaceAll("_", " ")}.`,
      "Reconnect or fix the GitHub account before committing."
    );
  }
  if (identity.verifiedEmailStatus === "failed") {
    return blocked(
      `Commit email ${configuredEmail} is not verified for the bound GitHub account.`,
      "Use a verified GitHub email before committing.",
      "apply_repo_identity"
    );
  }
  if (identity.verifiedEmailStatus === "warning" || identity.verifiedEmailStatus === "unknown") {
    return warning(
      "Fallback could not confirm that the commit email is verified on GitHub.",
      "Run credential diagnostics or continue only if this author is intentional."
    );
  }
  if (identity.lastCheckStatus === "failed") {
    return warning("The latest credential check failed.", "Run diagnostics before committing.");
  }
  if (identity.lastCheckStatus === "warning") {
    return warning("The latest credential check has warnings.", "Review diagnostics before committing.");
  }
  if (identity.mismatchReason) {
    return blocked(identity.mismatchReason, "Apply the repo identity or update the binding before committing.", "apply_repo_identity");
  }
  if (isSigningRequiredButInactive(identity)) {
    return blocked(signingBlockedMessage(identity), signingBlockedAction(identity));
  }

  return { status: "ok", message: null, action: null, canBypass: false, quickFix: null, ...signingPolicyContext(identity) };
}

function signingPolicyContext(identity: RepoIdentity | undefined | null): {
  expectedSigningMode: RepoSigningMode;
  signingKeyHint: string | null;
  signingEnforcement: RepoSigningEnforcement;
} {
  if (!identity) return { expectedSigningMode: "unknown", signingKeyHint: null, signingEnforcement: "unknown" };
  const expectedSigningMode = identity.signingMode === "unknown" ? (identity.currentSigningMode ?? "unknown") : identity.signingMode;
  const signingEnforcement = identity.signingMode === "gpg" || identity.signingMode === "ssh" ? "repo_policy" : "none";
  return {
    expectedSigningMode,
    signingKeyHint: identity.signingKeyHint ?? identity.currentSigningKeyHint ?? null,
    signingEnforcement
  };
}

function isSigningRequiredButInactive(identity: RepoIdentity): boolean {
  if (identity.signingMode !== "gpg" && identity.signingMode !== "ssh") return false;
  return (
    identity.currentSigningMode !== identity.signingMode || identity.signingHealth === "missing_key" || identity.signingHealth === "failed"
  );
}

function signingBlockedMessage(identity: RepoIdentity): string {
  if (identity.signingHealth === "missing_key" || identity.signingHealth === "failed") {
    return identity.signingHealthMessage ?? `This repo identity expects ${identity.signingMode} commit signing, but signing is failing.`;
  }
  return `This repo identity expects ${identity.signingMode} commit signing, but repo-local signing is not active.`;
}

function signingBlockedAction(identity: RepoIdentity): string {
  if (identity.signingHealth === "missing_key") return "Set user.signingkey or fix the configured signing key path before committing.";
  if (identity.signingHealth === "failed") return "Run credential diagnostics and fix commit signing before committing.";
  return "Enable commit signing for this repository before committing.";
}
