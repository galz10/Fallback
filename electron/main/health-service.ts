import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import type { WatchedRepo } from "../../src/shared/domain/watched-repo.js";
import type {
  GitHubHealthSummary,
  HealthHistory,
  HealthHistoryDay,
  HealthMatrixRow,
  HealthProbeResult,
  HealthServiceUptime,
  OfflineStatus
} from "../../src/shared/domain/health.js";
import { DatabaseService } from "./database-service.js";
import { classifyAuthFailure, errorCode as classifyErrorCode, errorMessage, isNetworkError } from "./error-classification.js";
import { GitHubApiError, GitHubClient, type GitHubIssue } from "./github-client.js";
import { nowIso } from "./path-utils.js";

const statusUrl = "https://www.githubstatus.com/api/v2/components.json";
const impactCacheUrl = "https://raw.githubusercontent.com/mrshu/github-statuses/master/.cache/impact.json";
const parsedIncidentsUrl = "https://raw.githubusercontent.com/mrshu/github-statuses/master/parsed/incidents.jsonl";
const execFileAsync = promisify(execFile);
const surfaces = [
  ["git operations", "git"],
  ["api requests", "rest_api"],
  ["pull requests", "pull_requests"],
  ["issues", "issues"],
  ["actions", "actions"],
  ["webhooks", "webhooks"],
  ["packages", "packages"],
  ["pages", "pages"],
  ["codespaces", "codespaces"],
  ["copilot", "copilot"]
] as const;
const historyDays = 90;
const appConnectivitySurfaces = new Set(["rest_api", "graphql_api", "authenticated_user"]);
const repoConnectivitySurfaces = new Set(["git", "repo_metadata", "pull_requests", "issues", "comments"]);
const historyServices = [
  { surface: "git", label: "Git Operations", matches: ["git"], components: ["Git Operations"] },
  {
    surface: "api",
    label: "API Requests",
    matches: ["rest_api", "graphql_api", "authenticated_user", "repo_metadata"],
    components: ["API Requests"]
  },
  { surface: "webhooks", label: "Webhooks", matches: ["webhooks"], components: ["Webhooks"] },
  { surface: "issues", label: "Issues", matches: ["issues", "comments"], components: ["Issues"] },
  { surface: "pull_requests", label: "Pull Requests", matches: ["pull_requests"], components: ["Pull Requests"] },
  { surface: "actions", label: "GitHub Actions", matches: ["actions"], components: ["Actions", "GitHub Actions"] },
  { surface: "packages", label: "GitHub Packages", matches: ["packages"], components: ["Packages", "GitHub Packages"] },
  { surface: "pages", label: "GitHub Pages", matches: ["pages"], components: ["Pages", "GitHub Pages"] },
  { surface: "codespaces", label: "Codespaces", matches: ["codespaces"], components: ["Codespaces"] },
  { surface: "copilot", label: "Copilot", matches: ["copilot"], components: ["Copilot"] }
] as const;
let externalHistoryCache: { loadedAt: number; value: ExternalStatusHistory } | null = null;

export class HealthService {
  private cachedHistory: { expiresAt: number; value: Promise<HealthHistory> } | null = null;
  private historyRefreshScheduled = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly github: GitHubClient
  ) {}

  async summary(): Promise<GitHubHealthSummary> {
    const probes = this.database.localCache.health.latestHealthProbes();
    if (probes.length > 0) return { status: worstStatus(githubAvailabilityProbes(probes)), checkedAt: latestCheckedAt(probes), probes };
    const fresh = await this.runProbe();
    return { status: worstStatus(githubAvailabilityProbes(fresh)), checkedAt: latestCheckedAt(fresh), probes: fresh };
  }

  async runProbe(repoId?: string): Promise<HealthProbeResult[]> {
    const probes = repoId ? await this.repoProbes(this.repo(repoId)) : await this.globalProbes();
    this.database.localCache.health.recordHealthProbes(probes);
    this.cachedHistory = null;
    this.scheduleHistorySnapshotRefresh(250);
    return probes;
  }

  matrix(): HealthMatrixRow[] {
    return this.database.localCache.health.healthMatrix();
  }

  async history(): Promise<HealthHistory> {
    if (this.cachedHistory && this.cachedHistory.expiresAt > Date.now()) return this.cachedHistory.value;
    const snapshot = this.database.localCache.cacheSummary.healthHistorySnapshot();
    if (snapshot) {
      this.cachedHistory = { expiresAt: Date.now() + 60_000, value: Promise.resolve(snapshot) };
      this.scheduleHistorySnapshotRefresh(2_500);
      return snapshot;
    }
    const value = this.loadHistory();
    this.cachedHistory = { expiresAt: Date.now() + 5 * 60_000, value };
    try {
      const history = await value;
      this.database.localCache.cacheSummary.upsertHealthHistorySnapshot(history);
      return history;
    } catch (error) {
      this.cachedHistory = null;
      throw error;
    }
  }

  private scheduleHistorySnapshotRefresh(delayMs: number): void {
    if (this.historyRefreshScheduled) return;
    this.historyRefreshScheduled = true;
    setTimeout(() => {
      void this.loadHistory()
        .then((history) => {
          this.database.localCache.cacheSummary.upsertHealthHistorySnapshot(history);
          this.cachedHistory = { expiresAt: Date.now() + 5 * 60_000, value: Promise.resolve(history) };
        })
        .catch((error) => {
          console.warn("Failed to refresh health history snapshot.", error);
        })
        .finally(() => {
          this.historyRefreshScheduled = false;
        });
    }, delayMs);
  }

  private async loadHistory(): Promise<HealthHistory> {
    const range = healthHistoryRange(historyDays);
    const probes = this.database.localCache.health.healthProbesSince(range.start.toISOString());
    const external = await githubStatusCacheHistory(range.start, range.end).catch(() => null);
    if (external) {
      return mergeProbeHistory(external, probes, range.start, historyDays);
    }

    let fallbackProbes = probes;
    if (fallbackProbes.length === 0) {
      await this.runProbe();
      fallbackProbes = this.database.localCache.health.healthProbesSince(range.start.toISOString());
    }
    const availabilityProbes = githubAvailabilityProbes(fallbackProbes);
    const platform = aggregateProbeHistory(availabilityProbes, range.start, historyDays);
    return {
      checkedAt: latestCheckedAt(fallbackProbes),
      rangeStart: dateKey(range.start),
      rangeEnd: dateKey(new Date(range.end.getTime() - 1)),
      source: "local_probes",
      uptimePercent: platform.uptimePercent,
      downtimeMinutes: 0,
      incidentCount: 0,
      cacheFetchedAt: null,
      operationalChecks: platform.operationalChecks,
      totalChecks: platform.totalChecks,
      days: platform.days,
      services: historyServices.map((service) => {
        const serviceProbes = availabilityProbes.filter((probe) => (service.matches as readonly string[]).includes(probe.surface));
        const serviceHistory = aggregateProbeHistory(serviceProbes, range.start, historyDays);
        return {
          surface: service.surface,
          label: service.label,
          uptimePercent: serviceHistory.uptimePercent,
          downtimeMinutes: 0,
          incidentCount: 0,
          operationalChecks: serviceHistory.operationalChecks,
          totalChecks: serviceHistory.totalChecks,
          days: serviceHistory.days
        };
      })
    };
  }

  async offlineStatus(): Promise<OfflineStatus> {
    const probes = this.database.localCache.health.latestHealthProbes();
    const statusProbes = offlineStatusProbes(probes);
    const checkedAt = latestCheckedAt(probes);
    if (statusProbes.some((probe) => probe.status === "rate_limited")) {
      return { state: "rate_limited", message: "GitHub rate limit reached. Cached data is still available.", checkedAt };
    }
    if (statusProbes.some((probe) => probe.repoId && probe.surface === "repo_metadata" && probe.httpStatus === 404)) {
      return { state: "repo_access_revoked", message: "Repository access appears revoked. Cached data is still available.", checkedAt };
    }
    if (statusProbes.some((probe) => probe.status === "auth_error")) {
      return { state: "auth_error", message: "GitHub connection expired. Cached data is still available.", checkedAt };
    }
    if (statusProbes.some((probe) => probe.status === "offline")) {
      return { state: "offline", message: "Fallback cannot reach GitHub right now. Showing cached GitHub data.", checkedAt };
    }
    const down = statusProbes.find((probe) => probe.status === "down");
    if (down?.httpStatus === null && down.surface !== "github_status") {
      return { state: "unknown_error", message: "GitHub network checks failed unexpectedly. Cached data is still available.", checkedAt };
    }
    if (down) {
      return { state: "github_down", message: "GitHub appears unavailable. Showing cached data.", checkedAt };
    }
    if (statusProbes.some((probe) => probe.status === "degraded")) {
      return { state: "github_degraded", message: "GitHub appears degraded. Showing cached data where needed.", checkedAt };
    }
    return { state: "online", message: "GitHub health is operational.", checkedAt };
  }

  private async globalProbes(): Promise<HealthProbeResult[]> {
    const official = await officialStatusProbes();
    if (!this.hasConnectedGitHubAccount()) {
      return [
        ...official,
        skippedProbe(null, "rest_api", "Connect GitHub to run API connectivity probes."),
        skippedProbe(null, "graphql_api", "Connect GitHub to run API connectivity probes."),
        skippedProbe(null, "authenticated_user", "Connect GitHub to run authenticated user probes.")
      ];
    }

    const [rest, graphql, user] = await Promise.all([
      timedProbe(null, "rest_api", () => this.github.get("/rate_limit")),
      timedProbe(null, "graphql_api", () => this.github.post("/graphql", { query: "{ viewer { login } }" })),
      timedProbe(null, "authenticated_user", () => this.github.get("/user"))
    ]);
    return [...official, rest, graphql, user];
  }

  private async repoProbes(repo: WatchedRepo): Promise<HealthProbeResult[]> {
    const path = `/repos/${repo.owner}/${repo.name}`;
    const git = await this.gitProbe(repo);
    if (!this.hasConnectedGitHubAccount()) {
      const message = "Connect GitHub to run repository API probes.";
      return [
        git,
        skippedProbe(repo, "repo_metadata", message),
        skippedProbe(repo, "pull_requests", message),
        skippedProbe(repo, "issues", message),
        skippedProbe(repo, "comments", message),
        skippedProbe(repo, "checks", message),
        skippedProbe(repo, "actions", message)
      ];
    }

    const [metadata, pulls, issues] = await Promise.all([
      timedProbe(repo, "repo_metadata", () => this.github.get(path)),
      timedProbe(repo, "pull_requests", () => this.github.paginate(`${path}/pulls`, { state: "open" }, 1)),
      timedValueProbe(repo, "issues", () => this.github.paginate<GitHubIssue>(`${path}/issues`, { state: "open" }, 1))
    ]);
    const firstIssue = issues.value?.[0];
    return [
      git,
      metadata,
      pulls,
      issues.probe,
      firstIssue
        ? await timedProbe(repo, "comments", () => this.github.paginate(`${path}/issues/${firstIssue.number}/comments`, {}, 1))
        : skippedProbe(repo, "comments"),
      await timedProbe(repo, "checks", () => this.github.get(`${path}/commits/${repo.defaultBranch ?? "HEAD"}/check-runs`)),
      await timedProbe(repo, "actions", () => this.github.get(`${path}/actions/runs?per_page=1`))
    ];
  }

  private repo(repoId: string): WatchedRepo {
    const repo = this.database.localCache.repos.getRepo(repoId);
    if (!repo) throw new Error(`Unknown watched repo ${repoId}`);
    return repo;
  }

  private async gitProbe(repo: WatchedRepo): Promise<HealthProbeResult> {
    if (repo.watchMode !== "cloned") return skippedProbe(repo, "git", "Repo is watched in metadata-only mode.");
    if (!repo.localPath || !existsSync(repo.localPath)) return skippedProbe(repo, "git", "Local clone path is unavailable.");
    return timedProbe(repo, "git", () => gitFetch(repo.localPath!, repo.defaultBranch ?? "HEAD"));
  }

  private hasConnectedGitHubAccount(): boolean {
    const account = this.database.localCache.accounts.getGitHubAccount();
    return Boolean(account?.tokenSource && account.authStatus === "connected");
  }
}

async function officialStatusProbes(): Promise<HealthProbeResult[]> {
  const checkedAt = nowIso();
  try {
    const response = await fetch(statusUrl);
    const body = (await response.json()) as { components?: Array<{ name: string; status: string }> };
    if (!response.ok)
      return [
        probe(null, "github_status", "degraded", checkedAt, null, response.status, response.statusText, `github_status_${response.status}`)
      ];
    const componentProbes = (body.components ?? []).flatMap((component) => {
      const surface = statusSurface(component.name);
      return surface ? [probe(null, surface, componentStatus(component.status), checkedAt, null, response.status, null)] : [];
    });
    const rollupStatus = worstStatus(componentProbes);
    return [probe(null, "github_status", rollupStatus, checkedAt, null, response.status, null), ...componentProbes];
  } catch (error) {
    return [
      probe(
        null,
        "github_status",
        networkStatus(error),
        checkedAt,
        null,
        null,
        errorMessage(error),
        classifyErrorCode(error, "probe_failed")
      )
    ];
  }
}

async function timedProbe(repo: WatchedRepo | null, surface: string, request: () => Promise<unknown>): Promise<HealthProbeResult> {
  return (await timedValueProbe(repo, surface, request)).probe;
}

async function timedValueProbe<T>(
  repo: WatchedRepo | null,
  surface: string,
  request: () => Promise<T>
): Promise<{ probe: HealthProbeResult; value: T | null }> {
  const started = Date.now();
  const checkedAt = nowIso();
  try {
    const value = await request();
    return { probe: probe(repo, surface, "operational", checkedAt, Date.now() - started, 200, null), value };
  } catch (error) {
    const api = error instanceof GitHubApiError ? error : null;
    return {
      probe: probe(
        repo,
        surface,
        api ? githubErrorStatus(api) : networkStatus(error),
        checkedAt,
        Date.now() - started,
        api?.status ?? null,
        errorMessage(error),
        classifyErrorCode(error, "probe_failed")
      ),
      value: null
    };
  }
}

async function gitFetch(localPath: string, ref: string): Promise<void> {
  await execFileAsync("git", ["-C", localPath, "fetch", "--quiet", "origin", ref], { timeout: 30_000 });
}

function skippedProbe(
  repo: WatchedRepo | null,
  surface: string,
  message = "No cached issue available to probe comments."
): HealthProbeResult {
  return probe(repo, surface, "unknown", nowIso(), null, null, message);
}

function probe(
  repo: WatchedRepo | null,
  surface: string,
  status: HealthProbeResult["status"],
  checkedAt: string,
  latencyMs: number | null,
  httpStatus: number | null,
  errorMessage: string | null,
  errorCode: string | null = null
): HealthProbeResult {
  return {
    repoId: repo?.id ?? null,
    repoFullName: repo?.fullName ?? null,
    surface,
    status,
    latencyMs,
    httpStatus,
    errorCode,
    errorMessage,
    checkedAt
  };
}

function githubErrorStatus(error: GitHubApiError): HealthProbeResult["status"] {
  const authFailure = classifyAuthFailure(error);
  if (authFailure?.status === "rate_limited") return "rate_limited";
  if (authFailure && authFailure.status !== "unknown_error") return "auth_error";
  if (error.status >= 500) return "down";
  return "degraded";
}

function networkStatus(error: unknown): HealthProbeResult["status"] {
  return isNetworkError(error) ? "offline" : "down";
}

function componentStatus(status: string): HealthProbeResult["status"] {
  if (status === "operational") return "operational";
  if (status === "major_outage") return "down";
  return "degraded";
}

function statusSurface(name: string): string | null {
  const normalized = name.toLowerCase();
  return surfaces.find(([needle]) => normalized.includes(needle))?.[1] ?? null;
}

function worstStatus(probes: HealthProbeResult[]): HealthProbeResult["status"] {
  for (const status of ["down", "offline", "auth_error", "rate_limited", "degraded"] as const) {
    if (probes.some((probe) => probe.status === status)) return status;
  }
  return probes.length ? "operational" : "unknown";
}

function platformHealthProbes(probes: HealthProbeResult[]): HealthProbeResult[] {
  return probes.filter((probe) => probe.surface !== "sync");
}

function githubAvailabilityProbes(probes: HealthProbeResult[]): HealthProbeResult[] {
  return platformHealthProbes(probes).filter(countsTowardGitHubAvailability);
}

function countsTowardGitHubAvailability(probe: HealthProbeResult): boolean {
  if (probe.status === "auth_error" || probe.status === "rate_limited" || probe.status === "unknown") return false;
  if (probe.surface === "github_status") return true;
  if (isOfficialStatusComponentProbe(probe)) return true;
  if (probe.status === "operational") return true;
  return probe.httpStatus != null && probe.httpStatus >= 500;
}

function isOfficialStatusComponentProbe(probe: HealthProbeResult): boolean {
  return !probe.repoId && probe.httpStatus === 200 && probe.latencyMs === null && probe.errorMessage === null;
}

function offlineStatusProbes(probes: HealthProbeResult[]): HealthProbeResult[] {
  const statusProbes = platformHealthProbes(probes).filter((probe) =>
    probe.repoId ? repoConnectivitySurfaces.has(probe.surface) : appConnectivitySurfaces.has(probe.surface)
  );
  const latestSuccessfulAppProbeAt = statusProbes
    .filter((probe) => !probe.repoId && probe.status === "operational")
    .map((probe) => Date.parse(probe.checkedAt))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .at(-1);
  if (latestSuccessfulAppProbeAt == null) return statusProbes;

  return statusProbes.filter((probe) => {
    if (!probe.repoId) return true;
    const checkedAt = Date.parse(probe.checkedAt);
    return Number.isFinite(checkedAt) && checkedAt >= latestSuccessfulAppProbeAt;
  });
}

function latestCheckedAt(probes: HealthProbeResult[]): string {
  return (
    probes
      .map((probe) => probe.checkedAt)
      .sort()
      .at(-1) ?? nowIso()
  );
}

function healthHistoryRange(days: number): { start: Date; end: Date } {
  const today = dayStartUtc(new Date());
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function aggregateProbeHistory(
  probes: HealthProbeResult[],
  rangeStart: Date,
  days: number
): Pick<HealthServiceUptime, "uptimePercent" | "operationalChecks" | "totalChecks" | "days"> {
  const buckets: HealthHistoryDay[] = Array.from({ length: days }, (_, index) => {
    const date = new Date(rangeStart);
    date.setUTCDate(date.getUTCDate() + index);
    return { date: dateKey(date), status: "unknown", checkedCount: 0, incidentCount: 0 };
  });
  let operationalChecks = 0;
  let totalChecks = 0;

  for (const probe of probes) {
    const checkedAt = new Date(probe.checkedAt);
    if (Number.isNaN(checkedAt.getTime())) continue;
    const index = Math.floor((dayStartUtc(checkedAt).getTime() - rangeStart.getTime()) / 86_400_000);
    const bucket = buckets[index];
    if (!bucket) continue;

    bucket.checkedCount += 1;
    bucket.status = worseHistoryStatus(bucket.status, probe.status);
    if (probe.status === "unknown") continue;
    totalChecks += 1;
    if (probe.status === "operational") operationalChecks += 1;
  }

  return {
    uptimePercent: totalChecks > 0 ? (operationalChecks / totalChecks) * 100 : null,
    operationalChecks,
    totalChecks,
    days: buckets
  };
}

function dayStartUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function worseHistoryStatus(current: HealthProbeResult["status"], next: HealthProbeResult["status"]): HealthProbeResult["status"] {
  return historyStatusRank(next) > historyStatusRank(current) ? next : current;
}

function historyStatusRank(status: HealthProbeResult["status"]): number {
  switch (status) {
    case "down":
      return 6;
    case "offline":
      return 5;
    case "auth_error":
    case "rate_limited":
      return 4;
    case "degraded":
      return 3;
    case "operational":
      return 2;
    case "unknown":
    default:
      return 0;
  }
}

async function githubStatusCacheHistory(rangeStart: Date, rangeEnd: Date): Promise<ExternalStatusHistory> {
  const cached = externalHistoryCache;
  if (cached && Date.now() - cached.loadedAt < 5 * 60_000) return cached.value;

  const [impactResponse, incidentsResponse] = await Promise.all([fetch(impactCacheUrl), fetch(parsedIncidentsUrl)]);
  if (!impactResponse.ok) throw new Error(`GitHub status impact cache failed: ${impactResponse.status}`);
  if (!incidentsResponse.ok) throw new Error(`GitHub status incidents failed: ${incidentsResponse.status}`);

  const impactCache = (await impactResponse.json()) as ImpactCache;
  if (!impactCache.items) throw new Error("GitHub status impact cache is missing items.");

  const incidentsText = await incidentsResponse.text();
  const incidents = incidentsText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CachedIncident)
    .map((incident) => withImpactCache(incident, impactCache))
    .filter((incident) => incident.downtimeStart && incident.downtimeEnd)
    .filter((incident) => clipInterval(incident.downtimeStart!, incident.downtimeEnd!, rangeStart, rangeEnd));

  const value = buildExternalStatusHistory(incidents, impactCache, rangeStart, rangeEnd, historyDays);
  externalHistoryCache = { loadedAt: Date.now(), value };
  return value;
}

function withImpactCache(incident: CachedIncident, impactCache: ImpactCache): ExternalIncident {
  const cached = incident.url ? impactCache.items[incident.url] : undefined;
  return {
    id: String(incident.id ?? incident.url ?? incident.title ?? crypto.randomUUID()),
    title: incident.title ?? "GitHub status incident",
    url: incident.url ?? null,
    impact: normalizedImpact(cached?.impact ?? incident.impact),
    components: cached?.components ?? incident.components ?? null,
    downtimeStart: parseHistoryDate(incident.downtime_start),
    downtimeEnd: parseHistoryDate(incident.downtime_end),
    updatedAt: incident.updated_at ?? incident.published_at ?? null
  };
}

function buildExternalStatusHistory(
  incidents: ExternalIncident[],
  impactCache: ImpactCache,
  rangeStart: Date,
  rangeEnd: Date,
  days: number
): ExternalStatusHistory {
  const platform = aggregateIncidentHistory(incidents, rangeStart, rangeEnd, days);
  const latestUpdatedAt =
    incidents
      .map((incident) => incident.updatedAt)
      .filter(Boolean)
      .sort()
      .at(-1) ?? nowIso();
  return {
    checkedAt: latestUpdatedAt,
    rangeStart: dateKey(rangeStart),
    rangeEnd: dateKey(new Date(rangeEnd.getTime() - 1)),
    source: "github_status_cache",
    uptimePercent: platform.uptimePercent,
    downtimeMinutes: platform.downtimeMinutes,
    incidentCount: platform.incidentCount,
    cacheFetchedAt: latestCacheFetchedAt(impactCache),
    operationalChecks: 0,
    totalChecks: 0,
    days: platform.days,
    services: historyServices.map((service) => {
      const serviceIncidents = incidents.filter((incident) =>
        (incident.components ?? []).some((component) => (service.components as readonly string[]).includes(component))
      );
      const serviceHistory = aggregateIncidentHistory(serviceIncidents, rangeStart, rangeEnd, days);
      return {
        surface: service.surface,
        label: service.label,
        uptimePercent: serviceHistory.uptimePercent,
        downtimeMinutes: serviceHistory.downtimeMinutes,
        incidentCount: serviceHistory.incidentCount,
        operationalChecks: 0,
        totalChecks: 0,
        days: serviceHistory.days
      };
    })
  };
}

function aggregateIncidentHistory(
  incidents: ExternalIncident[],
  rangeStart: Date,
  rangeEnd: Date,
  days: number
): Pick<HealthServiceUptime, "uptimePercent" | "downtimeMinutes" | "incidentCount" | "days"> {
  const buckets: HealthHistoryDay[] = Array.from({ length: days }, (_, index) => {
    const date = new Date(rangeStart);
    date.setUTCDate(date.getUTCDate() + index);
    return { date: dateKey(date), status: "operational", checkedCount: 0, incidentCount: 0 };
  });
  const downtimeIntervals: Array<[Date, Date]> = [];
  const countedIncidentIds = new Set<string>();

  for (const incident of incidents) {
    if (!incident.downtimeStart || !incident.downtimeEnd) continue;
    const clipped = clipInterval(incident.downtimeStart, incident.downtimeEnd, rangeStart, rangeEnd);
    if (!clipped) continue;
    countedIncidentIds.add(incident.id);
    if (countsAsDowntime(incident.impact)) downtimeIntervals.push(clipped);

    let current = dayStartUtc(clipped[0]);
    const lastDay = dayStartUtc(new Date(clipped[1].getTime() - 1));
    while (current <= lastDay) {
      const index = Math.floor((current.getTime() - rangeStart.getTime()) / 86_400_000);
      const bucket = buckets[index];
      if (bucket) {
        bucket.status = worseHistoryStatus(bucket.status, impactStatus(incident.impact));
        bucket.incidentCount += 1;
      }
      current = new Date(current.getTime() + 86_400_000);
    }
  }

  const downtimeMinutes = mergeIntervals(downtimeIntervals).reduce((sum, [start, end]) => sum + minutesBetween(start, end), 0);
  const totalMinutes = Math.max(1, Math.round((rangeEnd.getTime() - rangeStart.getTime()) / 60_000));
  return {
    uptimePercent: Math.max(0, 100 - (downtimeMinutes / totalMinutes) * 100),
    downtimeMinutes,
    incidentCount: countedIncidentIds.size,
    days: buckets
  };
}

function mergeProbeHistory(external: ExternalStatusHistory, probes: HealthProbeResult[], rangeStart: Date, days: number): HealthHistory {
  const availabilityProbes = githubAvailabilityProbes(probes);
  const platformProbeHistory = aggregateProbeHistory(availabilityProbes, rangeStart, days);
  return {
    ...external,
    operationalChecks: platformProbeHistory.operationalChecks,
    totalChecks: platformProbeHistory.totalChecks,
    days: overlayProbeDays(external.days, platformProbeHistory.days),
    services: external.services.map((service) => {
      const serviceConfig = historyServices.find((item) => item.surface === service.surface);
      const serviceProbes = serviceConfig
        ? availabilityProbes.filter((probe) => (serviceConfig.matches as readonly string[]).includes(probe.surface))
        : [];
      const serviceProbeHistory = aggregateProbeHistory(serviceProbes, rangeStart, days);
      return {
        ...service,
        operationalChecks: serviceProbeHistory.operationalChecks,
        totalChecks: serviceProbeHistory.totalChecks,
        days: overlayProbeDays(service.days, serviceProbeHistory.days)
      };
    })
  };
}

function overlayProbeDays(externalDays: HealthHistoryDay[], probeDays: HealthHistoryDay[]): HealthHistoryDay[] {
  return externalDays.map((day, index) => {
    const probe = probeDays[index];
    if (!probe || probe.checkedCount === 0) return day;
    return {
      ...day,
      status: worseHistoryStatus(day.status, probe.status),
      checkedCount: probe.checkedCount
    };
  });
}

function impactStatus(impact: StatusImpact): HealthProbeResult["status"] {
  if (impact === "major") return "down";
  if (impact === "minor" || impact === "maintenance") return "degraded";
  return "operational";
}

function countsAsDowntime(impact: StatusImpact): boolean {
  return impact === "minor" || impact === "major";
}

function normalizedImpact(value: unknown): StatusImpact {
  return value === "major" || value === "minor" || value === "maintenance" || value === "none" ? value : "minor";
}

function parseHistoryDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function clipInterval(start: Date, end: Date, rangeStart: Date, rangeEnd: Date): [Date, Date] | null {
  const clippedStart = new Date(Math.max(start.getTime(), rangeStart.getTime()));
  const clippedEnd = new Date(Math.min(end.getTime(), rangeEnd.getTime()));
  return clippedEnd > clippedStart ? [clippedStart, clippedEnd] : null;
}

function mergeIntervals(intervals: Array<[Date, Date]>): Array<[Date, Date]> {
  if (intervals.length === 0) return [];
  const sorted = intervals.slice().sort((a, b) => a[0].getTime() - b[0].getTime());
  const merged: Array<[Date, Date]> = [[sorted[0]![0], sorted[0]![1]]];
  for (const interval of sorted.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (interval[0] <= last[1]) {
      last[1] = new Date(Math.max(last[1].getTime(), interval[1].getTime()));
    } else {
      merged.push([interval[0], interval[1]]);
    }
  }
  return merged;
}

function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.ceil(end.getTime() / 60_000) - Math.floor(start.getTime() / 60_000));
}

function latestCacheFetchedAt(impactCache: ImpactCache): string | null {
  return (
    Object.values(impactCache.items)
      .map((item) => item.fetched_at)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null
  );
}

type StatusImpact = "none" | "maintenance" | "minor" | "major";

interface ImpactCache {
  version: number;
  items: Record<string, { impact?: string; components?: string[] | null; fetched_at?: string | null }>;
}

interface CachedIncident {
  id?: string | number | null;
  title?: string | null;
  url?: string | null;
  published_at?: string | null;
  updated_at?: string | null;
  downtime_start?: string | null;
  downtime_end?: string | null;
  impact?: string | null;
  components?: string[] | null;
}

interface ExternalIncident {
  id: string;
  title: string;
  url: string | null;
  impact: StatusImpact;
  components: string[] | null;
  downtimeStart: Date | null;
  downtimeEnd: Date | null;
  updatedAt: string | null;
}

type ExternalStatusHistory = HealthHistory & { source: "github_status_cache" };
