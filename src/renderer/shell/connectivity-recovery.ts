import type { OfflineStatus } from "../../shared/domain/health";

export const connectivityRecoveryProbeIntervalMs = 10_000;

export function isRecoverableGitHubConnectivityState(state: OfflineStatus["state"] | undefined): boolean {
  return state === "offline" || state === "github_down" || state === "github_degraded" || state === "unknown_error";
}
