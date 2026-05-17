import type { SyncStatus } from "../../../src/shared/domain/sync.js";
import type { HealthProbeResult } from "../../../src/shared/domain/health.js";
import { classifyAuthFailure, isNetworkError } from "../error-classification.js";
import { GitHubApiError } from "../github-client.js";

export function syncFailureStatus(error: unknown): SyncStatus {
  const authFailure = classifyAuthFailure(error);
  if (authFailure?.status === "rate_limited") return "rate_limited";
  if (authFailure && authFailure.status !== "unknown_error") return "auth_error";
  if (!(error instanceof GitHubApiError)) return isNetworkError(error) ? "offline" : "failed";
  if (error.status === 429 || /rate limit/i.test(error.body)) return "rate_limited";
  if (error.status === 401 || error.status === 403) return "auth_error";
  return "failed";
}

export function syncHealthStatus(status: SyncStatus): HealthProbeResult["status"] {
  return status === "offline" || status === "rate_limited" || status === "auth_error" ? status : "degraded";
}

export function syncHealthProbe(
  repoId: string,
  repoFullName: string,
  status: HealthProbeResult["status"],
  checkedAt: string,
  latencyMs: number | null,
  details: Pick<HealthProbeResult, "httpStatus" | "errorCode" | "errorMessage"> = {
    httpStatus: 200,
    errorCode: null,
    errorMessage: null
  }
): HealthProbeResult {
  return {
    repoId,
    repoFullName,
    surface: "sync",
    status,
    latencyMs,
    httpStatus: details.httpStatus,
    errorCode: details.errorCode,
    errorMessage: details.errorMessage,
    checkedAt
  };
}
