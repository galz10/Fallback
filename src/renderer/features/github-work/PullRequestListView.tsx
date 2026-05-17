import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AuthState } from "../../../shared/domain/auth";
import { pageCountFor, paginateItems, PaginationFooter } from "../../components/PaginationFooter";
import { filterPullRequests, parseEntityQuery, queryWithDefaultOpen } from "./entity-query";
import { SimpleSearchInput } from "./EntitySearchInput";
import { PullRequestQueueRow } from "./EntityRows";
import { SavedEntitySearchChips, SavedEntitySearchSaveButton } from "./SavedEntitySearchControls";

const ENTITY_PAGE_SIZE = 50;
const ENTITY_LIST_STALE_TIME_MS = 5 * 60_000;
const ENTITY_LIST_GC_TIME_MS = 30 * 60_000;

export function PullRequestListView({
  repoId,
  onPrClick,
  auth,
  query,
  onQueryChange
}: {
  repoId: string | null;
  onPrClick: (number: number) => void;
  auth: AuthState;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const [page, setPage] = useState(1);
  const { data: prs = [] } = useQuery({
    queryKey: ["prs", repoId],
    queryFn: () => window.fallback.prs.list(repoId!),
    enabled: Boolean(repoId),
    staleTime: ENTITY_LIST_STALE_TIME_MS,
    gcTime: ENTITY_LIST_GC_TIME_MS
  });

  const login = auth.status === "connected" ? auth.login : undefined;
  const visible = useMemo(() => filterPullRequests(prs, queryWithDefaultOpen(query), login).sort(byUpdatedDesc), [login, prs, query]);
  const pageRows = useMemo(() => paginateItems(visible, page, ENTITY_PAGE_SIZE), [page, visible]);

  useEffect(() => setPage(1), [login, query, repoId]);
  useEffect(() => {
    setPage((current) => Math.min(current, pageCountFor(visible.length, ENTITY_PAGE_SIZE)));
  }, [visible.length]);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <SimpleSearchInput
            value={query}
            onChange={onQueryChange}
            placeholder="Search or filter"
            ariaLabel="Search or filter pull requests"
            items={prs}
            login={login}
            kinds={["pr"]}
          />
          <SavedEntitySearchSaveButton kind="pr" repoId={repoId} query={query} />
        </div>
        <SavedEntitySearchChips kind="pr" repoId={repoId} query={query} onQueryChange={onQueryChange} />
      </div>
      <DefaultOpenFilterChip query={query} onQueryChange={onQueryChange} noun="pull requests" />

      <div className="divide-y divide-neutral-900 border-y border-neutral-900 bg-black">
        {visible.length === 0 && (
          <div className="px-4 py-8 text-center text-neutral-500 text-sm">
            {prs.length === 0 ? "No cached pull requests yet." : "No cached pull requests match this filter."}
          </div>
        )}
        {pageRows.map((pr) => (
          <PullRequestQueueRow key={pr.id} pr={pr} login={login} onClick={() => onPrClick(pr.number)} />
        ))}
        <PaginationFooter page={page} pageSize={ENTITY_PAGE_SIZE} total={visible.length} itemLabel="pull requests" onPageChange={setPage} />
      </div>
    </div>
  );
}

function DefaultOpenFilterChip({ query, onQueryChange, noun }: { query: string; onQueryChange: (query: string) => void; noun: string }) {
  const parsed = parseEntityQuery(query);
  const states = parsed.states;
  const explicitState = states.length > 0;
  const label = explicitState ? `State: ${states.join(", ")}` : "Open only";
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="inline-flex items-center gap-1.5 rounded-md border border-neutral-800 bg-[#0A0A0A] px-2 py-1 text-neutral-400">
        {label}
      </span>
      {!explicitState && (
        <button
          type="button"
          onClick={() => onQueryChange([query.trim(), "is:all"].filter(Boolean).join(" "))}
          className="rounded-md px-2 py-1 text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-neutral-200"
        >
          Show all {noun}
        </button>
      )}
    </div>
  );
}

function byUpdatedDesc(a: { updatedAt: string | null }, b: { updatedAt: string | null }): number {
  return timestamp(b.updatedAt) - timestamp(a.updatedAt);
}

function timestamp(value: string | null): number {
  return value ? Date.parse(value) : 0;
}
