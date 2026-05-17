import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellIcon, CheckIcon, GitPullRequestIcon, IssueOpenedIcon } from "@primer/octicons-react";
import { BellOff, Clock, Copy, ExternalLink, RefreshCcw } from "lucide-react";
import type { AuthState } from "../../shared/domain/auth";
import type { AttentionFilter, AttentionItem } from "../../shared/attention";
import { compactCount, formatRelative } from "../lib/format";

const filters: Array<{ id: AttentionFilter; label: string }> = [
  { id: "actionable", label: "Needs action" },
  { id: "waiting", label: "Waiting" },
  { id: "all", label: "Updates" }
];

export function NotificationInboxButton({
  auth,
  onOpenMyWork,
  onOpenItem
}: {
  auth: AuthState;
  onOpenMyWork: () => void;
  onOpenItem: (item: AttentionItem) => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<AttentionFilter>("actionable");
  const [summaryEnabled, setSummaryEnabled] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const authAccountKey = authScopedQueryKey(auth);
  const { data: summary } = useQuery({
    queryKey: ["notificationsSummary", authAccountKey],
    queryFn: window.fallback.notifications.summary,
    enabled: auth.status === "connected" && (summaryEnabled || open),
    refetchInterval: 180_000,
    staleTime: 30_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false
  });
  const {
    data: items = [],
    isFetching,
    isError,
    error
  } = useQuery({
    queryKey: ["notifications", authAccountKey, filter],
    queryFn: () => window.fallback.notifications.list({ ...notificationListInput(filter), limit: 80 }),
    enabled: auth.status === "connected" && open,
    staleTime: 30_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false
  });
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  useEffect(() => {
    if (auth.status !== "connected") {
      setSummaryEnabled(false);
      return;
    }
    const id = window.setTimeout(() => setSummaryEnabled(true), 5_000);
    return () => window.clearTimeout(id);
  }, [auth.status, authAccountKey]);
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["notificationsSummary"] }),
      queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      queryClient.invalidateQueries({ queryKey: ["myWorkAttention"] })
    ]);
  };
  const markRead = useMutation({
    mutationFn: (ids: string[]) => window.fallback.notifications.markRead(ids),
    onSuccess: invalidate
  });
  const markAllRead = useMutation({
    mutationFn: () => window.fallback.notifications.markAllRead({ filter }),
    onSuccess: invalidate
  });
  const markDone = useMutation({
    mutationFn: (id: string) => window.fallback.notifications.markDone(id),
    onSuccess: invalidate
  });
  const snooze = useMutation({
    mutationFn: ({ id, until }: { id: string; until: string }) => window.fallback.notifications.snooze(id, until),
    onSuccess: invalidate
  });
  const mute = useMutation({
    mutationFn: (id: string) => window.fallback.notifications.mute(id),
    onSuccess: invalidate
  });
  const refresh = useMutation({
    mutationFn: window.fallback.notifications.refresh,
    onSuccess: invalidate
  });

  useEffect(() => {
    const onToggle = () => setOpen((value) => !value);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "n" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      setOpen((value) => !value);
    };
    window.addEventListener("fallback:toggle-notifications", onToggle);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("fallback:toggle-notifications", onToggle);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const count = summary?.actionableCount ?? 0;
  const badgeTone = summary?.actionableCount ? "bg-amber-900 text-black" : "bg-neutral-800 text-neutral-200";
  const groups = useMemo(() => {
    const meaningful = items.filter((item) => item.lane !== "noise" && item.entityType !== "bot_group");
    const needsAction = meaningful.filter((item) => item.actionable || item.blocking);
    const needsIds = new Set(needsAction.map((item) => item.id));
    const waiting = meaningful.filter((item) => !needsIds.has(item.id) && ["waiting", "reviewing"].includes(item.lane));
    const waitingIds = new Set(waiting.map((item) => item.id));
    const updates = meaningful.filter((item) => !needsIds.has(item.id) && !waitingIds.has(item.id));
    return { needsAction, waiting, updates };
  }, [items]);
  const hasWorkAttention = Boolean((summary?.actionableCount ?? 0) > 0 || (summary?.waitingCount ?? 0) > 0);
  const visibleItems = filter === "actionable" ? groups.needsAction : filter === "waiting" ? groups.waiting : groups.updates;
  const emptyTitle = filter === "actionable" ? "Nothing needs action." : filter === "waiting" ? "Nothing waiting." : "No new updates.";

  if (auth.status !== "connected") return null;

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-neutral-500 transition-colors hover:bg-white/[0.04] hover:text-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-600"
        aria-expanded={open}
        aria-label="Open notifications"
        title="Open notifications (N)"
      >
        <BellIcon className="h-4 w-4" />
        {count > 0 && (
          <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${badgeTone}`}>{compactCount(count)}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[620px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-neutral-800/90 bg-[#09090a] text-neutral-200 shadow-2xl shadow-black/45">
          <div className="flex items-start justify-between gap-4 border-b border-neutral-900 px-4 py-3">
            <div className="min-w-0">
              <div className="text-[15px] font-semibold leading-5 text-neutral-100">Notifications</div>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-4 text-neutral-500">
                <span>
                  {compactCount(summary?.actionableCount ?? 0)} need action
                  {(summary?.waitingCount ?? 0) > 0 ? `, ${compactCount(summary?.waitingCount ?? 0)} waiting` : ""}
                </span>
                {(summary?.blockingCount ?? 0) > 0 && (
                  <span className="text-red-300">{compactCount(summary?.blockingCount ?? 0)} blocking</span>
                )}
                <span className="text-neutral-700">/</span>
                <span>
                  {offline ? "local cache" : summary?.lastSyncedAt ? `cached ${formatRelative(summary.lastSyncedAt)}` : "local cache"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {hasWorkAttention ? (
                <button
                  type="button"
                  onClick={onOpenMyWork}
                  className="h-7 rounded-md px-2.5 text-xs font-medium text-neutral-400 transition-colors hover:bg-neutral-900 hover:text-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-600"
                >
                  My Work
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                className="h-7 rounded-md px-2.5 text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-600 disabled:opacity-50"
              >
                Mark read
              </button>
              <button
                type="button"
                onClick={() => refresh.mutate()}
                disabled={refresh.isPending}
                className="inline-grid h-7 w-7 place-items-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-600 disabled:opacity-50"
                aria-label="Refresh notifications"
                title="Refresh notifications"
              >
                <RefreshCcw className={`h-3.5 w-3.5 ${refresh.isPending ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1 overflow-x-auto border-b border-neutral-900 px-3 py-2">
            {filters.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={`h-7 shrink-0 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-600 ${
                  filter === item.id
                    ? "bg-neutral-800 text-neutral-50 shadow-sm"
                    : "text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300"
                }`}
              >
                {item.label}
                {item.id === "actionable" && (summary?.actionableCount ?? 0) > 0 ? (
                  <span className="ml-1.5 text-neutral-500">{compactCount(summary?.actionableCount ?? 0)}</span>
                ) : null}
                {item.id === "waiting" && (summary?.waitingCount ?? 0) > 0 ? (
                  <span className="ml-1.5 text-neutral-500">{compactCount(summary?.waitingCount ?? 0)}</span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="max-h-[min(680px,calc(100vh-150px))] overflow-y-auto">
            {isFetching && items.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-neutral-600">Loading notifications...</div>
            )}
            {isError && (
              <div className="px-4 py-10 text-center text-sm text-neutral-500">
                <div className="font-medium text-neutral-300">Could not refresh notifications.</div>
                <div className="mt-1 text-xs text-neutral-600">
                  {error instanceof Error ? error.message : "Showing cached data if available."}
                </div>
              </div>
            )}
            {!isError && !isFetching && visibleItems.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-neutral-500">
                <div className="font-medium text-neutral-300">{emptyTitle}</div>
                {summary?.lastSyncedAt && (
                  <div className="mt-1 text-xs text-neutral-600">Last synced {formatRelative(summary.lastSyncedAt)}.</div>
                )}
              </div>
            )}
            {visibleItems.length > 0 && (
              <NotificationGroup
                items={visibleItems}
                markRead={markRead.mutate}
                markDone={markDone.mutate}
                snooze={snooze.mutate}
                mute={mute.mutate}
                onOpenItem={onOpenItem}
                onShowBots={() => setFilter("all")}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function authScopedQueryKey(auth: AuthState): string {
  if (auth.status === "disconnected") return "disconnected";
  return auth.accountId ?? auth.login ?? auth.status;
}

function notificationListInput(filter: AttentionFilter): { surface?: "notifications"; filter: AttentionFilter } {
  return filter === "all" ? { surface: "notifications", filter } : { filter };
}

function NotificationGroup({
  items,
  markRead,
  markDone,
  snooze,
  mute,
  onOpenItem,
  onShowBots
}: {
  items: AttentionItem[];
  markRead: (ids: string[]) => void;
  markDone: (id: string) => void;
  snooze: (input: { id: string; until: string }) => void;
  mute: (id: string) => void;
  onOpenItem: (item: AttentionItem) => void;
  onShowBots: () => void;
}) {
  return (
    <div className="border-b border-neutral-900 last:border-b-0">
      {items.map((item) => (
        <NotificationRow
          key={item.id}
          item={item}
          onOpen={() => {
            if (item.entityType === "bot_group") {
              onShowBots();
              return;
            }
            markRead([item.id]);
            onOpenItem(item);
          }}
          onDone={() => markDone(item.id)}
          onSnooze={(until) => snooze({ id: item.id, until })}
          onMute={() => mute(item.id)}
        />
      ))}
    </div>
  );
}

function NotificationRow({
  item,
  onOpen,
  onDone,
  onSnooze,
  onMute
}: {
  item: AttentionItem;
  onOpen: () => void;
  onDone: () => void;
  onSnooze: (until: string) => void;
  onMute: () => void;
}) {
  const icon =
    item.entityType === "pull_request" ? (
      <GitPullRequestIcon className="h-3.5 w-3.5 text-purple-900" />
    ) : item.entityType === "issue" ? (
      <IssueOpenedIcon className="h-3.5 w-3.5 text-green-900" />
    ) : (
      <BellIcon className="h-3.5 w-3.5 text-neutral-500" />
    );
  const tone = notificationTone(item);
  const meta = notificationMeta(item);
  return (
    <article
      className={`group relative border-t border-neutral-900 px-4 py-3.5 transition-colors first:border-t-0 hover:bg-white/[0.035] ${
        item.unread ? "bg-white/[0.018]" : ""
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="block w-full min-w-0 rounded-md pr-40 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-600"
      >
        <div className="flex min-w-0 items-center gap-2 text-xs leading-4 text-neutral-500">
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
          <span className="truncate font-medium text-neutral-500">{meta}</span>
          {item.updatedAt && <span className="shrink-0 text-neutral-600">{formatRelative(item.updatedAt)}</span>}
          {item.unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-900" />}
        </div>
        <div className="mt-1 truncate text-[14px] font-medium leading-5 text-neutral-100">{cleanNotificationTitle(item.whatChanged)}</div>
        <div className="mt-1 line-clamp-2 text-[13px] leading-5 text-neutral-500">{cleanNotificationPreview(item)}</div>
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-600">
          {tone.label === "Blocking" && <span className={tone.className}>{tone.label}</span>}
          <span className="truncate">{item.whyRelevant}</span>
        </div>
      </button>
      <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-0.5 rounded-md border border-neutral-800 bg-[#111112]/95 p-0.5 opacity-0 shadow-lg shadow-black/30 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        <button
          type="button"
          onClick={onDone}
          className="inline-grid h-7 w-7 place-items-center rounded text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-600"
          title="Done"
          aria-label="Mark done"
        >
          <CheckIcon className="h-3.5 w-3.5" />
        </button>
        <span className="relative inline-grid h-7 w-7 place-items-center rounded text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100">
          <Clock className="pointer-events-none absolute h-3.5 w-3.5" />
          <select
            aria-label="Snooze"
            defaultValue=""
            onChange={(event) => {
              const until = snoozeChoiceIso(event.currentTarget.value);
              event.currentTarget.value = "";
              if (until) onSnooze(until);
            }}
            className="absolute inset-0 h-full w-full appearance-none border-0 bg-transparent text-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-600"
            title="Snooze"
          >
            <option value="" disabled>
              Snooze
            </option>
            <option value="later_today">Later today</option>
            <option value="tomorrow">Tomorrow</option>
            <option value="next_week">Next week</option>
            <option value="custom">Custom...</option>
          </select>
        </span>
        <button
          type="button"
          onClick={onMute}
          className="inline-grid h-7 w-7 place-items-center rounded text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-600"
          title="Mute thread"
          aria-label="Mute thread"
        >
          <BellOff className="h-3.5 w-3.5" />
        </button>
        {item.htmlUrl && (
          <button
            type="button"
            onClick={() => void copyToClipboard(item.htmlUrl!)}
            className="inline-grid h-7 w-7 place-items-center rounded text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-600"
            title="Copy GitHub URL"
            aria-label="Copy GitHub URL"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
        {item.htmlUrl && (
          <button
            type="button"
            onClick={() => void window.fallback.shell.openExternal(item.htmlUrl!)}
            className="inline-grid h-7 w-7 place-items-center rounded text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-600"
            title="Open on GitHub"
            aria-label="Open on GitHub"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </article>
  );
}

function tomorrowIso(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date.toISOString();
}

function snoozeChoiceIso(choice: string): string | null {
  const date = new Date();
  if (choice === "later_today") {
    date.setHours(17, 0, 0, 0);
    if (date.getTime() <= Date.now()) date.setHours(date.getHours() + 4);
    return date.toISOString();
  }
  if (choice === "tomorrow") return tomorrowIso();
  if (choice === "next_week") {
    date.setDate(date.getDate() + 7);
    date.setHours(9, 0, 0, 0);
    return date.toISOString();
  }
  if (choice === "custom") {
    const tomorrow = new Date(tomorrowIso());
    const fallback = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")} 09:00`;
    const value = window.prompt("Snooze until", fallback);
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }
  return null;
}

function notificationTone(item: AttentionItem): { label: string; className: string } {
  if (item.urgency === "critical") return { label: "Blocking", className: "font-medium text-red-300" };
  if (item.actionable) return { label: "Needs action", className: "font-medium text-amber-300" };
  if (item.lane === "waiting" || item.lane === "reviewing") {
    return { label: "Waiting", className: "font-medium text-sky-300" };
  }
  if (item.actorIsBot || item.lane === "noise") return { label: "Automated", className: "font-medium text-neutral-500" };
  return { label: "FYI", className: "font-medium text-neutral-500" };
}

function notificationMeta(item: AttentionItem): string {
  if (item.repoFullName) return item.number ? `${item.repoFullName} #${item.number}` : item.repoFullName;
  const entity = item.entityType === "pull_request" ? "PR" : item.entityType === "issue" ? "Issue" : "Update";
  return item.number ? `${entity} #${item.number}` : entity;
}

function cleanNotificationTitle(value: string): string {
  return value.replace(/:\s*Issue updated$/i, " updated an issue").replace(/:\s*Issue #(\d+) assigned$/i, " assigned #$1");
}

function cleanNotificationPreview(item: AttentionItem): string {
  const value = item.latestMeaningfulEvent?.preview ?? item.title;
  return value.replace(/\s+/g, " ").trim();
}

async function copyToClipboard(value: string): Promise<void> {
  await navigator.clipboard?.writeText(value);
}
