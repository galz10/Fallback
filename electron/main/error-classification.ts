import { GitHubApiError } from "./github-client.js";
import type { AuthState } from "../../src/shared/domain/auth.js";

const networkPattern = /fetch failed|network|offline|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i;
const gitSigningPattern =
  /gpg failed to sign the data|failed to write commit object|signing failed|no secret key|couldn'?t load public key|ssh signing key|user\.signingkey|gpg\.program|pinentry|inappropriate ioctl|agent refused operation/i;

export interface AuthFailure {
  status: Exclude<AuthState["status"], "connected" | "disconnected">;
  message: string;
  resetAt?: string | null;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorCode(error: unknown, fallback: string): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "fallbackCode" in error &&
    typeof error.fallbackCode === "string" &&
    error.fallbackCode
  ) {
    return error.fallbackCode;
  }
  const authFailure = error instanceof GitHubApiError ? classifyAuthFailure(error) : null;
  if (authFailure) return `github_auth_${authFailure.status}`;
  if (error instanceof GitHubApiError) {
    if (error.status === 429 || /rate limit/i.test(error.body)) return "github_rate_limit";
    if (error.status === 401 || error.status === 403) return "github_auth";
    if (error.status === 404) return "github_not_found";
    return `github_http_${error.status}`;
  }
  if (isGitSigningError(error)) return "git_signing_failed";
  return isNetworkError(error) ? "network_offline" : fallback;
}

export function isNetworkError(error: unknown): boolean {
  return networkPattern.test(errorMessage(error));
}

export function isGitSigningError(error: unknown): boolean {
  return gitSigningPattern.test(errorMessage(error));
}

export function classifyAuthFailure(error: unknown): AuthFailure | null {
  if (!(error instanceof GitHubApiError)) return null;

  const bodyText = error.body;
  const bodyMessage = githubBodyMessage(bodyText);
  const headers = error.headers;
  const ssoHeader = headerValue(headers, "x-github-sso");
  const otpHeader = headerValue(headers, "x-github-otp");
  const acceptedScopes = headerValue(headers, "x-accepted-oauth-scopes");
  const tokenScopes = headerValue(headers, "x-oauth-scopes");
  const resetAt = error.rateLimit?.resetAt ?? resetAtFromHeaders(headers);

  if (error.status === 429 || error.rateLimit?.remaining === 0 || /rate limit/i.test(bodyText)) {
    return {
      status: "rate_limited",
      message: resetAt
        ? `GitHub rate limit reached. Fallback will retry after ${new Date(resetAt).toLocaleString()}.`
        : "GitHub rate limit reached. Cached data remains available.",
      resetAt
    };
  }

  if (error.status === 401) {
    if (otpHeader) {
      return {
        status: "unknown_error",
        message: "GitHub requires additional one-time password verification for this request."
      };
    }
    return {
      status: /expired/i.test(bodyText) ? "expired" : "revoked",
      message: /expired/i.test(bodyText)
        ? "GitHub sign-in expired. Reconnect your account to keep syncing."
        : "GitHub token was revoked or rejected. Reconnect your account to keep syncing."
    };
  }

  if (error.status === 403 && (ssoHeader || /saml|sso|single sign-on|organization access/i.test(bodyText))) {
    return {
      status: "org_sso_required",
      message: "GitHub organization SSO approval is required before Fallback can sync this data."
    };
  }

  if (
    error.status === 403 &&
    (acceptedScopes || tokenScopes || /scope|resource not accessible by integration|requires authentication/i.test(bodyText))
  ) {
    const scopeText = acceptedScopes ? ` Required scope: ${acceptedScopes}.` : "";
    return {
      status: "insufficient_scope",
      message: `${bodyMessage || "GitHub token does not have the required permissions."}${scopeText}`.trim()
    };
  }

  if (error.status === 403) {
    return {
      status: "unknown_error",
      message: bodyMessage || "GitHub rejected the request. Cached data remains available."
    };
  }

  return null;
}

function githubBodyMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    // fall through to normalized body text
  }
  return body.replaceAll(/\s+/g, " ").trim();
}

function headerValue(headers: Record<string, string>, name: string): string | null {
  return headers[name.toLowerCase()] ?? null;
}

function resetAtFromHeaders(headers: Record<string, string>): string | null {
  const reset = headerValue(headers, "x-ratelimit-reset");
  if (!reset) return null;
  const timestamp = Number(reset);
  return Number.isFinite(timestamp) ? new Date(timestamp * 1000).toISOString() : null;
}
