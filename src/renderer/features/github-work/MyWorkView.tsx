import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BellIcon as GitHubBellIcon,
  GitPullRequestIcon as GitHubPullRequestIcon,
  IssueOpenedIcon as GitHubIssueOpenedIcon
} from "@primer/octicons-react";
import { Archive, BellOff, ChevronDown, ChevronRight, Clock, Copy, ExternalLink, MoreHorizontal, RefreshCw } from "lucide-react";
import type { AuthState } from "../../../shared/domain/auth";
import type { PullRequestSummary } from "../../../shared/domain/github-work";
import type { AttentionItem, AttentionLane } from "../../../shared/attention";
import { myWorkLaneCopy, myWorkLaneOrder } from "../../../shared/product-coherence";
import { pageCountFor, paginateItems, PaginationFooter } from "../../components/PaginationFooter";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { compactCount, formatRelative } from "../../lib/format";
import { useAppPreferencesStore } from "../../state/app-store";
import {
  compareWorkItems,
  groupWorkRows,
  matchesWorkQuery,
  parseWorkQuery,
  workAttentionDisplay,
  type EntityQueryKind,
  type WorkPriorityGroupId
} from "./work-query-language";
import { MyWorkSearchInput } from "./EntitySearchInput";
import { filterMyPullRequests, myPullRequestKey, myPullRequestStatusCounts } from "./my-pull-requests";

const ENTITY_PAGE_SIZE = 50;
const ENTITY_LIST_STALE_TIME_MS = 5 * 60_000;
const ENTITY_LIST_GC_TIME_MS = 30 * 60_000;
const myWorkLanes: Array<{ id: AttentionLane; label: string }> = myWorkLaneOrder.map((id) => ({ id, label: myWorkLaneCopy[id].label }));
type MyWorkTabId = AttentionLane | "my_prs";

function WorkItemTypeIcon({ kind, state = "open" }: { kind: EntityQueryKind; state?: string }) {
  const iconClass = kind === "pr" ? "text-purple-900" : state === "closed" ? "text-red-900" : "text-green-900";
  return (
    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center" title={kind === "pr" ? "Pull request" : "Issue"}>
      {kind === "pr" ? (
        <GitHubPullRequestIcon className={`h-3.5 w-3.5 ${iconClass}`} />
      ) : (
        <GitHubIssueOpenedIcon className={`h-3.5 w-3.5 ${iconClass}`} />
      )}
    </span>
  );
}

export function MyWorkView({
  auth,
  onIssueClick,
  onPrClick
}: {
  auth: AuthState;
  onIssueClick: (target: { repoId: string; number: number }) => void;
  onPrClick: (target: { repoId: string; number: number }) => void;
}) {
  const [query, setQuery] = useState("");
  const lane = useAppPreferencesStore((state) => state.myWorkLane);
  const setLane = useAppPreferencesStore((state) => state.setMyWorkLane);
  const [activeTab, setActiveTab] = useState<MyWorkTabId>("my_prs");
  const [userSelectedTab, setUserSelectedTab] = useState(false);
  const [page, setPage] = useState(1);
  const [collapsedGroups, setCollapsedGroups] = useState<Partial<Record<WorkPriorityGroupId, boolean>>>({ low_priority: true });
  const queryClient = useQueryClient();
  const authAccountKey = authScopedQueryKey(auth);
  const { data: allItems = [], isFetching } = useQuery({
    queryKey: ["myWorkAttention", authAccountKey, lane],
    queryFn: () => window.fallback.notifications.list({ surface: "my_work", lane, limit: 250 }),
    enabled: auth.status === "connected",
    refetchInterval: 60_000,
    staleTime: ENTITY_LIST_STALE_TIME_MS,
    gcTime: ENTITY_LIST_GC_TIME_MS,
    refetchOnWindowFocus: false
  });
  const { data: myPrs = [], isFetching: myPrsFetching } = useQuery({
    queryKey: ["myPrs", authAccountKey],
    queryFn: window.fallback.prs.listMine,
    enabled: auth.status === "connected",
    staleTime: ENTITY_LIST_STALE_TIME_MS,
    gcTime: ENTITY_LIST_GC_TIME_MS,
    refetchOnWindowFocus: false
  });
  const counts = useMemo(
    () =>
      myWorkLanes.map((item) =>
        item.id === lane ? allItems : (queryClient.getQueryData<AttentionItem[]>(["myWorkAttention", authAccountKey, item.id]) ?? [])
      ),
    [allItems, authAccountKey, lane, queryClient]
  );
  const markDone = useMutation({
    mutationFn: (id: string) => window.fallback.notifications.markDone(id),
    onSuccess: () => invalidateAttentionQueries(queryClient)
  });
  const undoDone = useMutation({
    mutationFn: (id: string) => window.fallback.notifications.undoDone(id),
    onSuccess: () => invalidateAttentionQueries(queryClient)
  });
  const snooze = useMutation({
    mutationFn: ({ id, until }: { id: string; until: string }) => window.fallback.notifications.snooze(id, until),
    onSuccess: () => invalidateAttentionQueries(queryClient)
  });
  const unsnooze = useMutation({
    mutationFn: (id: string) => window.fallback.notifications.unsnooze(id),
    onSuccess: () => invalidateAttentionQueries(queryClient)
  });
  const mute = useMutation({
    mutationFn: (id: string) => window.fallback.notifications.mute(id),
    onSuccess: () => invalidateAttentionQueries(queryClient)
  });
  const unmute = useMutation({
    mutationFn: (id: string) => window.fallback.notifications.unmute(id),
    onSuccess: () => invalidateAttentionQueries(queryClient)
  });
  const refreshMyPrs = useMutation({
    mutationFn: window.fallback.prs.refreshMine,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["myPrs"] }),
        queryClient.invalidateQueries({ queryKey: ["myWorkAttention"] })
      ]);
    }
  });
  const login = auth.status === "connected" ? auth.login : undefined;
  const authoredMyPrs = useMemo(() => filterMyPullRequests(myPrs, login), [login, myPrs]);
  const authoredMyPrKeys = useMemo(() => new Set(authoredMyPrs.map(myPullRequestKey)), [authoredMyPrs]);
  const myPrStatusCounts = useMemo(() => myPullRequestStatusCounts(authoredMyPrs), [authoredMyPrs]);
  const workItems = useMemo(() => withoutAuthoredPrAttentionItems(allItems, authoredMyPrKeys), [allItems, authoredMyPrKeys]);
  const visible = useMemo(() => {
    const parsed = parseWorkQuery(query);
    const filtered = workItems.filter((item) => matchesWorkQuery(item, parsed));
    return [...filtered].sort(compareWorkItems);
  }, [query, workItems]);
  const visibleMyPrs = useMemo(() => filterPullRequestsForMyWorkTab(authoredMyPrs, query), [authoredMyPrs, query]);
  const workPageRows = useMemo(() => paginateItems(visible, page, ENTITY_PAGE_SIZE), [page, visible]);
  const prPageRows = useMemo(() => paginateItems(visibleMyPrs, page, ENTITY_PAGE_SIZE), [page, visibleMyPrs]);
  const groupedPageRows = useMemo(() => groupWorkRows(workPageRows), [workPageRows]);
  const loading = activeTab === "my_prs" ? myPrsFetching && authoredMyPrs.length === 0 : isFetching && workItems.length === 0;
  const needsMeCount = withoutAuthoredPrAttentionItems(counts[0] ?? [], authoredMyPrKeys).length;
  const laneEmptyCopy = myWorkLaneCopy[lane];
  const canCollapseGroups = query.trim() === "";
  const activeItemCount = activeTab === "my_prs" ? visibleMyPrs.length : visible.length;

  useEffect(() => setPage(1), [activeTab, auth.status, authAccountKey, lane, query]);
  useEffect(() => {
    if (userSelectedTab || auth.status !== "connected" || myPrsFetching) return;
    if (authoredMyPrs.length > 0) {
      setActiveTab("my_prs");
      return;
    }
    setLane("needs_me");
    setActiveTab("needs_me");
  }, [auth.status, authoredMyPrs.length, myPrsFetching, setLane, userSelectedTab]);
  useEffect(() => {
    if (activeTab !== "my_prs") setActiveTab(lane);
  }, [activeTab, lane]);
  useEffect(() => {
    setPage((current) => Math.min(current, pageCountFor(activeItemCount, ENTITY_PAGE_SIZE)));
  }, [activeItemCount]);

  return (
    <div className="flex-1 overflow-y-auto px-8 py-7">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[24px] font-semibold tracking-tight text-neutral-100">My Work</h1>
            <p className="mt-1 text-[13px] text-neutral-500">
              {needsMeCount > 0 ? `${compactCount(needsMeCount)} need your attention.` : "Nothing needs you right now."}
            </p>
          </div>
          <span className="shrink-0 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 font-mono text-xs text-neutral-500">
            {loading ? "Loading..." : `${compactCount(activeItemCount)} items`}
          </span>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,auto)_minmax(260px,1fr)]">
          <div className="inline-flex min-w-0 rounded-lg border border-white/[0.08] bg-[#070708] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <button
              type="button"
              onClick={() => {
                setUserSelectedTab(true);
                setActiveTab("my_prs");
              }}
              className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                activeTab === "my_prs"
                  ? "bg-white/[0.08] text-neutral-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
                  : "text-neutral-500 hover:bg-white/[0.04] hover:text-neutral-300"
              }`}
            >
              My PRs
              {authoredMyPrs.length ? (
                <span className="ml-1 font-mono text-[12px] text-neutral-600">{compactCount(authoredMyPrs.length)}</span>
              ) : null}
            </button>
            {myWorkLanes.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setUserSelectedTab(true);
                  setActiveTab(item.id);
                  setLane(item.id);
                }}
                className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  activeTab === item.id
                    ? "bg-white/[0.08] text-neutral-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
                    : "text-neutral-500 hover:bg-white/[0.04] hover:text-neutral-300"
                }`}
              >
                {item.label}
                {withoutAuthoredPrAttentionItems(counts[index] ?? [], authoredMyPrKeys).length ? (
                  <span className="ml-1 font-mono text-[12px] text-neutral-600">
                    {compactCount(withoutAuthoredPrAttentionItems(counts[index] ?? [], authoredMyPrKeys).length)}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <MyWorkSearchInput value={query} onChange={setQuery} items={activeTab === "my_prs" ? [] : workItems} />
        </div>

        <div className="overflow-hidden rounded-lg border border-white/[0.08] bg-[#050506] shadow-[0_1px_0_rgba(255,255,255,0.04),0_18px_44px_rgba(0,0,0,0.22)]">
          {activeTab === "my_prs" ? (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] bg-white/[0.025] px-4 py-2.5 text-[13px] text-neutral-500">
                <span className="min-w-0 truncate">
                  {myPrsFetching && authoredMyPrs.length === 0
                    ? "Loading authored PRs..."
                    : `${compactCount(myPrStatusCounts.open)} open, ${compactCount(myPrStatusCounts.draft)} draft, ${compactCount(
                        myPrStatusCounts.closed
                      )} closed`}
                </span>
                <button
                  type="button"
                  onClick={() => refreshMyPrs.mutate()}
                  disabled={auth.status !== "connected" || refreshMyPrs.isPending}
                  title={refreshMyPrs.isPending ? "Refreshing My PRs" : "Refresh My PRs"}
                  aria-label={refreshMyPrs.isPending ? "Refreshing My PRs" : "Refresh My PRs"}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-neutral-500 transition-colors hover:bg-white/[0.06] hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-600"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshMyPrs.isPending ? "animate-spin" : ""}`} />
                </button>
              </div>
              {auth.status !== "connected" && (
                <div className="px-4 py-8 text-center text-sm text-neutral-500">Connect GitHub to see your PRs.</div>
              )}
              {auth.status === "connected" && authoredMyPrs.length === 0 && !myPrsFetching && (
                <div className="px-4 py-8 text-center text-sm text-neutral-500">No authored PRs are cached yet.</div>
              )}
              {authoredMyPrs.length > 0 && visibleMyPrs.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-neutral-500">No authored PRs match this search.</div>
              )}
              {prPageRows.map((pr) => (
                <MyPullRequestRow key={pr.id} pr={pr} onClick={() => onPrClick({ repoId: pr.repoId, number: pr.number })} />
              ))}
            </>
          ) : (
            <>
              {auth.status !== "connected" && visible.length === 0 && (
                <div className="px-4 py-8 text-center text-neutral-500 text-sm">Connect GitHub to build your work queue.</div>
              )}
              {auth.status === "connected" && workItems.length === 0 && !loading && (
                <div className="px-4 py-8 text-center text-neutral-500 text-sm">
                  <div className="font-medium text-neutral-300">{laneEmptyCopy.emptyTitle}</div>
                  <div className="mt-1 text-xs">{laneEmptyCopy.emptyDetail}</div>
                </div>
              )}
              {workItems.length > 0 && visible.length === 0 && (
                <div className="px-4 py-8 text-center text-neutral-500 text-sm">No work items match this search.</div>
              )}
              {groupedPageRows.map(({ group, rows }) => (
                <React.Fragment key={group.id}>
                  <button
                    type="button"
                    onClick={() => setCollapsedGroups((groups) => ({ ...groups, [group.id]: !groups[group.id] }))}
                    className="flex w-full items-center justify-between gap-3 border-b border-white/[0.06] bg-white/[0.025] px-4 py-2.5 text-left font-sans text-[13px] leading-5 text-neutral-500 transition-colors hover:bg-white/[0.045] focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-neutral-600"
                    aria-expanded={!collapsedGroups[group.id] || !canCollapseGroups}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {collapsedGroups[group.id] && canCollapseGroups ? (
                        <ChevronRight className="-ml-1 h-3.5 w-3.5 text-neutral-500" />
                      ) : (
                        <ChevronDown className="-ml-1 h-3.5 w-3.5 text-neutral-500" />
                      )}
                      {group.priorityLabel && <span className="text-[13px] font-medium text-neutral-500">{group.priorityLabel}</span>}
                      <span className="text-[13px] font-medium text-neutral-400">{group.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-neutral-500">
                        {collapsedGroups[group.id] && canCollapseGroups ? "Show" : "Hide"}
                      </span>
                      <span className="text-[13px] font-medium text-neutral-500">{compactCount(rows.length)}</span>
                    </div>
                  </button>
                  {(!collapsedGroups[group.id] || !canCollapseGroups) &&
                    rows.map((item) => (
                      <AttentionWorkRow
                        key={item.id}
                        item={item}
                        onClick={() =>
                          item.entityType === "pull_request" && item.number
                            ? onPrClick({ repoId: item.repoId, number: item.number })
                            : item.entityType === "issue" && item.number
                              ? onIssueClick({ repoId: item.repoId, number: item.number })
                              : item.htmlUrl
                                ? void window.fallback.shell.openExternal(item.htmlUrl)
                                : undefined
                        }
                        onDone={() => (item.doneAt ? undoDone.mutate(item.id) : markDone.mutate(item.id))}
                        onSnoozeUntil={(until) =>
                          item.snoozedUntil ? unsnooze.mutate(item.id) : snooze.mutate({ id: item.id, until: until ?? tomorrowIso() })
                        }
                        onMute={() => (item.muted ? unmute.mutate(item.id) : mute.mutate(item.id))}
                      />
                    ))}
                </React.Fragment>
              ))}
            </>
          )}
          <PaginationFooter page={page} pageSize={ENTITY_PAGE_SIZE} total={activeItemCount} itemLabel="items" onPageChange={setPage} />
        </div>
      </div>
    </div>
  );
}

function MyPullRequestRow({ pr, onClick }: { pr: PullRequestSummary; onClick: () => void }) {
  const status = myPullRequestStatus(pr);
  return (
    <div className="group grid min-h-[76px] grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 border-b border-white/[0.06] px-4 py-3.5 text-left text-sm transition-colors last:border-b-0 hover:bg-white/[0.025] md:grid-cols-[auto_minmax(0,1fr)_minmax(190px,auto)]">
      <WorkItemTypeIcon kind="pr" state={pr.merged ? "merged" : pr.state} />
      <div className="min-w-0 overflow-hidden">
        <button type="button" onClick={onClick} className="block w-full min-w-0 text-left">
          <div className="truncate text-[14px] font-medium leading-5 text-neutral-200 transition-colors group-hover:text-neutral-50">
            <span className="mr-2.5 font-mono font-normal text-neutral-500">#{pr.number}</span>
            {pr.title}
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-5 text-neutral-500">
            {pr.repoFullName && <span className="max-w-[240px] truncate font-medium text-neutral-500">{pr.repoFullName}</span>}
            {pr.repoFullName && (
              <span className="text-neutral-700" aria-hidden="true">
                ·
              </span>
            )}
            <span className="font-medium text-neutral-400">{status?.label ?? "Open"}</span>
            <span className="text-neutral-700" aria-hidden="true">
              ·
            </span>
            <span>{pr.updatedAt ? formatRelative(pr.updatedAt) : "Update unknown"}</span>
          </div>
          <div className="mt-0.5 truncate text-[12px] leading-5 text-neutral-600">{myPullRequestPreview(pr)}</div>
          <div className="truncate text-[12px] leading-5 text-neutral-700">{myPullRequestDetail(pr)}</div>
        </button>
      </div>
      <div className="col-start-2 flex min-w-0 flex-wrap items-center gap-1 text-xs md:col-start-auto md:justify-end">
        <button
          type="button"
          onClick={onClick}
          className="rounded-md px-2 py-1 text-[12px] font-medium text-neutral-400 transition-colors hover:bg-white/[0.06] hover:text-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-600"
        >
          Open
        </button>
      </div>
    </div>
  );
}

function myPullRequestPreview(pr: PullRequestSummary): string {
  const stats = [
    pr.checkState === "failing"
      ? "Checks failing"
      : pr.checkState === "pending"
        ? "Checks pending"
        : pr.checkState === "passing"
          ? "Checks passing"
          : null,
    pr.reviewState ? reviewStateLabel(pr.reviewState) : null,
    pr.changedFiles != null ? `${compactCount(pr.changedFiles)} changed files` : null
  ].filter((item): item is string => Boolean(item));
  return stats.length > 0 ? stats.join(" · ") : "No review or check signal cached";
}

function myPullRequestDetail(pr: PullRequestSummary): string {
  const parts = [
    pr.headBranch && pr.baseBranch ? `${pr.headBranch} into ${pr.baseBranch}` : pr.headBranch || pr.baseBranch,
    pr.commentsCount != null || pr.reviewCommentsCount != null
      ? `${compactCount((pr.commentsCount ?? 0) + (pr.reviewCommentsCount ?? 0))} comments`
      : null
  ].filter((item): item is string => Boolean(item));
  return parts.length > 0 ? parts.join(" · ") : "Authored by you";
}

function reviewStateLabel(value: string): string {
  if (value === "changes requested") return "Changes requested";
  if (value === "approved") return "Approved";
  if (value === "reviewed") return "Reviewed";
  return value;
}

function myPullRequestStatus(pr: PullRequestSummary): { label: string; className: string } | null {
  if (pr.merged) return { label: "Merged", className: "bg-purple-500/10 text-purple-300" };
  if (pr.state === "closed") return { label: "Closed", className: "bg-red-500/10 text-red-300" };
  if (pr.isDraft) return { label: "Draft", className: "bg-white/[0.06] text-neutral-400" };
  if (pr.checkState === "failing") return { label: "Checks failing", className: "bg-red-500/10 text-red-300" };
  if (pr.checkState === "pending") return { label: "Checks pending", className: "bg-amber-500/10 text-amber-300" };
  return null;
}

function withoutAuthoredPrAttentionItems(items: AttentionItem[], authoredPrKeys: Set<string>): AttentionItem[] {
  return items.filter((item) => !isAuthoredPrAttentionItem(item, authoredPrKeys));
}

function isAuthoredPrAttentionItem(item: AttentionItem, authoredPrKeys: Set<string>): boolean {
  return item.entityType === "pull_request" && item.number != null && authoredPrKeys.has(`${item.repoId}:${item.number}`);
}

function filterPullRequestsForMyWorkTab(prs: PullRequestSummary[], query: string): PullRequestSummary[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return prs;
  return prs.filter((pr) => {
    const haystack = [pr.title, pr.repoFullName, pr.number, pr.headBranch, pr.baseBranch, pr.state, pr.isDraft ? "draft" : null]
      .filter((value) => value != null)
      .join(" ")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

function AttentionWorkRow({
  item,
  onClick,
  onDone,
  onSnoozeUntil,
  onMute
}: {
  item: AttentionItem;
  onClick: () => void;
  onDone: () => void;
  onSnoozeUntil: (until: string | null) => void;
  onMute: () => void;
}) {
  const kind = item.entityType === "pull_request" ? "pr" : item.entityType === "issue" ? "issue" : "notification";
  const icon =
    kind === "pr" ? (
      <WorkItemTypeIcon kind="pr" />
    ) : kind === "issue" ? (
      <WorkItemTypeIcon kind="issue" />
    ) : (
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center">
        <GitHubBellIcon className="h-3.5 w-3.5 text-neutral-500" />
      </span>
    );
  const attention = workAttentionDisplay(item);
  const latestPreview = item.latestMeaningfulEvent?.preview;
  return (
    <div className="group grid min-h-[76px] grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 border-b border-white/[0.06] px-4 py-3.5 text-left text-sm transition-colors last:border-b-0 hover:bg-white/[0.025] md:grid-cols-[auto_minmax(0,1fr)_minmax(190px,auto)]">
      {icon}
      <div className="min-w-0 overflow-hidden">
        <button type="button" onClick={onClick} className="block w-full min-w-0 text-left">
          <div className="truncate text-[14px] font-medium leading-5 text-neutral-200 transition-colors group-hover:text-neutral-50">
            {item.number && <span className="mr-2.5 font-mono font-normal text-neutral-500">#{item.number}</span>}
            {item.title}
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-5 text-neutral-500">
            {item.repoFullName && <span className="max-w-[240px] truncate font-medium text-neutral-500">{item.repoFullName}</span>}
            {item.repoFullName && (
              <span className="text-neutral-700" aria-hidden="true">
                ·
              </span>
            )}
            <span className="font-medium text-neutral-400">{attention.label}</span>
            {item.updatedAt && (
              <span className="text-neutral-700" aria-hidden="true">
                ·
              </span>
            )}
            {item.updatedAt && <span>{formatRelative(item.updatedAt)}</span>}
          </div>
          <div className="mt-0.5 truncate text-[12px] leading-5 text-neutral-600">{latestPreview ?? item.whatChanged}</div>
          <div className="truncate text-[12px] leading-5 text-neutral-700">{item.whyRelevant}</div>
        </button>
      </div>
      <div className="col-start-2 flex min-w-0 flex-wrap items-center gap-1 text-xs md:col-start-auto md:justify-end">
        <button
          type="button"
          onClick={onClick}
          className="rounded-md px-2 py-1 text-[12px] font-medium text-neutral-400 transition-colors hover:bg-white/[0.06] hover:text-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-600"
        >
          {item.suggestedAction || attention.primaryAction}
        </button>
        <div className="flex items-center gap-0.5 opacity-45 transition-opacity group-hover:opacity-100 focus-within:opacity-100 md:opacity-0">
          <button
            type="button"
            onClick={onDone}
            className="grid h-7 w-7 place-items-center rounded-md text-neutral-500 transition-colors hover:bg-white/[0.06] hover:text-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-600"
            title={item.doneAt ? "Undo done" : "Mark done"}
            aria-label={item.doneAt ? "Undo done" : "Mark done"}
          >
            <Archive className="h-3.5 w-3.5" />
          </button>
          {item.snoozedUntil ? (
            <button
              type="button"
              onClick={() => onSnoozeUntil(null)}
              className="rounded-md px-2 py-1 text-neutral-500 transition-colors hover:bg-white/[0.06] hover:text-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-600"
            >
              <Clock className="mr-1 inline h-3.5 w-3.5" />
              Unsnooze
            </button>
          ) : (
            <select
              aria-label="Snooze"
              defaultValue=""
              onChange={(event) => {
                const until = snoozeChoiceIso(event.currentTarget.value);
                event.currentTarget.value = "";
                if (until) onSnoozeUntil(until);
              }}
              className="h-7 rounded-md border border-transparent bg-transparent px-2 text-xs text-neutral-500 transition-colors hover:bg-white/[0.06] hover:text-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-600"
            >
              <option value="" disabled>
                Snooze
              </option>
              <option value="later_today">Later today</option>
              <option value="tomorrow">Tomorrow</option>
              <option value="next_week">Next week</option>
              <option value="custom">Custom...</option>
            </select>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="grid h-7 w-7 place-items-center rounded-md text-neutral-500 transition-colors hover:bg-white/[0.06] hover:text-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-600"
                aria-label="More actions"
                title="More actions"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="border-neutral-800 bg-neutral-950 text-neutral-200">
              {item.htmlUrl && (
                <DropdownMenuItem onSelect={() => void copyToClipboard(item.htmlUrl!)}>
                  <Copy className="h-3.5 w-3.5" />
                  Copy GitHub URL
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={onMute}>
                <BellOff className="h-3.5 w-3.5" />
                {item.muted ? "Restore thread" : "Mute thread"}
              </DropdownMenuItem>
              {item.htmlUrl && (
                <DropdownMenuItem onSelect={() => void window.fallback.shell.openExternal(item.htmlUrl!)}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open on GitHub
                </DropdownMenuItem>
              )}
              {item.entityType === "pull_request" && item.htmlUrl && (
                <DropdownMenuItem onSelect={() => void window.fallback.shell.openExternal(`${item.htmlUrl}/files`)}>
                  <GitHubPullRequestIcon className="h-3.5 w-3.5" />
                  Open diff
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

async function invalidateAttentionQueries(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["myWorkAttention"] }),
    queryClient.invalidateQueries({ queryKey: ["myWorkAttentionCounts"] }),
    queryClient.invalidateQueries({ queryKey: ["notifications"] }),
    queryClient.invalidateQueries({ queryKey: ["notificationsSummary"] })
  ]);
}

function authScopedQueryKey(auth: AuthState): string {
  if (auth.status === "disconnected") return "disconnected";
  return auth.accountId ?? auth.login ?? auth.status;
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

async function copyToClipboard(value: string): Promise<void> {
  await navigator.clipboard?.writeText(value);
}
