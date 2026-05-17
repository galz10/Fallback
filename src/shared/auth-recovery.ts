import type { AuthState } from "./domain/auth.js";

export function isAuthRecoveryState(auth: AuthState): boolean {
  return (
    auth.status === "expired" ||
    auth.status === "revoked" ||
    auth.status === "insufficient_scope" ||
    auth.status === "org_sso_required" ||
    auth.status === "rate_limited" ||
    auth.status === "unknown_error"
  );
}

export function hasAuthAccountDetails(auth: AuthState): auth is Exclude<AuthState, { status: "disconnected" }> {
  return auth.status !== "disconnected";
}

export function authRecoveryCopy(auth: AuthState): { title: string; body: string; action: string } | null {
  switch (auth.status) {
    case "expired":
      return { title: "GitHub sign-in expired", body: auth.message, action: "Reconnect" };
    case "revoked":
      return { title: "GitHub token rejected", body: auth.message, action: "Reconnect" };
    case "insufficient_scope":
      return { title: "GitHub permissions needed", body: auth.message, action: "Reconnect" };
    case "org_sso_required":
      return { title: "GitHub SSO approval required", body: auth.message, action: "Review" };
    case "rate_limited":
      return {
        title: "GitHub rate limit reached",
        body: auth.resetAt ? `${auth.message} Cached data remains available.` : auth.message,
        action: "Settings"
      };
    case "unknown_error":
      return { title: "GitHub connection needs attention", body: auth.message, action: "Settings" };
    default:
      return null;
  }
}
