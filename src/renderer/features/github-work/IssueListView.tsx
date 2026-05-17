import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AuthState } from "../../../shared/domain/auth";
import { pageCountFor, paginateItems, PaginationFooter } from "../../components/PaginationFooter";
import { Button } from "../../components/ui";
import { compactCount } from "../../lib/format";
import { filterIssues, parseEntityQuery, queryWithDefaultOpen } from "./entity-query";
import { SimpleSearchInput } from "./EntitySearchInput";
import { IssueQueueRow } from "./EntityRows";
import { SavedEntitySearchChips, SavedEntitySearchSaveButton } from "./SavedEntitySearchControls";

const ENTITY_PAGE_SIZE = 50;
const ISSUE_LIST_WINDOW_SIZE = 250;
const ISSUE_LIST_WINDOW_MAX = 2_000;
const ENTITY_LIST_STALE_TIME_MS = 5 * 60_000;
const ENTITY_LIST_GC_TIME_MS = 30 * 60_000;

export function IssueListView({
  repoId,
  auth,
  onIssueClick,
  query,
  onQueryChange
}: {
  repoId: string | null;
  auth: AuthState;
  onIssueClick: (number: number) => void;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const [page, setPage] = useState(1);
  const [issueLimit, setIssueLimit] = useState(ISSUE_LIST_WINDOW_SIZE);
  const issueState = issueListState(query);
  const {
    data: issueResult = {
      items: [],
      issueTypes: [],
      issueFieldOptions: {},
      total: 0,
      limit: issueLimit,
      offset: 0,
      hasMore: false
    }
  } = useQuery({
    queryKey: ["issues", repoId, issueState, issueLimit],
    queryFn: () => window.fallback.issues.list(repoId!, { state: issueState, limit: issueLimit, offset: 0 }),
    enabled: Boolean(repoId),
    staleTime: ENTITY_LIST_STALE_TIME_MS,
    gcTime: ENTITY_LIST_GC_TIME_MS
  });
  const issues = issueResult.items;

  const login = auth.status === "connected" ? auth.login : undefined;
  const visible = useMemo(() => filterIssues(issues, queryWithDefaultOpen(query), login).sort(byUpdatedDesc), [issues, login, query]);
  const pageRows = useMemo(() => paginateItems(visible, page, ENTITY_PAGE_SIZE), [page, visible]);

  useEffect(() => setPage(1), [login, query, repoId, issueLimit]);
  useEffect(() => setIssueLimit(ISSUE_LIST_WINDOW_SIZE), [repoId, issueState]);
  useEffect(() => {
    setPage((current) => Math.min(current, pageCountFor(visible.length, ENTITY_PAGE_SIZE)));
  }, [visible.length]);
  const canLoadMoreIssues = issueResult.hasMore && issueLimit < ISSUE_LIST_WINDOW_MAX;
  const loadedIssueCount = issues.length;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <SimpleSearchInput
            value={query}
            onChange={onQueryChange}
            placeholder="Search or filter"
            ariaLabel="Search or filter issues"
            items={issues}
            login={login}
            kinds={["issue"]}
            suggestionOptions={{ issueTypes: issueResult.issueTypes, issueFieldOptions: issueResult.issueFieldOptions }}
          />
          <SavedEntitySearchSaveButton kind="issue" repoId={repoId} query={query} />
        </div>
        <SavedEntitySearchChips kind="issue" repoId={repoId} query={query} onQueryChange={onQueryChange} />
      </div>
      <DefaultOpenFilterChip query={query} onQueryChange={onQueryChange} noun="issues" />

      <div className="divide-y divide-neutral-900 border-y border-neutral-900 bg-black">
        {visible.length === 0 && (
          <div className="px-4 py-8 text-center text-neutral-500 text-sm">
            {issues.length === 0 ? "No cached issues yet." : "No cached issues match this filter."}
          </div>
        )}
        {pageRows.map((issue) => (
          <IssueQueueRow key={issue.id} issue={issue} login={login} onClick={() => onIssueClick(issue.number)} />
        ))}
        <PaginationFooter page={page} pageSize={ENTITY_PAGE_SIZE} total={visible.length} itemLabel="issues" onPageChange={setPage} />
        {canLoadMoreIssues && (
          <div className="flex items-center justify-between gap-3 border-t border-border bg-background-100 px-3 py-2">
            <div className="text-xs text-muted-foreground">
              Loaded {compactCount(loadedIssueCount)} of {compactCount(issueResult.total)} cached issues
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setIssueLimit((current) => Math.min(current + ISSUE_LIST_WINDOW_SIZE, ISSUE_LIST_WINDOW_MAX))}
            >
              Load more
            </Button>
          </div>
        )}
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

function issueListState(query: string): "open" | "closed" | "all" {
  const states = parseEntityQuery(queryWithDefaultOpen(query)).states;
  if (states.includes("all")) return "all";
  if (states.includes("closed")) return "closed";
  return "open";
}

function byUpdatedDesc(a: { updatedAt: string | null }, b: { updatedAt: string | null }): number {
  return timestamp(b.updatedAt) - timestamp(a.updatedAt);
}

function timestamp(value: string | null): number {
  return value ? Date.parse(value) : 0;
}
