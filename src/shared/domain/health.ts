export interface HealthProbeResult {
  repoId?: string | null;
  repoFullName?: string | null;
  surface: string;
  status: "operational" | "degraded" | "down" | "unknown" | "rate_limited" | "auth_error" | "offline";
  latencyMs: number | null;
  httpStatus: number | null;
  errorCode?: string | null;
  errorMessage: string | null;
  checkedAt: string;
}

export interface GitHubHealthSummary {
  status: HealthProbeResult["status"];
  checkedAt: string;
  probes: HealthProbeResult[];
}

export interface HealthMatrixRow {
  repoId: string | null;
  repoFullName: string;
  git: HealthProbeResult["status"];
  api: HealthProbeResult["status"];
  prs: HealthProbeResult["status"];
  issues: HealthProbeResult["status"];
  comments: HealthProbeResult["status"];
  checks: HealthProbeResult["status"];
  actions: HealthProbeResult["status"];
  checkedAt: string | null;
  message: string | null;
}

export interface HealthHistoryDay {
  date: string;
  status: HealthProbeResult["status"];
  checkedCount: number;
  incidentCount: number;
}

export interface HealthServiceUptime {
  surface: string;
  label: string;
  uptimePercent: number | null;
  downtimeMinutes: number;
  incidentCount: number;
  operationalChecks: number;
  totalChecks: number;
  days: HealthHistoryDay[];
}

export interface HealthHistory {
  checkedAt: string;
  rangeStart: string;
  rangeEnd: string;
  source: "github_status_cache" | "local_probes";
  uptimePercent: number | null;
  downtimeMinutes: number;
  incidentCount: number;
  cacheFetchedAt: string | null;
  operationalChecks: number;
  totalChecks: number;
  days: HealthHistoryDay[];
  services: HealthServiceUptime[];
}

export interface OfflineStatus {
  state: "online" | "offline" | "github_down" | "github_degraded" | "auth_error" | "rate_limited" | "repo_access_revoked" | "unknown_error";
  message: string;
  checkedAt: string;
  resumeAt?: string | null;
}
