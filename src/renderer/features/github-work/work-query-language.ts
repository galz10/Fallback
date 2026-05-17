import type { IssueSummary, PullRequestSummary } from "../../../shared/domain/github-work";
import type { AttentionItem } from "../../../shared/attention";

export type EntityQueryKind = "pr" | "issue";

export interface QuerySuggestion {
  value: string;
  description: string;
}

export interface FilterSuggestionOptions {
  issueTypes?: string[];
  issueFieldOptions?: Record<string, string[]>;
}

export interface WorkQuery {
  text: string[];
  priorities: string[];
  groups: string[];
  reasons: string[];
  repos: string[];
  types: string[];
  lanes: string[];
}

const dateFilterKeys = new Set([
  "created",
  "creation-date",
  "created-date",
  "updated",
  "update-date",
  "updated-date",
  "closed",
  "closed-date",
  "merged",
  "merged-date",
  "start-date",
  "target-date"
]);
const countFilterKeys = new Set(["comment-count", "interaction-count", "reaction-count"]);
const metadataOnlyFilterKeys = new Set([
  "field",
  "project",
  "effort",
  "priority",
  "start-date",
  "target-date",
  "milestone",
  "parent-issue",
  "blocking",
  "blocked-by",
  "sub-issue",
  "commenter",
  "closed-reason",
  "linked",
  "archived",
  "language",
  "coding-language",
  "team",
  "team-review-requested"
]);

export function buildFilterSuggestions(
  query: string,
  items: Array<IssueSummary | PullRequestSummary>,
  login: string | undefined,
  kinds: EntityQueryKind[],
  options: FilterSuggestionOptions = {}
): QuerySuggestion[] {
  const token = currentQueryToken(query);
  const negative = token.startsWith("-") && token.length > 0;
  const suggestionToken = negative ? token.slice(1) : token;
  const formatSuggestions = (suggestions: QuerySuggestion[]) =>
    negative
      ? suggestions.map((suggestion) => ({
          ...suggestion,
          value: `-${suggestion.value}`,
          description: `Exclude ${suggestion.description.toLowerCase()}`
        }))
      : suggestions;
  const qualifierMatch = suggestionToken.match(/^([a-z-]+):(.*)$/i);
  if (!qualifierMatch) {
    const suggestions = filterSuggestions(entityFilterQualifierSuggestions(kinds, negative), suggestionToken);
    return formatSuggestions(suggestions);
  }

  const key = qualifierMatch[1]!.toLowerCase();
  const typed = qualifierMatch[2] ?? "";
  if (key === "is" || key === "state") return formatSuggestions(filterSuggestions(stateSuggestions(kinds, key), typed));
  if (key === "type") return formatSuggestions(filterSuggestions(entityTypeSuggestions(kinds, key, items, options), typed));
  if (key === "author" || key === "user") return formatSuggestions(filterSuggestions(personSuggestions("author", items, login), typed));
  if (key === "assignee" || key === "assigned")
    return formatSuggestions(filterSuggestions(personSuggestions("assignee", items, login), typed));
  if (key === "review-requested" || key === "user-review-requested")
    return formatSuggestions(filterSuggestions(personSuggestions("reviewer", items, login, key), typed));
  if (key === "mentions" || key === "involves")
    return formatSuggestions(filterSuggestions(personSuggestions("involved", items, login, key), typed));
  if (key === "label" || key === "labels")
    return formatSuggestions(filterSuggestions(valueSuggestions(key, uniqueValues(items.flatMap((item) => item.labels))), typed));
  if (key === "repo" || key === "repository") {
    return formatSuggestions(
      filterSuggestions(valueSuggestions(key, uniqueValues(items.map((item) => item.repoFullName).filter(Boolean) as string[])), typed)
    );
  }
  if (key === "base")
    return formatSuggestions(
      filterSuggestions(valueSuggestions(key, uniqueValues(pullRequestItems(items).map((item) => item.baseBranch))), typed)
    );
  if (key === "head")
    return formatSuggestions(
      filterSuggestions(valueSuggestions(key, uniqueValues(pullRequestItems(items).map((item) => item.headBranch))), typed)
    );
  if (key === "commit-sha" || key === "commit" || key === "sha")
    return formatSuggestions(
      filterSuggestions(valueSuggestions(key, uniqueValues(pullRequestItems(items).flatMap((item) => [item.headSha, item.baseSha]))), typed)
    );
  if (key === "status")
    return formatSuggestions(
      filterSuggestions(
        ["passing", "failing", "pending", "unknown"].map((value) => ({ value: `${key}:${value}`, description: "Checks" })),
        typed
      )
    );
  if (key === "review" || key === "review-state")
    return formatSuggestions(
      filterSuggestions(valueSuggestions(key, uniqueValues(pullRequestItems(items).map((item) => item.reviewState))), typed)
    );
  if (key === "draft")
    return formatSuggestions(
      filterSuggestions(
        ["true", "false"].map((value) => ({ value: `${key}:${value}`, description: "Draft" })),
        typed
      )
    );
  if (dateFilterKeys.has(key)) return formatSuggestions(filterSuggestions(dateSuggestions(key), typed));
  if (countFilterKeys.has(key)) return formatSuggestions(filterSuggestions(countSuggestions(key), typed));
  if (key === "in")
    return formatSuggestions(
      filterSuggestions(
        ["title", "body", "comments", "label", "author", "base", "head"].map((value) => ({
          value: `${key}:${value}`,
          description: "Field"
        })),
        typed
      )
    );
  if (metadataOnlyFilterKeys.has(key)) return formatSuggestions(filterSuggestions(metadataSuggestions(key, items, options), typed));
  if (key === "reviewed-by") return formatSuggestions(filterSuggestions(personSuggestions("reviewer", items, login, key), typed));
  if (key === "sort") return formatSuggestions(filterSuggestions(sortSuggestions(key), typed));
  return [];
}

function entityFilterQualifierSuggestions(kinds: EntityQueryKind[], excluding: boolean): QuerySuggestion[] {
  const includePullRequestFilters = kinds.includes("pr");
  return [
    { value: "is:", description: "Type or state" },
    { value: "state:", description: "Open, closed, merged" },
    { value: "label:", description: "Label" },
    { value: "field:", description: "Project field" },
    { value: "project:", description: "Project" },
    { value: "assignee:", description: "Assigned to" },
    { value: "author:", description: "Created by" },
    { value: "type:", description: "Issue or PR" },
    { value: "effort:", description: "Effort metadata" },
    { value: "priority:", description: "Priority metadata" },
    { value: "start-date:", description: "Start date" },
    { value: "target-date:", description: "Target date" },
    { value: "milestone:", description: "Milestone" },
    { value: "involves:", description: "Author, assignee, reviewer, mention" },
    { value: "mentions:", description: "Mentions user" },
    { value: "parent-issue:", description: "Parent issue" },
    { value: "blocking:", description: "Blocking issue" },
    { value: "blocked-by:", description: "Blocked by issue" },
    { value: "sub-issue:", description: "Sub-issue" },
    { value: "updated:", description: "Updated date" },
    { value: "created:", description: "Created date" },
    { value: "closed:", description: "Closed date" },
    ...(includePullRequestFilters ? [{ value: "merged:", description: "Merged date" }] : []),
    ...(includePullRequestFilters ? [{ value: "review-requested:", description: "Reviewer requested" }] : []),
    { value: "in:", description: "Title, body, comments" },
    { value: "commenter:", description: "Comment author" },
    { value: "user:", description: "Author alias" },
    ...(includePullRequestFilters ? [{ value: "user-review-requested:", description: "User review requested" }] : []),
    ...(includePullRequestFilters ? [{ value: "reviewed-by:", description: "Reviewed by" }] : []),
    { value: "comment-count:", description: "Comment count" },
    { value: "interaction-count:", description: "Interaction count" },
    { value: "closed-reason:", description: "Closed reason" },
    { value: "linked:", description: "Linked issue or PR" },
    { value: "archived:", description: "Archived" },
    { value: "reaction-count:", description: "Reaction count" },
    ...(includePullRequestFilters ? [{ value: "draft:", description: "Draft PR" }] : []),
    ...(includePullRequestFilters ? [{ value: "review-state:", description: "Review state" }] : []),
    { value: "language:", description: "Coding language" },
    ...(includePullRequestFilters ? [{ value: "commit-sha:", description: "Commit SHA" }] : []),
    ...(includePullRequestFilters ? [{ value: "base:", description: "Base branch or SHA" }] : []),
    ...(includePullRequestFilters ? [{ value: "head:", description: "Head branch or SHA" }] : []),
    ...(includePullRequestFilters ? [{ value: "status:", description: "Checks status" }] : []),
    { value: "team:", description: "Team" },
    ...(includePullRequestFilters ? [{ value: "team-review-requested:", description: "Team review requested" }] : []),
    { value: "sort:", description: "Sort order" },
    { value: "repo:", description: "Repository" },
    { value: "AND", description: "Default between filters" },
    { value: "OR", description: "Boolean operator" },
    ...(excluding ? [] : [{ value: "-", description: "Exclude a filter" }])
  ];
}

function stateSuggestions(kinds: EntityQueryKind[], key: string): QuerySuggestion[] {
  const values: string[] = key === "is" ? kinds.map((kind) => (kind === "pr" ? "pr" : "issue")) : [];
  values.push("open", "closed", "all");
  if (kinds.includes("pr")) values.push("merged", "draft");
  return uniqueValues(values).map((value) => ({
    value: `${key}:${value}`,
    description: value === "pr" ? "Pull requests" : value === "issue" ? "Issues" : "State"
  }));
}

function typeSuggestions(kinds: EntityQueryKind[], key: string): QuerySuggestion[] {
  return kinds.map((kind) => ({
    value: `${key}:${kind}`,
    description: kind === "pr" ? "Pull requests" : "Issues"
  }));
}

function entityTypeSuggestions(
  kinds: EntityQueryKind[],
  key: string,
  items: Array<IssueSummary | PullRequestSummary>,
  options: FilterSuggestionOptions
): QuerySuggestion[] {
  const issueTypes = kinds.includes("issue") ? issueTypeSuggestions(key, items, options) : [];
  if (kinds.length === 1 && kinds[0] === "issue" && issueTypes.length > 0) return issueTypes;
  return [...typeSuggestions(kinds, key), ...issueTypes];
}

function issueTypeSuggestions(
  key: string,
  items: Array<IssueSummary | PullRequestSummary>,
  options: FilterSuggestionOptions
): QuerySuggestion[] {
  return uniqueValues([...(options.issueTypes ?? []), ...issueItems(items).map((item) => item.issueTypeName)]).map((value) => ({
    value: `${key}:${quoteQueryValue(value)}`,
    description: "Issue type"
  }));
}

function personSuggestions(
  key: "author" | "assignee" | "reviewer" | "involved",
  items: Array<IssueSummary | PullRequestSummary>,
  login: string | undefined,
  outputKey: string = key
): QuerySuggestion[] {
  const values =
    key === "author"
      ? uniqueValues(items.map((item) => item.authorLogin))
      : key === "reviewer"
        ? uniqueValues(pullRequestItems(items).flatMap((item) => item.requestedReviewerLogins))
        : key === "involved"
          ? uniqueValues([
              ...items.map((item) => item.authorLogin),
              ...items.flatMap((item) => item.assigneeLogins),
              ...pullRequestItems(items).flatMap((item) => item.requestedReviewerLogins)
            ])
          : uniqueValues(items.flatMap((item) => item.assigneeLogins));
  const description = key === "author" ? "Author" : key === "reviewer" ? "Reviewer" : key === "involved" ? "Person" : "Assignee";
  return [
    ...(login ? [{ value: `${outputKey}:@me`, description: login }] : []),
    ...values
      .filter((value) => value.toLowerCase() !== login?.toLowerCase())
      .map((value) => ({ value: `${outputKey}:${value}`, description }))
  ];
}

function pullRequestItems(items: Array<IssueSummary | PullRequestSummary>): PullRequestSummary[] {
  return items.filter((item): item is PullRequestSummary => "headBranch" in item);
}

function issueItems(items: Array<IssueSummary | PullRequestSummary>): IssueSummary[] {
  return items.filter((item): item is IssueSummary => !("headBranch" in item));
}

function dateSuggestions(key: string): QuerySuggestion[] {
  return ["1/1/26", ">=1/1/26", "<=12/31/26", "1/1/26..12/31/26"].map((value) => ({ value: `${key}:${value}`, description: "Date" }));
}

function countSuggestions(key: string): QuerySuggestion[] {
  return ["0", ">0", ">=5", "<10"].map((value) => ({ value: `${key}:${value}`, description: "Count" }));
}

function metadataSuggestions(
  key: string,
  items: Array<IssueSummary | PullRequestSummary>,
  options: FilterSuggestionOptions
): QuerySuggestion[] {
  if (key === "archived" || key === "linked") return booleanSuggestions(key, labelForMetadataKey(key));
  if (key === "closed-reason") {
    return ["completed", "not_planned"].map((value) => ({ value: `${key}:${value}`, description: "Closed reason" }));
  }
  if (key === "priority" || key === "effort") {
    const fieldOptions = options.issueFieldOptions?.[key] ?? defaultIssueFieldOptions(key);
    return valueSuggestions(key, fieldOptions);
  }
  if (key === "language" || key === "coding-language") {
    return valueSuggestions(
      key,
      uniqueValues([...items.flatMap((item) => item.labels), ...pullRequestItems(items).map((item) => item.baseBranch)])
    );
  }
  if (key === "team" || key === "team-review-requested") {
    return valueSuggestions(
      key,
      uniqueValues([...pullRequestItems(items).flatMap((item) => item.requestedReviewerLogins), ...items.flatMap((item) => item.labels)])
    );
  }
  if (key === "commenter") return valueSuggestions(key, uniqueValues(items.map((item) => item.authorLogin)));
  if (key === "parent-issue" || key === "blocking" || key === "blocked-by" || key === "sub-issue") {
    return items.map((item) => ({ value: `${key}:${item.number}`, description: labelForMetadataKey(key) }));
  }
  return valueSuggestions(key, uniqueValues(items.flatMap((item) => item.labels)));
}

function booleanSuggestions(key: string, description: string): QuerySuggestion[] {
  return ["true", "false"].map((value) => ({ value: `${key}:${value}`, description }));
}

function defaultIssueFieldOptions(key: "priority" | "effort"): string[] {
  if (key === "priority") return ["P0", "P1", "P2", "P3", "P4"];
  return ["XS", "S", "M", "L", "XL"];
}

function sortSuggestions(key: string): QuerySuggestion[] {
  return ["updated-desc", "updated-asc", "created-desc", "created-asc", "comments-desc", "comments-asc"].map((value) => ({
    value: `${key}:${value}`,
    description: "Sort order"
  }));
}

function valueSuggestions(key: string, values: string[]): QuerySuggestion[] {
  return values.map((value) => ({
    value: `${key}:${quoteQueryValue(value)}`,
    description: key === "repo" || key === "repository" ? "Repository" : labelForMetadataKey(key)
  }));
}

function labelForMetadataKey(key: string): string {
  if (key === "field") return "Project field";
  if (key === "project") return "Project";
  if (key === "effort") return "Effort";
  if (key === "priority") return "Priority";
  if (key === "milestone") return "Milestone";
  if (key === "parent-issue") return "Parent issue";
  if (key === "blocking") return "Blocking issue";
  if (key === "blocked-by") return "Blocked by issue";
  if (key === "sub-issue") return "Sub-issue";
  if (key === "commenter") return "Comment author";
  if (key === "closed-reason") return "Closed reason";
  if (key === "linked") return "Linked";
  if (key === "archived") return "Archived";
  if (key === "language" || key === "coding-language") return "Coding language";
  if (key === "team") return "Team";
  if (key === "team-review-requested") return "Team review requested";
  return "Label";
}

function filterSuggestions(suggestions: QuerySuggestion[], typed: string): QuerySuggestion[] {
  const needle = typed.replace(/^@/, "").toLowerCase();
  return suggestions.filter((suggestion) => suggestion.value.toLowerCase().includes(needle));
}

export function buildWorkFilterSuggestions(query: string, items: AttentionItem[]): QuerySuggestion[] {
  const token = currentQueryToken(query);
  const qualifierMatch = token.match(/^([a-z-]+):(.*)$/i);
  if (!qualifierMatch) {
    return filterSuggestions(
      [
        { value: "priority:", description: "P0-P4" },
        { value: "reason:", description: "Why it needs you" },
        { value: "repo:", description: "Repository" },
        { value: "type:", description: "PR, issue, check" },
        { value: "lane:", description: "Needs me, waiting..." },
        { value: "is:", description: "Blocking, actionable" }
      ],
      token
    );
  }

  const key = qualifierMatch[1]!.toLowerCase();
  const typed = qualifierMatch[2] ?? "";
  if (key === "priority" || key === "p") {
    return filterSuggestions(
      ["P0", "P1", "P2", "P3", "P4"].map((priority) => ({ value: `${key}:${priority}`, description: "Priority" })),
      typed
    );
  }
  if (key === "group") return filterSuggestions(workGroupSuggestions(key), typed);
  if (key === "reason" || key === "why")
    return filterSuggestions(valueSuggestions(key, uniqueValues(items.map((item) => item.reasonLabel || item.reason))), typed);
  if (key === "repo" || key === "repository")
    return filterSuggestions(
      valueSuggestions(key, uniqueValues(items.map((item) => item.repoFullName).filter(Boolean) as string[])),
      typed
    );
  if (key === "type" || key === "is") {
    const typeSuggestions = [
      { value: `${key}:pr`, description: "Pull requests" },
      { value: `${key}:issue`, description: "Issues" },
      { value: `${key}:check`, description: "Checks" },
      { value: `${key}:blocking`, description: "Blocking" },
      { value: `${key}:actionable`, description: "Needs action" },
      { value: `${key}:done`, description: "Done" },
      { value: `${key}:snoozed`, description: "Snoozed" }
    ];
    return filterSuggestions(typeSuggestions, typed);
  }
  if (key === "lane" || key === "status")
    return filterSuggestions(
      uniqueValues(items.map((item) => item.lane)).map((laneValue) => ({
        value: `${key}:${laneValue}`,
        description: "Lane"
      })),
      typed
    );
  return [];
}

function workGroupSuggestions(key: string): QuerySuggestion[] {
  return Object.values(workPriorityGroups).map((group) => ({
    value: `${key}:${group.id}`,
    description: group.priorityLabel ? `${group.priorityLabel} ${group.label}` : group.label
  }));
}

export function parseWorkQuery(query: string): WorkQuery {
  const parsed: WorkQuery = {
    text: [],
    priorities: [],
    groups: [],
    reasons: [],
    repos: [],
    types: [],
    lanes: []
  };

  for (const token of tokenizeSearchQuery(query)) {
    const match = token.match(/^([a-z-]+):(.*)$/i);
    if (!match) {
      parsed.text.push(stripSearchQuotes(token));
      continue;
    }

    const key = match[1]!.toLowerCase();
    const value = stripSearchQuotes(match[2] ?? "");
    if (!value) continue;

    if (key === "priority" || key === "p") parsed.priorities.push(value);
    else if (key === "group") parsed.groups.push(value);
    else if (key === "reason" || key === "why") parsed.reasons.push(value);
    else if (key === "repo" || key === "repository") parsed.repos.push(value);
    else if (key === "type" || key === "is") parsed.types.push(value);
    else if (key === "lane" || key === "status") parsed.lanes.push(value);
    else parsed.text.push(stripSearchQuotes(token));
  }

  return parsed;
}

export function matchesWorkQuery(item: AttentionItem, query: WorkQuery): boolean {
  const group = workPriorityGroupFor(item);
  return (
    matchesAny(query.priorities, (value) => matchesLoose(group.priorityLabel, value)) &&
    matchesAny(query.groups, (value) => matchesLoose(`${group.id} ${group.label}`, value)) &&
    matchesAny(query.reasons, (value) => matchesLoose(`${item.reason} ${item.reasonLabel} ${item.why}`, value)) &&
    matchesAny(query.repos, (value) => matchesLoose(item.repoFullName ?? "", value)) &&
    matchesAny(query.types, (value) => matchesWorkType(item, value)) &&
    matchesAny(query.lanes, (value) => matchesLoose(item.lane, value)) &&
    matchesWorkText(item, query.text)
  );
}

function matchesWorkType(item: AttentionItem, value: string): boolean {
  const normalized = normalizeSearchValue(value);
  if (normalized === "pr" || normalized === "pull-request" || normalized === "pull_request") return item.entityType === "pull_request";
  if (normalized === "issue") return item.entityType === "issue";
  if (normalized === "check" || normalized === "checks") return item.entityType === "check" || item.reason === "checks_failing";
  if (normalized === "blocking") return item.blocking;
  if (normalized === "actionable" || normalized === "needs-action") return item.actionable;
  if (normalized === "done") return Boolean(item.doneAt || item.lane === "done");
  if (normalized === "snoozed") return Boolean(item.snoozedUntil || item.lane === "snoozed");
  return matchesLoose(item.entityType, value);
}

function matchesWorkText(item: AttentionItem, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = [
    item.title,
    item.repoFullName,
    item.reason,
    item.reasonLabel,
    item.why,
    item.whatChanged,
    item.whyRelevant,
    item.suggestedAction,
    item.urgency,
    item.lane,
    item.number,
    item.latestMeaningfulEvent?.label,
    item.latestMeaningfulEvent?.preview,
    item.actorLogin
  ]
    .filter((value) => value != null)
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term.toLowerCase()));
}

function matchesAny(values: string[], predicate: (value: string) => boolean): boolean {
  return values.length === 0 || values.some(predicate);
}

function matchesLoose(value: string, filter: string): boolean {
  return normalizeSearchValue(value).includes(normalizeSearchValue(filter));
}

function normalizeSearchValue(value: string): string {
  return value.replace(/^@/, "").replaceAll("_", "-").toLowerCase();
}

function tokenizeSearchQuery(query: string): string[] {
  const tokens: string[] = [];
  const matcher = /(?:[^\s"']+:"[^"]*"|[^\s"']+:'[^']*'|"[^"]*"|'[^']*'|\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(query))) tokens.push(match[0] ?? "");
  return tokens.filter(Boolean);
}

function stripSearchQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "").replace(/(:)["'](.*)["']$/, "$1$2");
}

function currentQueryToken(query: string): string {
  const match = query.match(/\S+$/);
  return match ? match[0] : "";
}

export function applyQuerySuggestion(query: string, suggestion: string): string {
  const match = query.match(/\S+$/);
  const start = match?.index ?? query.length;
  const prefix = query.slice(0, start);
  return `${prefix}${suggestion}${suggestion.endsWith(":") ? "" : " "}`;
}

function quoteQueryValue(value: string): string {
  return /\s/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

function uniqueValues(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
}

export type WorkPriorityGroupId =
  | "blocking_merge"
  | "requested_reviews"
  | "mentions"
  | "stale"
  | "low_priority"
  | "snoozed"
  | "muted"
  | "done";

export interface WorkPriorityGroup {
  id: WorkPriorityGroupId;
  label: string;
  priorityLabel: string;
  rank: number;
}

export interface WorkAttentionDisplay {
  label: string;
  primaryAction: string;
}

export const workPriorityGroups: Record<WorkPriorityGroupId, WorkPriorityGroup> = {
  blocking_merge: {
    id: "blocking_merge",
    label: "Blocking Merge",
    priorityLabel: "P0",
    rank: 0
  },
  requested_reviews: {
    id: "requested_reviews",
    label: "Requested Reviews",
    priorityLabel: "P1",
    rank: 1
  },
  mentions: {
    id: "mentions",
    label: "Mentions",
    priorityLabel: "P2",
    rank: 2
  },
  stale: {
    id: "stale",
    label: "Stale",
    priorityLabel: "P3",
    rank: 3
  },
  low_priority: {
    id: "low_priority",
    label: "Lower Priority",
    priorityLabel: "P4",
    rank: 4
  },
  snoozed: {
    id: "snoozed",
    label: "Snoozed",
    priorityLabel: "",
    rank: 5
  },
  muted: {
    id: "muted",
    label: "Muted",
    priorityLabel: "",
    rank: 6
  },
  done: {
    id: "done",
    label: "Done",
    priorityLabel: "",
    rank: 7
  }
};

export function workPriorityGroupFor(item: AttentionItem): WorkPriorityGroup {
  if (item.doneAt || item.lane === "done") return workPriorityGroups.done;
  if (item.muted || item.lane === "muted") return workPriorityGroups.muted;
  if (item.snoozedUntil || item.lane === "snoozed") return workPriorityGroups.snoozed;
  if (item.reason === "checks_failing" || item.reason === "changes_requested" || (item.blocking && item.reason === "priority_label")) {
    return workPriorityGroups.blocking_merge;
  }
  if (item.reason === "explicit_review_request" || item.reason === "team_review_unclaimed") return workPriorityGroups.requested_reviews;
  if (item.reason === "direct_mention" || item.reason === "human_reply") return workPriorityGroups.mentions;
  if (isStaleWorkItem(item)) return workPriorityGroups.stale;
  return workPriorityGroups.low_priority;
}

export function workAttentionDisplay(item: AttentionItem): WorkAttentionDisplay {
  if (item.doneAt || item.lane === "done") {
    return {
      label: "Marked done",
      primaryAction: "Open"
    };
  }
  if (item.snoozedUntil || item.lane === "snoozed") {
    return {
      label: "Snoozed",
      primaryAction: "Open"
    };
  }
  if (item.muted || item.lane === "muted") {
    return {
      label: "Muted",
      primaryAction: "Open"
    };
  }

  switch (item.reason) {
    case "explicit_review_request":
      return {
        label: "Review requested",
        primaryAction: "Review"
      };
    case "team_review_unclaimed":
      return {
        label: "Team review",
        primaryAction: "Review"
      };
    case "assigned_to_you":
      return {
        label: "Assigned to you",
        primaryAction: item.entityType === "pull_request" ? "Resolve" : "Open"
      };
    case "direct_mention":
      return {
        label: "Mentioned you",
        primaryAction: "Reply"
      };
    case "human_reply":
      return {
        label: "Waiting on your response",
        primaryAction: "Reply"
      };
    case "checks_failing":
      return {
        label: "CI failed after your change",
        primaryAction: "Resolve"
      };
    case "changes_requested":
      return {
        label: "Changes requested",
        primaryAction: "Resolve"
      };
    case "authored_waiting_review":
      return {
        label: "Waiting on review",
        primaryAction: "Open"
      };
    case "reviewed_waiting_author":
      return {
        label: "Waiting on author",
        primaryAction: "Open"
      };
    case "new_commits_after_review":
      return {
        label: "New commits after review",
        primaryAction: "Review"
      };
    case "review_draft_pending":
      return {
        label: "Draft pending",
        primaryAction: "Resume"
      };
    case "priority_label":
      return {
        label: "Priority work",
        primaryAction: "Resolve"
      };
    default:
      return {
        label: item.reasonLabel || "Recent activity",
        primaryAction: "Open"
      };
  }
}

export function groupWorkRows(items: AttentionItem[]): Array<{ group: WorkPriorityGroup; rows: AttentionItem[] }> {
  const sections = new Map<WorkPriorityGroupId, AttentionItem[]>();
  for (const item of items) {
    const group = workPriorityGroupFor(item);
    sections.set(group.id, [...(sections.get(group.id) ?? []), item]);
  }
  return Array.from(sections.entries())
    .map(([id, rows]) => ({ group: workPriorityGroups[id], rows }))
    .sort((a, b) => a.group.rank - b.group.rank);
}

export function compareWorkItems(a: AttentionItem, b: AttentionItem): number {
  const groupDelta = workPriorityGroupFor(a).rank - workPriorityGroupFor(b).rank;
  if (groupDelta !== 0) return groupDelta;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return timestampValue(b.updatedAt) - timestampValue(a.updatedAt);
}

function isStaleWorkItem(item: AttentionItem): boolean {
  const value = timestampValue(item.updatedAt);
  return Boolean(value && Date.now() - value > 7 * 24 * 60 * 60 * 1000);
}

function timestampValue(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
