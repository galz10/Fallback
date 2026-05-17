import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircleIcon as GitHubCheckCircleIcon } from "@primer/octicons-react";
import type { HealthProbeResult } from "../../../shared/domain/health";
import { EmptyState, Button as UiButton, Surface } from "../../components/ui";
import { CacheTimestamp } from "../../components/CacheTimestamp";
import { formatRelative } from "../../lib/format";

const statusRows = [
  { name: "Git Operations", surfaces: ["git"] },
  { name: "API Requests", surfaces: ["api", "rest_api", "graphql_api", "authenticated_user", "repo_metadata"] },
  { name: "Webhooks", surfaces: ["webhooks"] },
  { name: "Issues", surfaces: ["issues", "comments"] },
  { name: "Pull Requests", surfaces: ["pull_requests"] },
  { name: "GitHub Actions", surfaces: ["actions"] },
  { name: "GitHub Packages", surfaces: ["packages"] },
  { name: "GitHub Pages", surfaces: ["pages"] }
] as const;

interface HealthHistoryDay {
  date: string;
  status: HealthProbeResult["status"];
  checkedCount: number;
  incidentCount: number;
}

interface StatusTimelineSelection extends HealthHistoryDay {
  label: string;
}

export function StatusView() {
  const queryClient = useQueryClient();
  const [selectedHistoryDay, setSelectedHistoryDay] = useState<StatusTimelineSelection | null>(null);
  const [historyEnabled, setHistoryEnabled] = useState(false);
  useEffect(() => {
    const timeout = window.setTimeout(() => setHistoryEnabled(true), 1_500);
    return () => window.clearTimeout(timeout);
  }, []);
  const { data: summary, isFetching } = useQuery({
    queryKey: ["health"],
    queryFn: window.fallback.health.summary,
    refetchInterval: 5 * 60_000
  });
  const { data: history, isFetching: historyFetching } = useQuery({
    queryKey: ["healthHistory"],
    queryFn: window.fallback.health.history,
    enabled: historyEnabled,
    refetchInterval: historyEnabled ? 5 * 60_000 : false
  });
  const checkRepo = useMutation({
    mutationFn: (repoId?: string) => window.fallback.health.runProbe(repoId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["health"] }),
        queryClient.invalidateQueries({ queryKey: ["healthHistory"] })
      ]);
    }
  });

  const publicStatusProbes = publicGitHubStatusProbes(summary?.probes ?? []);
  const publicStatus = publicStatusProbes.length
    ? worstSurfaceStatus(
        publicStatusProbes,
        publicStatusProbes.map((probe) => probe.surface)
      )
    : null;
  const publicHistory = history?.source === "github_status_cache" ? history : null;
  const publicStatusCheckedAt = latestPublicStatusCheckedAt(publicStatusProbes) ?? publicHistory?.checkedAt ?? null;
  const statusLabel = publicStatus ?? publicHistory?.days.at(-1)?.status ?? "unknown";
  const isHealthy = statusLabel === "operational" || (!summary && !publicHistory);
  const statusHistoryDays = publicHistory?.days ?? emptyHealthHistoryDays(90);
  const selectedStatusDetails =
    selectedHistoryDay ??
    (statusHistoryDays.at(-1)
      ? {
          ...statusHistoryDays.at(-1)!,
          label: "GitHub Status history"
        }
      : null);
  const hasHistoryData = Boolean(publicHistory && (publicHistory.incidentCount > 0 || (publicHistory.services?.length ?? 0) > 0));

  return (
    <div className="flex-1 overflow-y-auto w-full bg-black">
      <div className="max-w-4xl mx-auto py-8 px-6 space-y-8">
        <p className="text-sm text-neutral-500">Public GitHub service availability and incident history.</p>

        <div className="space-y-6">
          {/* Overall status banner */}
          <div
            className={`border rounded-lg p-5 ${isHealthy ? "border-[#28a745]/55 bg-[#0b2415]" : "border-[#d73a49]/55 bg-[#2a1013]"}`}
            aria-live="polite"
          >
            <div className="flex items-center space-x-3">
              <GitHubCheckCircleIcon className={`w-6 h-6 ${isHealthy ? "text-[#34d058]" : "text-[#f97583]"}`} />
              <div>
                <div className={`font-medium text-lg ${isHealthy ? "text-[#56d364]" : "text-[#f97583]"}`}>
                  {isHealthy ? "All Systems Operational" : `Status: ${statusText(statusLabel)}`}
                </div>
                <div className={`mt-1 text-sm ${isHealthy ? "text-[#28a745]" : "text-[#d73a49]"}`}>Latest GitHub Status check</div>
              </div>
            </div>
            <div className={`mt-3 text-sm ${isHealthy ? "text-[#28a745]" : "text-[#d73a49]"}`}>
              Last updated: {publicStatusCheckedAt ? formatRelative(publicStatusCheckedAt) : "Never checked"}
            </div>
            <UiButton
              onClick={() => checkRepo.mutate(undefined)}
              disabled={isFetching || checkRepo.isPending}
              variant="secondary"
              size="md"
              className="mt-3"
              title="Refresh GitHub Status"
            >
              {isFetching || checkRepo.isPending ? "Checking..." : "Refresh status"}
            </UiButton>
          </div>

          {/* Uptime History */}
          <Surface tone="subtle" className="p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between mb-4">
              <div>
                <div className="text-neutral-200 font-medium text-lg">Last 90 days uptime</div>
                <div className="text-neutral-500 text-xs mt-1">
                  {historyFetching
                    ? "Loading status history"
                    : publicHistory
                      ? `${publicHistory.incidentCount} GitHub status incidents`
                      : "GitHub Status history is unavailable"}
                  {publicHistory && (
                    <>
                      <span className="mx-2 text-neutral-700">·</span>
                      <CacheTimestamp cachedAt={publicHistory.cacheFetchedAt ?? publicHistory.checkedAt} state="cached" />
                    </>
                  )}
                </div>
              </div>
              <div className="text-neutral-500 text-sm">90 days ago — Today</div>
            </div>

            <StatusTimeline
              days={statusHistoryDays}
              label="GitHub Status history"
              selected={selectedStatusDetails}
              size="lg"
              onSelect={(day) => setSelectedHistoryDay({ ...day, label: "GitHub Status history" })}
            />

            {selectedStatusDetails && <StatusDayDetails selection={selectedStatusDetails} />}

            {!hasHistoryData && !historyFetching && (
              <EmptyState
                title="No GitHub Status history available."
                detail="Fallback could not load public GitHub Status incident history yet."
                className="border-t border-neutral-800"
              />
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mt-4 text-xs text-neutral-500 border-t border-neutral-800 pt-4">
              <span className="font-medium text-neutral-400">{formatUptime(publicHistory?.uptimePercent)}</span>
              <StatusLegend />
            </div>
          </Surface>

          {/* Service uptime */}
          <Surface tone="subtle">
            <div className="p-5 border-b border-neutral-800">
              <div className="text-neutral-200 font-medium text-lg">Service uptime (90 days)</div>
              <div className="text-neutral-500 text-xs mt-1">
                Public GitHub Status incidents grouped by service. {historyFetching ? "Loading latest history." : ""}
              </div>
            </div>
            <div className="divide-y divide-neutral-800">
              {(publicHistory?.services ?? []).map((service) => {
                const currentStatus = serviceCurrentStatus(publicStatusProbes, service.surface);
                return (
                  <div key={service.surface} className="p-4 space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <div className="text-neutral-200 font-medium">{service.label}</div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className={statusTextClass(currentStatus)}>{statusText(currentStatus)}</span>
                        <span className="text-neutral-500">{formatUptime(service.uptimePercent)}</span>
                      </div>
                    </div>
                    <StatusTimeline
                      days={service.days}
                      label={`${service.label} service uptime history`}
                      selected={selectedStatusDetails}
                      size="sm"
                      onSelect={(day) => setSelectedHistoryDay({ ...day, label: service.label })}
                    />
                  </div>
                );
              })}
              {!publicHistory?.services?.length && (
                <EmptyState
                  title={historyFetching ? "Loading service history..." : "No GitHub service history available."}
                  detail="Fallback could not load public GitHub Status service history yet."
                />
              )}
            </div>
          </Surface>
        </div>
      </div>
    </div>
  );
}

function StatusTimeline({
  days,
  label,
  selected,
  size,
  onSelect
}: {
  days: HealthHistoryDay[];
  label: string;
  selected: StatusTimelineSelection | null;
  size: "lg" | "sm";
  onSelect: (day: HealthHistoryDay) => void;
}) {
  return (
    <div role="list" aria-label={label} className={`flex w-full items-center space-x-[2px] ${size === "lg" ? "h-12" : "h-4"}`}>
      {days.map((day) => {
        const active = selected?.date === day.date;
        return (
          <div key={day.date} role="listitem" className="h-full min-w-[3px] flex-1">
            <button
              type="button"
              title={`${label}: ${historyDayTitle(day)}`}
              aria-label={historyDayAriaLabel(day, label)}
              aria-pressed={active}
              onClick={() => onSelect(day)}
              onFocus={() => onSelect(day)}
              className={`h-full w-full rounded-sm transition-[opacity,outline-color,transform] hover:opacity-85 focus-visible:scale-y-110 ${statusBarClass(
                day.status
              )} ${statusBarTextureClass(day.status)} ${active ? "outline outline-2 outline-offset-1 outline-white/60" : "outline outline-0 outline-transparent"}`}
            >
              <span className="sr-only">{historyDayTitle(day)}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function StatusDayDetails({ selection }: { selection: StatusTimelineSelection }) {
  return (
    <div
      className="mt-3 rounded-md border border-neutral-800 bg-black/30 px-3 py-2 text-xs text-neutral-500"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-neutral-300">{selection.label}</span>
        <span className={statusTextClass(selection.status)}>{statusText(selection.status)}</span>
        <span className="font-mono text-neutral-600">{formatHistoryDate(selection.date)}</span>
      </div>
      <div className="mt-1">{historyDayDetail(selection)}</div>
    </div>
  );
}

function StatusLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {[
        { status: "operational" as const, label: "Operational" },
        { status: "degraded" as const, label: "Degraded" },
        { status: "down" as const, label: "Major outage" },
        { status: "unknown" as const, label: "No data" }
      ].map((item) => (
        <div key={item.status} className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-sm ${statusBarClass(item.status)} ${statusBarTextureClass(item.status)}`} />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function emptyHealthHistoryDays(days: number) {
  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    return { date: date.toISOString().slice(0, 10), status: "unknown" as const, checkedCount: 0, incidentCount: 0 };
  });
}

function formatUptime(percent: number | null | undefined): string {
  return typeof percent === "number" ? `${percent.toFixed(2)}% uptime` : "No uptime data";
}

function historyDayTitle(day: { date: string; status: HealthProbeResult["status"]; checkedCount: number; incidentCount: number }): string {
  const details = [day.incidentCount ? `${day.incidentCount} incident${day.incidentCount === 1 ? "" : "s"}` : ""].filter(Boolean);
  return `${formatHistoryDate(day.date)}: ${statusText(day.status)}${details.length ? ` (${details.join(", ")})` : ""}`;
}

function historyDayAriaLabel(day: HealthHistoryDay, label: string): string {
  return `${label}, ${historyDayTitle(day)}. Focus or press to show details.`;
}

function historyDayDetail(day: HealthHistoryDay): string {
  return day.incidentCount
    ? `${day.incidentCount} public incident${day.incidentCount === 1 ? "" : "s"} were recorded.`
    : "No public incidents recorded.";
}

function formatHistoryDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(parsed);
}

function statusText(status: HealthProbeResult["status"]): string {
  if (status === "operational") return "Operational";
  if (status === "down") return "Major outage";
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function statusTextClass(status: HealthProbeResult["status"]): string {
  if (status === "operational") return "text-[#28a745]";
  if (status === "degraded") return "text-[#dbab09]";
  if (status === "down" || status === "offline") return "text-[#d73a49]";
  if (status === "auth_error" || status === "rate_limited") return "text-[#8957e5]";
  return "text-neutral-400";
}

function statusBarClass(status: HealthProbeResult["status"]): string {
  if (status === "operational") return "bg-[#28a745]";
  if (status === "degraded") return "bg-[#dbab09]";
  if (status === "down" || status === "offline") return "bg-[#d73a49]";
  if (status === "auth_error" || status === "rate_limited") return "bg-[#8957e5]";
  return "bg-neutral-500";
}

function statusBarTextureClass(status: HealthProbeResult["status"]): string {
  if (status === "operational") return "opacity-80";
  if (status === "degraded") return "opacity-85 ring-1 ring-inset ring-[#fff5b1]/35";
  if (status === "down" || status === "offline") return "opacity-85 ring-1 ring-inset ring-[#ffdce0]/35";
  if (status === "auth_error" || status === "rate_limited") return "opacity-80 ring-1 ring-inset ring-[#d8c7ff]/45";
  if (status === "unknown") return "opacity-70";
  return "";
}

function worstSurfaceStatus(probes: HealthProbeResult[], surfaces: readonly string[]): HealthProbeResult["status"] {
  const availabilityProbes = probes.filter((probe) => surfaces.includes(probe.surface)).filter(countsTowardGitHubAvailability);
  return availabilityProbes.map((probe) => probe.status).reduce(worseStatus, "unknown" as HealthProbeResult["status"]);
}

function publicGitHubStatusProbes(probes: HealthProbeResult[]): HealthProbeResult[] {
  return probes.filter((probe) => probe.surface === "github_status" || isOfficialStatusComponentProbe(probe));
}

function latestPublicStatusCheckedAt(probes: HealthProbeResult[]): string | null {
  return (
    probes
      .map((probe) => probe.checkedAt)
      .sort()
      .at(-1) ?? null
  );
}

function serviceCurrentStatus(probes: HealthProbeResult[], surface: string): HealthProbeResult["status"] {
  const row = statusRows.find((item) => (item.surfaces as readonly string[]).includes(surface));
  return row ? worstSurfaceStatus(probes, row.surfaces) : worstSurfaceStatus(probes, [surface]);
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

function worseStatus(left: HealthProbeResult["status"], right: HealthProbeResult["status"]): HealthProbeResult["status"] {
  return statusRank(right) > statusRank(left) ? right : left;
}

function statusRank(status: HealthProbeResult["status"]): number {
  if (status === "down") return 6;
  if (status === "offline") return 5;
  if (status === "auth_error" || status === "rate_limited") return 4;
  if (status === "degraded") return 3;
  if (status === "operational") return 2;
  return 0;
}
