import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertIcon as GitHubAlertIcon,
  CheckCircleIcon as GitHubCheckCircleIcon,
  PlayIcon as GitHubPlayIcon,
  RepoForkedIcon as GitHubRepoForkedIcon,
  WorkflowIcon as GitHubWorkflowIcon
} from "@primer/octicons-react";
import type { ActionCheckSummary, WorkflowRunSummary } from "../../../shared/domain/github-work";
import { SearchField, SegmentedControl } from "../../components/ui";
import { CacheTimestamp } from "../../components/CacheTimestamp";
import { pageCountFor, paginateItems, PaginationFooter } from "../../components/PaginationFooter";
import { SignalBadge } from "../../components/SignalBadge";
import { compactCount, formatRelative, shortSha } from "../../lib/format";
import { filterActionChecks, filterWorkflowRuns } from "./actions-query";

/* ---- Actions View ---- */

type ActionsTab = "checks" | "workflow";
const ACTIONS_PAGE_SIZE = 50;
const ACTIONS_LIST_STALE_TIME_MS = 5 * 60_000;
const ACTIONS_LIST_GC_TIME_MS = 30 * 60_000;

export function ActionsView({ repoId, onPrClick }: { repoId: string | null; onPrClick: (number: number) => void }) {
  const [tab, setTab] = useState<ActionsTab>("checks");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const { data: checks = [], isFetching: checksFetching } = useQuery({
    queryKey: ["actionChecks", repoId],
    queryFn: () => window.fallback.actions.listChecks(repoId!),
    enabled: Boolean(repoId),
    refetchInterval: 120_000,
    staleTime: ACTIONS_LIST_STALE_TIME_MS,
    gcTime: ACTIONS_LIST_GC_TIME_MS
  });
  const { data: workflowRuns = [], isFetching: workflowFetching } = useQuery({
    queryKey: ["workflowRuns", repoId],
    queryFn: () => window.fallback.actions.listWorkflowRuns(repoId!),
    enabled: Boolean(repoId),
    refetchInterval: 120_000,
    staleTime: ACTIONS_LIST_STALE_TIME_MS,
    gcTime: ACTIONS_LIST_GC_TIME_MS
  });

  const branchOptions = tab === "checks" ? actionCheckBranches(checks) : workflowRunBranches(workflowRuns);
  const checkRows = useMemo(() => filterActionChecks(checks, query), [checks, query]);
  const workflowRows = useMemo(() => filterWorkflowRuns(workflowRuns, query), [query, workflowRuns]);
  const activeCount = tab === "checks" ? checkRows.length : workflowRows.length;
  const pagedCheckRows = useMemo(() => paginateItems(checkRows, page, ACTIONS_PAGE_SIZE), [checkRows, page]);
  const pagedWorkflowRows = useMemo(() => paginateItems(workflowRows, page, ACTIONS_PAGE_SIZE), [page, workflowRows]);
  const loading = tab === "checks" ? checksFetching && checks.length === 0 : workflowFetching && workflowRuns.length === 0;
  const emptyMessage =
    tab === "checks"
      ? checks.length === 0
        ? "No cached checks or commit statuses yet. Sync a repository or PR to cache CI results."
        : "No cached checks match this filter."
      : workflowRuns.length === 0
        ? "No cached workflow runs yet. Sync the repository to cache recent GitHub Actions runs."
        : "No workflow runs match this filter.";

  useEffect(() => setPage(1), [query, repoId, tab]);
  useEffect(() => {
    setPage((current) => Math.min(current, pageCountFor(activeCount, ACTIONS_PAGE_SIZE)));
  }, [activeCount]);

  const openCheck = (check: ActionCheckSummary) => {
    if (check.prNumber) {
      onPrClick(check.prNumber);
      return;
    }
    const url = check.htmlUrl ?? check.detailsUrl ?? check.targetUrl;
    if (url) void window.fallback.shell.openExternal(url);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl<ActionsTab>
          label="Actions data type"
          value={tab}
          onChange={setTab}
          options={[
            { value: "checks", label: `Checks ${compactCount(checks.length)}` },
            { value: "workflow", label: `Workflow Runs ${compactCount(workflowRuns.length)}` }
          ]}
        />
        <span className="text-xs text-neutral-500 font-mono">{loading ? "Loading cached CI..." : `${compactCount(activeCount)} rows`}</span>
      </div>

      <div className="space-y-3">
        <ActionsSearchInput
          value={query}
          onChange={setQuery}
          tab={tab}
          checks={checks}
          workflowRuns={workflowRuns}
          branches={branchOptions}
          placeholder="Search or filter"
        />
      </div>

      <div className="divide-y divide-neutral-900 border-y border-neutral-900 bg-black">
        {tab === "checks" &&
          pagedCheckRows.map((check) => <ActionCheckRow key={check.id} check={check} onClick={() => openCheck(check)} />)}
        {tab === "workflow" &&
          pagedWorkflowRows.map((run) => (
            <WorkflowRunRow
              key={run.id}
              run={run}
              onClick={() => {
                if (run.htmlUrl) void window.fallback.shell.openExternal(run.htmlUrl);
              }}
            />
          ))}
        {activeCount === 0 && <div className="px-4 py-8 text-center text-sm text-neutral-500">{emptyMessage}</div>}
        <PaginationFooter
          page={page}
          pageSize={ACTIONS_PAGE_SIZE}
          total={activeCount}
          itemLabel={tab === "checks" ? "checks" : "workflow runs"}
          onPageChange={setPage}
        />
      </div>
    </div>
  );
}

interface ActionsQuerySuggestion {
  value: string;
  description: string;
}

function ActionsSearchInput({
  value,
  onChange,
  tab,
  checks,
  workflowRuns,
  branches,
  placeholder
}: {
  value: string;
  onChange: (value: string) => void;
  tab: ActionsTab;
  checks: ActionCheckSummary[];
  workflowRuns: WorkflowRunSummary[];
  branches: string[];
  placeholder: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const suggestionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [focused, setFocused] = useState(false);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const suggestions = useMemo(
    () => buildActionsFilterSuggestions(value, { tab, checks, workflowRuns, branches }),
    [branches, checks, tab, value, workflowRuns]
  );
  const showMenu = focused && !menuDismissed && suggestions.length > 0;
  const applySuggestion = (suggestion: ActionsQuerySuggestion) => {
    onChange(applyActionsQuerySuggestion(value, suggestion.value));
    setMenuDismissed(false);
    setFocused(true);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  useEffect(() => {
    setActiveSuggestionIndex(0);
  }, [suggestions.length, value]);
  useEffect(() => {
    if (!showMenu) return;
    suggestionRefs.current[activeSuggestionIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeSuggestionIndex, showMenu]);

  return (
    <div className="relative min-w-0">
      <SearchField
        ref={inputRef}
        aria-label={tab === "checks" ? "Search or filter checks" : "Search or filter workflow runs"}
        aria-expanded={showMenu}
        aria-haspopup="listbox"
        aria-activedescendant={showMenu ? `actions-filter-suggestion-${activeSuggestionIndex}` : undefined}
        type="text"
        value={value}
        onChange={(event) => {
          setMenuDismissed(false);
          onChange(event.currentTarget.value);
        }}
        onFocus={() => {
          setMenuDismissed(false);
          setFocused(true);
        }}
        onBlur={() =>
          window.setTimeout(() => {
            setFocused(false);
          }, 120)
        }
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setMenuDismissed(true);
            return;
          }
          if (suggestions.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!showMenu) {
              setMenuDismissed(false);
              setActiveSuggestionIndex(0);
              return;
            }
            setActiveSuggestionIndex((index) => Math.min(index + 1, suggestions.length - 1));
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            if (!showMenu) {
              setMenuDismissed(false);
              setActiveSuggestionIndex(suggestions.length - 1);
              return;
            }
            setActiveSuggestionIndex((index) => Math.max(index - 1, 0));
            return;
          }
          if (!showMenu) return;
          if (event.key === "Enter") {
            event.preventDefault();
            applySuggestion(suggestions[activeSuggestionIndex] ?? suggestions[0]!);
          }
        }}
        placeholder={placeholder}
        density="compact"
      />
      {showMenu && (
        <div
          role="listbox"
          aria-label="Actions filter suggestions"
          className="absolute left-0 top-full z-40 mt-1 max-h-[min(24rem,calc(100vh-10rem))] w-96 max-w-[calc(100vw-3rem)] overflow-y-auto rounded-md border border-neutral-800 bg-[#0A0A0A] p-1 shadow-2xl"
        >
          {suggestions.map((suggestion, index) => (
            <button
              key={`${suggestion.value}:${suggestion.description}`}
              id={`actions-filter-suggestion-${index}`}
              ref={(element) => {
                suggestionRefs.current[index] = element;
              }}
              role="option"
              aria-selected={index === activeSuggestionIndex}
              type="button"
              onMouseEnter={() => setActiveSuggestionIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                applySuggestion(suggestion);
              }}
              className={`flex w-full items-center justify-between gap-4 rounded px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                index === activeSuggestionIndex ? "bg-neutral-900 text-white" : "text-neutral-300 hover:bg-neutral-900"
              }`}
            >
              <span className="min-w-0 truncate font-mono">{suggestion.value}</span>
              <span className="shrink-0 text-xs text-neutral-600">{suggestion.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function buildActionsFilterSuggestions(
  query: string,
  input: { tab: ActionsTab; checks: ActionCheckSummary[]; workflowRuns: WorkflowRunSummary[]; branches: string[] }
): ActionsQuerySuggestion[] {
  const token = currentActionsQueryToken(query);
  const negative = token.startsWith("-") && token.length > 0;
  const suggestionToken = negative ? token.slice(1) : token;
  const formatSuggestions = (suggestions: ActionsQuerySuggestion[]) =>
    negative
      ? suggestions.map((suggestion) => ({
          ...suggestion,
          value: `-${suggestion.value}`,
          description: `Exclude ${suggestion.description.toLowerCase()}`
        }))
      : suggestions;
  const qualifierMatch = suggestionToken.match(/^([a-z-]+):(.*)$/i);

  if (!qualifierMatch)
    return formatSuggestions(filterActionsSuggestions(actionsQualifierSuggestions(input.tab, negative), suggestionToken));

  const key = qualifierMatch[1]!.toLowerCase();
  const typed = qualifierMatch[2] ?? "";
  if (key === "status" || key === "state" || key === "is")
    return formatSuggestions(filterActionsSuggestions(statusSuggestions(key), typed));
  if (key === "branch" || key === "ref")
    return formatSuggestions(filterActionsSuggestions(valueSuggestions(key, input.branches, "Branch"), typed));
  if (key === "pr" || key === "pull-request" || key === "pull") {
    return formatSuggestions(
      filterActionsSuggestions(
        actionCheckPullRequests(input.checks).map((pr) => ({ value: `${key}:${pr.number}`, description: pr.title ?? "Pull request" })),
        typed
      )
    );
  }
  if (key === "workflow" || key === "check" || key === "name") {
    const names =
      input.tab === "checks"
        ? uniqueValues(input.checks.map((check) => check.name))
        : uniqueValues(input.workflowRuns.map((run) => run.workflowName));
    return formatSuggestions(filterActionsSuggestions(valueSuggestions(key, names, input.tab === "checks" ? "Check" : "Workflow"), typed));
  }
  if (key === "event")
    return formatSuggestions(
      filterActionsSuggestions(valueSuggestions(key, uniqueValues(input.workflowRuns.map((run) => run.event)), "Event"), typed)
    );
  if (key === "actor" || key === "author" || key === "user")
    return formatSuggestions(
      filterActionsSuggestions(valueSuggestions(key, uniqueValues(input.workflowRuns.map((run) => run.actorLogin)), "Actor"), typed)
    );
  if (key === "sha" || key === "commit" || key === "head") {
    const shas =
      input.tab === "checks"
        ? uniqueValues(input.checks.map((check) => check.commitSha)).map(shortSha)
        : uniqueValues(input.workflowRuns.map((run) => run.headSha)).map(shortSha);
    return formatSuggestions(filterActionsSuggestions(valueSuggestions(key, shas, "SHA"), typed));
  }
  if (key === "kind" || key === "type")
    return formatSuggestions(filterActionsSuggestions(valueSuggestions(key, ["check_run", "commit_status"], "Kind"), typed));
  if (key === "conclusion")
    return formatSuggestions(
      filterActionsSuggestions(
        valueSuggestions(
          key,
          uniqueValues([...input.checks.map((check) => check.conclusion), ...input.workflowRuns.map((run) => run.conclusion)]),
          "Conclusion"
        ),
        typed
      )
    );
  if (key === "path")
    return formatSuggestions(
      filterActionsSuggestions(valueSuggestions(key, uniqueValues(input.workflowRuns.map((run) => run.path)), "Path"), typed)
    );
  if (key === "run" || key === "run-number")
    return formatSuggestions(
      filterActionsSuggestions(
        valueSuggestions(key, uniqueValues(input.workflowRuns.map((run) => (run.runNumber == null ? null : String(run.runNumber)))), "Run"),
        typed
      )
    );
  if (key === "repo" || key === "repository") {
    return formatSuggestions(
      filterActionsSuggestions(
        valueSuggestions(
          key,
          uniqueValues([...input.checks.map((check) => check.repoFullName), ...input.workflowRuns.map((run) => run.repoFullName)]),
          "Repository"
        ),
        typed
      )
    );
  }
  return [];
}

function actionsQualifierSuggestions(tab: ActionsTab, excluding: boolean): ActionsQuerySuggestion[] {
  const workflowOnly =
    tab === "workflow"
      ? [
          { value: "event:", description: "Workflow event" },
          { value: "actor:", description: "Actor" },
          { value: "path:", description: "Workflow path" },
          { value: "run:", description: "Run number" }
        ]
      : [{ value: "pr:", description: "Pull request" }];
  return [
    { value: "status:", description: "All, passing, failing, pending" },
    { value: "is:", description: "Status alias" },
    { value: "branch:", description: "Branch" },
    { value: "workflow:", description: tab === "checks" ? "Check name" : "Workflow" },
    ...workflowOnly,
    { value: "sha:", description: "Commit SHA" },
    { value: "conclusion:", description: "Raw conclusion" },
    { value: "repo:", description: "Repository" },
    ...(tab === "checks" ? [{ value: "kind:", description: "Check run or commit status" }] : []),
    ...(excluding ? [] : [{ value: "-", description: "Exclude a filter" }])
  ];
}

function statusSuggestions(key: string): ActionsQuerySuggestion[] {
  return ["all", "pending", "failing", "passing", "unknown"].map((value) => ({
    value: `${key}:${value}`,
    description: "Status"
  }));
}

function valueSuggestions(key: string, values: string[], description: string): ActionsQuerySuggestion[] {
  return values.map((value) => ({
    value: `${key}:${quoteActionsQueryValue(value)}`,
    description
  }));
}

function filterActionsSuggestions(suggestions: ActionsQuerySuggestion[], typed: string): ActionsQuerySuggestion[] {
  const needle = typed.replace(/^@/, "").toLowerCase();
  return suggestions.filter((suggestion) => suggestion.value.toLowerCase().includes(needle));
}

function currentActionsQueryToken(query: string): string {
  const match = query.match(/\S+$/);
  return match ? match[0] : "";
}

function applyActionsQuerySuggestion(query: string, suggestion: string): string {
  const match = query.match(/\S+$/);
  const start = match?.index ?? query.length;
  const prefix = query.slice(0, start);
  return `${prefix}${suggestion}${suggestion.endsWith(":") ? "" : " "}`;
}

function quoteActionsQueryValue(value: string): string {
  return /\s/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

function uniqueValues(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
}

function ActionCheckRow({ check, onClick }: { check: ActionCheckSummary; onClick: () => void }) {
  const target = check.prNumber ? `PR #${check.prNumber}` : check.branch ? `Branch ${check.branch}` : shortSha(check.commitSha);
  const age = check.updatedAt ? formatRelative(check.updatedAt) : "update unknown";
  return (
    <button
      type="button"
      onClick={onClick}
      className="group grid min-h-[72px] w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 px-3 py-3 text-left text-sm transition-colors hover:bg-[#090a0c] focus-visible:bg-[#090a0c] md:grid-cols-[auto_minmax(0,1fr)_minmax(220px,auto)]"
    >
      <ActionStateIcon state={check.state} />
      <div className="min-w-0 overflow-hidden">
        <div className="truncate text-[15px] text-neutral-200 transition-colors group-hover:text-white group-focus-visible:text-white">
          {check.name}
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
          <span className="truncate">
            {check.prTitle ?? check.description ?? (check.kind === "commit_status" ? "Commit status" : "Check run")}
          </span>
          <span className="text-neutral-700" aria-hidden="true">
            ·
          </span>
          <span className="font-mono text-neutral-600">{check.branch ?? shortSha(check.commitSha)}</span>
        </div>
      </div>
      <div className="col-start-2 flex min-w-0 flex-wrap items-center gap-2 text-xs md:col-start-auto md:justify-end">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-neutral-500">
          <GitHubRepoForkedIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{target}</span>
        </span>
        <SignalBadge tone={actionStateTone(check.state)}>{actionStateLabel(check.state)}</SignalBadge>
        <span className="whitespace-nowrap text-neutral-500">{age}</span>
        <CacheTimestamp cachedAt={check.lastSyncedAt} state="cached" className="whitespace-nowrap" />
      </div>
    </button>
  );
}

function WorkflowRunRow({ run, onClick }: { run: WorkflowRunSummary; onClick: () => void }) {
  const age = run.runStartedAt ? formatRelative(run.runStartedAt) : run.updatedAt ? formatRelative(run.updatedAt) : "run time unknown";
  return (
    <button
      type="button"
      onClick={onClick}
      className="group grid min-h-[72px] w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 px-3 py-3 text-left text-sm transition-colors hover:bg-[#090a0c] focus-visible:bg-[#090a0c] md:grid-cols-[auto_minmax(0,1fr)_minmax(220px,auto)]"
    >
      <ActionStateIcon state={run.state} />
      <div className="min-w-0 overflow-hidden">
        <div className="truncate text-[15px] text-neutral-200 transition-colors group-hover:text-white group-focus-visible:text-white">
          {run.workflowName ?? "Workflow run"}
          {run.runNumber && <span className="ml-2 font-mono text-xs text-neutral-600">#{run.runNumber}</span>}
        </div>
        <div className="mt-1 truncate text-xs text-neutral-500">{run.displayTitle ?? run.event ?? "Cached workflow run"}</div>
      </div>
      <div className="col-start-2 flex min-w-0 flex-wrap items-center gap-2 text-xs md:col-start-auto md:justify-end">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-neutral-500">
          <GitHubRepoForkedIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{run.headBranch ?? run.headSha?.slice(0, 7) ?? "unknown"}</span>
        </span>
        <SignalBadge tone={actionStateTone(run.state)}>{actionStateLabel(run.state)}</SignalBadge>
        <span className="whitespace-nowrap text-neutral-500">{age}</span>
        <CacheTimestamp cachedAt={run.lastSyncedAt} state="cached" className="whitespace-nowrap" />
      </div>
    </button>
  );
}

function ActionStateIcon({ state }: { state: ActionCheckSummary["state"] }) {
  if (state === "passing") return <GitHubCheckCircleIcon className="w-5 h-5 text-emerald-500 shrink-0" />;
  if (state === "failing") return <GitHubAlertIcon className="w-5 h-5 text-red-500 shrink-0" />;
  if (state === "pending") return <GitHubPlayIcon className="w-5 h-5 text-amber-400 shrink-0" />;
  return <GitHubWorkflowIcon className="w-5 h-5 text-neutral-500 shrink-0" />;
}

function actionCheckBranches(rows: ActionCheckSummary[]): string[] {
  return [...new Set(rows.map((row) => row.branch).filter((branch): branch is string => Boolean(branch)))].sort((a, b) =>
    a.localeCompare(b)
  );
}

function workflowRunBranches(rows: WorkflowRunSummary[]): string[] {
  return [...new Set(rows.map((row) => row.headBranch).filter((branch): branch is string => Boolean(branch)))].sort((a, b) =>
    a.localeCompare(b)
  );
}

function actionCheckPullRequests(rows: ActionCheckSummary[]): Array<{ number: number; title: string | null }> {
  const options = new Map<number, string | null>();
  for (const row of rows) {
    if (row.prNumber === null) continue;
    if (!options.has(row.prNumber)) options.set(row.prNumber, row.prTitle);
  }
  return [...options.entries()].map(([number, title]) => ({ number, title })).sort((a, b) => b.number - a.number);
}

function actionStateTone(state: ActionCheckSummary["state"]): "good" | "bad" | "warn" | "neutral" {
  if (state === "passing") return "good";
  if (state === "failing") return "bad";
  if (state === "pending") return "warn";
  return "neutral";
}

function actionStateLabel(state: ActionCheckSummary["state"]): string {
  if (state === "passing") return "Passing";
  if (state === "failing") return "Failing";
  if (state === "pending") return "Pending";
  return "Unknown";
}
