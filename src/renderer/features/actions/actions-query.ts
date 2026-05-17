import type { ActionCheckSummary, WorkflowRunSummary } from "../../../shared/domain/github-work";

export type ActionQueryStatus = "all" | "failing" | "pending" | "passing" | "unknown";

interface ParsedActionsQuery {
  statuses: ActionQueryStatus[];
  branches: string[];
  pullRequests: string[];
  workflows: string[];
  events: string[];
  actors: string[];
  shas: string[];
  kinds: string[];
  conclusions: string[];
  repos: string[];
  paths: string[];
  runNumbers: string[];
  text: string[];
  excludes: ParsedActionsQuery[];
}

export function filterActionChecks(rows: ActionCheckSummary[], query: string): ActionCheckSummary[] {
  const parsed = parseActionsQuery(query);
  return rows.filter((row) => matchesActionCheck(row, parsed));
}

export function filterWorkflowRuns(rows: WorkflowRunSummary[], query: string): WorkflowRunSummary[] {
  const parsed = parseActionsQuery(query);
  return rows.filter((row) => matchesWorkflowRun(row, parsed));
}

export function parseActionsQuery(query: string): ParsedActionsQuery {
  const parsed = emptyActionsQuery();
  for (const token of tokenizeActionsQuery(query)) {
    const negative = token.startsWith("-") && token.length > 1;
    if (negative) {
      const excluded = emptyActionsQuery();
      applyActionsQueryToken(excluded, token.slice(1));
      if (actionsQueryHasTerms(excluded)) parsed.excludes.push(excluded);
      continue;
    }
    applyActionsQueryToken(parsed, token);
  }
  return parsed;
}

function emptyActionsQuery(): ParsedActionsQuery {
  return {
    statuses: [],
    branches: [],
    pullRequests: [],
    workflows: [],
    events: [],
    actors: [],
    shas: [],
    kinds: [],
    conclusions: [],
    repos: [],
    paths: [],
    runNumbers: [],
    text: [],
    excludes: []
  };
}

function applyActionsQueryToken(parsed: ParsedActionsQuery, token: string): void {
  const match = token.match(/^([a-z-]+):(.*)$/i);
  if (!match) {
    parsed.text.push(stripActionsQuotes(token));
    return;
  }

  const key = match[1]!.toLowerCase();
  const value = stripActionsQuotes(match[2] ?? "");
  if (!value) return;

  if (key === "status" || key === "state" || key === "is") parsed.statuses.push(normalizeActionStatus(value));
  else if (key === "branch" || key === "ref") parsed.branches.push(value);
  else if (key === "pr" || key === "pull-request" || key === "pull") parsed.pullRequests.push(value);
  else if (key === "workflow" || key === "check" || key === "name") parsed.workflows.push(value);
  else if (key === "event") parsed.events.push(value);
  else if (key === "actor" || key === "author" || key === "user") parsed.actors.push(value);
  else if (key === "sha" || key === "commit" || key === "head") parsed.shas.push(value);
  else if (key === "kind" || key === "type") parsed.kinds.push(value);
  else if (key === "conclusion") parsed.conclusions.push(value);
  else if (key === "repo" || key === "repository") parsed.repos.push(value);
  else if (key === "path") parsed.paths.push(value);
  else if (key === "run" || key === "run-number") parsed.runNumbers.push(value);
  else if (key !== "sort") parsed.text.push(stripActionsQuotes(token));
}

function actionsQueryHasTerms(query: ParsedActionsQuery): boolean {
  return Boolean(
    query.statuses.length ||
    query.branches.length ||
    query.pullRequests.length ||
    query.workflows.length ||
    query.events.length ||
    query.actors.length ||
    query.shas.length ||
    query.kinds.length ||
    query.conclusions.length ||
    query.repos.length ||
    query.paths.length ||
    query.runNumbers.length ||
    query.text.length
  );
}

function matchesActionCheck(row: ActionCheckSummary, query: ParsedActionsQuery): boolean {
  const searchable = actionCheckSearchValues(row);
  return (
    matchesStatuses(query.statuses, row.state) &&
    matchesLooseList(query.branches, [row.branch]) &&
    matchesPullRequests(query.pullRequests, row.prNumber) &&
    matchesLooseList(query.workflows, [row.name, row.prTitle, row.description]) &&
    matchesLooseList(query.shas, [row.commitSha]) &&
    matchesLooseList(query.kinds, [row.kind]) &&
    matchesLooseList(query.conclusions, [row.conclusion]) &&
    matchesLooseList(query.repos, [row.repoFullName]) &&
    matchesFreeText(searchable, [...query.events, ...query.actors, ...query.paths, ...query.runNumbers, ...query.text]) &&
    query.excludes.every((exclude) => !matchesActionCheck(row, exclude))
  );
}

function matchesWorkflowRun(row: WorkflowRunSummary, query: ParsedActionsQuery): boolean {
  const searchable = workflowRunSearchValues(row);
  return (
    matchesStatuses(query.statuses, row.state) &&
    matchesLooseList(query.branches, [row.headBranch]) &&
    matchesLooseList(query.workflows, [row.workflowName, row.displayTitle]) &&
    matchesLooseList(query.events, [row.event]) &&
    matchesLooseList(query.actors, [row.actorLogin]) &&
    matchesLooseList(query.shas, [row.headSha]) &&
    matchesLooseList(query.conclusions, [row.conclusion]) &&
    matchesLooseList(query.repos, [row.repoFullName]) &&
    matchesLooseList(query.paths, [row.path]) &&
    matchesRunNumbers(query.runNumbers, row.runNumber) &&
    matchesFreeText(searchable, [...query.pullRequests, ...query.kinds, ...query.text]) &&
    query.excludes.every((exclude) => !matchesWorkflowRun(row, exclude))
  );
}

function matchesStatuses(filters: ActionQueryStatus[], value: ActionQueryStatus): boolean {
  const effective = filters.filter((filter) => filter !== "all");
  return effective.length === 0 || effective.some((filter) => filter === value);
}

function matchesPullRequests(filters: string[], value: number | null): boolean {
  if (filters.length === 0) return true;
  return filters.every((filter) => {
    const normalized = normalizeActionValue(filter).replace(/^#/, "");
    if (normalized === "none" || normalized === "false") return value == null;
    return value != null && String(value).includes(normalized);
  });
}

function matchesRunNumbers(filters: string[], value: number | null): boolean {
  if (filters.length === 0) return true;
  return filters.every((filter) => value != null && String(value).includes(normalizeActionValue(filter).replace(/^#/, "")));
}

function matchesLooseList(filters: string[], values: Array<string | null | undefined>): boolean {
  return filters.every((filter) =>
    values.some((value) => value != null && normalizeActionValue(value).includes(normalizeActionValue(filter)))
  );
}

function matchesFreeText(values: Array<string | number | null | undefined>, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = values
    .filter((value) => value != null)
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term.toLowerCase()));
}

function actionCheckSearchValues(row: ActionCheckSummary): Array<string | number | null | undefined> {
  return [
    row.name,
    row.branch,
    row.prNumber,
    row.prTitle,
    row.description,
    row.commitSha,
    row.status,
    row.conclusion,
    row.kind,
    row.repoFullName
  ];
}

function workflowRunSearchValues(row: WorkflowRunSummary): Array<string | number | null | undefined> {
  return [
    row.workflowName,
    row.displayTitle,
    row.runNumber,
    row.event,
    row.status,
    row.conclusion,
    row.headBranch,
    row.headSha,
    row.actorLogin,
    row.path,
    row.repoFullName
  ];
}

function normalizeActionStatus(value: string): ActionQueryStatus {
  const normalized = normalizeActionValue(value);
  if (normalized === "all" || normalized === "any") return "all";
  if (normalized === "success" || normalized === "passed" || normalized === "pass") return "passing";
  if (normalized === "failure" || normalized === "failed" || normalized === "fail" || normalized === "error") return "failing";
  if (normalized === "queued" || normalized === "running" || normalized === "in-progress" || normalized === "in_progress") return "pending";
  if (normalized === "passing" || normalized === "failing" || normalized === "pending" || normalized === "unknown") return normalized;
  return "unknown";
}

function normalizeActionValue(value: string): string {
  return value.replace(/^@/, "").replaceAll("_", "-").toLowerCase();
}

function tokenizeActionsQuery(query: string): string[] {
  const tokens: string[] = [];
  const matcher = /(?:[^\s"']+:"[^"]*"|[^\s"']+:'[^']*'|"[^"]*"|'[^']*'|\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(query))) tokens.push(match[0] ?? "");
  return tokens.filter(Boolean);
}

function stripActionsQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "").replace(/(:)["'](.*)["']$/, "$1$2");
}
