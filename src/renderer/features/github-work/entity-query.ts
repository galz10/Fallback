import type { IssueSummary, PullRequestSummary } from "../../../shared/domain/github-work";

type EntityQueryKind = "pr" | "issue";
const metadataSearchKeys = new Set([
  "field",
  "project",
  "effort",
  "priority",
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

function byUpdatedDesc(a: { updatedAt: string | null }, b: { updatedAt: string | null }): number {
  return timestamp(b.updatedAt) - timestamp(a.updatedAt);
}

function timestamp(value: string | null): number {
  return value ? Date.parse(value) : 0;
}

function mentionsUser(body: string | null, login?: string): boolean {
  return Boolean(login && body?.toLowerCase().includes(`@${login.toLowerCase()}`));
}

export function filterPullRequests(prs: PullRequestSummary[], query: string, login?: string): PullRequestSummary[] {
  const parsed = parseEntityQuery(query);
  if (parsed.kind === "issue") return [];
  return prs.filter((pr) => matchesPullRequestQuery(pr, parsed, login)).sort(byUpdatedDesc);
}

export function filterIssues(issues: IssueSummary[], query: string, login?: string): IssueSummary[] {
  const parsed = parseEntityQuery(query);
  if (parsed.kind === "pr") return [];
  return issues.filter((issue) => matchesIssueQuery(issue, parsed, login)).sort(byUpdatedDesc);
}

interface ParsedEntityQuery {
  kind: EntityQueryKind | null;
  states: string[];
  authors: string[];
  assignees: string[];
  reviewers: string[];
  involved: string[];
  mentions: string[];
  labels: string[];
  issueTypes: string[];
  repos: string[];
  baseRefs: string[];
  headRefs: string[];
  shas: string[];
  statuses: string[];
  reviewStates: string[];
  dateFilters: Array<{ field: "created" | "updated" | "closed" | "merged"; value: string }>;
  numberFilters: Array<{ field: "comments" | "interactions" | "reactions"; value: string }>;
  metadataTerms: string[];
  inFields: string[];
  text: string[];
  excludes: ParsedEntityQuery[];
}

export function parseEntityQuery(query: string): ParsedEntityQuery {
  const parsed = emptyEntityQuery();

  for (const token of tokenizeQuery(query)) {
    const negative = token.startsWith("-") && token.length > 1;
    if (negative) {
      const excluded = emptyEntityQuery();
      applyEntityQueryToken(excluded, token.slice(1));
      if (entityQueryHasTerms(excluded)) parsed.excludes.push(excluded);
      continue;
    }

    applyEntityQueryToken(parsed, token);
  }

  return parsed;
}

function emptyEntityQuery(): ParsedEntityQuery {
  const parsed: ParsedEntityQuery = {
    kind: null,
    states: [],
    authors: [],
    assignees: [],
    reviewers: [],
    involved: [],
    mentions: [],
    labels: [],
    issueTypes: [],
    repos: [],
    baseRefs: [],
    headRefs: [],
    shas: [],
    statuses: [],
    reviewStates: [],
    dateFilters: [],
    numberFilters: [],
    metadataTerms: [],
    inFields: [],
    text: [],
    excludes: []
  };
  return parsed;
}

function applyEntityQueryToken(parsed: ParsedEntityQuery, token: string): void {
  const match = token.match(/^([a-z-]+):(.*)$/i);
  if (!match) {
    parsed.text.push(stripQueryQuotes(token));
    return;
  }

  const key = match[1]!.toLowerCase();
  const value = stripQueryQuotes(match[2] ?? "");
  const normalized = value.toLowerCase();

  if (!value && key !== "draft" && key !== "archived" && key !== "linked") return;

  if (key === "is" || key === "type" || key === "state") {
    if (normalized === "pr" || normalized === "pull-request") parsed.kind = "pr";
    else if (normalized === "issue") parsed.kind = "issue";
    else if ((key === "is" || key === "state") && normalized) parsed.states.push(normalized);
    else if (key === "type" && value) parsed.issueTypes.push(value);
    return;
  }

  if (key === "author" || key === "user") {
    if (value) parsed.authors.push(value);
    return;
  }

  if (key === "assignee" || key === "assigned") {
    if (value) parsed.assignees.push(value);
    return;
  }

  if (key === "review-requested" || key === "user-review-requested") {
    if (value) parsed.reviewers.push(value);
    return;
  }

  if (key === "reviewed-by") {
    if (value) parsed.metadataTerms.push(value);
    return;
  }

  if (key === "involves") {
    if (value) parsed.involved.push(value);
    return;
  }

  if (key === "label" || key === "labels") {
    if (value) parsed.labels.push(value);
    return;
  }

  if (key === "repo" || key === "repository") {
    if (value) parsed.repos.push(value);
    return;
  }

  if (key === "mentions") {
    if (value) parsed.mentions.push(value);
    return;
  }

  if (key === "base") {
    if (value) parsed.baseRefs.push(value);
    return;
  }

  if (key === "head") {
    if (value) parsed.headRefs.push(value);
    return;
  }

  if (key === "commit" || key === "commit-sha" || key === "sha") {
    if (value) parsed.shas.push(value);
    return;
  }

  if (key === "status") {
    if (value) parsed.statuses.push(value);
    return;
  }

  if (key === "review" || key === "review-state") {
    if (value) parsed.reviewStates.push(value);
    return;
  }

  if (key === "draft") {
    parsed.states.push(value ? `draft:${normalized}` : "draft");
    return;
  }

  if (key === "created" || key === "creation-date" || key === "created-date") {
    if (value) parsed.dateFilters.push({ field: "created", value });
    return;
  }

  if (key === "start-date") {
    if (value) parsed.dateFilters.push({ field: "created", value });
    return;
  }

  if (key === "updated" || key === "update-date" || key === "updated-date") {
    if (value) parsed.dateFilters.push({ field: "updated", value });
    return;
  }

  if (key === "closed" || key === "closed-date") {
    if (value) parsed.dateFilters.push({ field: "closed", value });
    return;
  }

  if (key === "merged" || key === "merged-date") {
    if (value) parsed.dateFilters.push({ field: "merged", value });
    return;
  }

  if (key === "comment-count") {
    if (value) parsed.numberFilters.push({ field: "comments", value });
    return;
  }

  if (key === "interaction-count") {
    if (value) parsed.numberFilters.push({ field: "interactions", value });
    return;
  }

  if (key === "reaction-count") {
    if (value) parsed.numberFilters.push({ field: "reactions", value });
    return;
  }

  if (key === "in") {
    if (value)
      parsed.inFields.push(
        ...value
          .split(",")
          .map((field) => field.trim().toLowerCase())
          .filter(Boolean)
      );
    return;
  }

  if (metadataSearchKeys.has(key)) {
    if (value) parsed.metadataTerms.push(value);
    return;
  }

  if (key !== "sort") parsed.text.push(stripQueryQuotes(token));
}

function entityQueryHasTerms(query: ParsedEntityQuery): boolean {
  return Boolean(
    query.kind ||
    query.states.length ||
    query.authors.length ||
    query.assignees.length ||
    query.reviewers.length ||
    query.involved.length ||
    query.mentions.length ||
    query.labels.length ||
    query.issueTypes.length ||
    query.repos.length ||
    query.baseRefs.length ||
    query.headRefs.length ||
    query.shas.length ||
    query.statuses.length ||
    query.reviewStates.length ||
    query.dateFilters.length ||
    query.numberFilters.length ||
    query.metadataTerms.length ||
    query.inFields.length ||
    query.text.length
  );
}

function matchesPullRequestQuery(pr: PullRequestSummary, query: ParsedEntityQuery, login?: string): boolean {
  if (query.kind === "issue") return false;
  const searchable = pullRequestSearchValues(pr);
  return (
    matchesStates(query.states, (state) => matchesPullRequestState(pr, state, login)) &&
    matchesPeople(query.authors, pr.authorLogin, login) &&
    query.assignees.every((assignee) => matchesPersonList(pr.assigneeLogins, assignee, login)) &&
    query.reviewers.every((reviewer) => matchesPersonList(pr.requestedReviewerLogins, reviewer, login)) &&
    query.involved.every((person) =>
      matchesInvolved(person, login, pr.authorLogin, pr.assigneeLogins, pr.requestedReviewerLogins, pr.body)
    ) &&
    query.mentions.every((person) => matchesMentionFilter(pr.body, person, login)) &&
    matchesLabels(pr.labels, query.labels) &&
    query.issueTypes.length === 0 &&
    matchesRepos(query.repos, pr.repoFullName) &&
    matchesLooseList(query.baseRefs, [pr.baseBranch, pr.baseSha]) &&
    matchesLooseList(query.headRefs, [pr.headBranch, pr.headSha]) &&
    matchesLooseList(query.shas, [pr.headSha, pr.baseSha]) &&
    matchesLooseList(query.statuses, [pr.checkState]) &&
    matchesLooseList(query.reviewStates, [pr.reviewState]) &&
    query.dateFilters.every((filter) => matchesDateFilter(prDateValue(pr, filter.field), filter.value)) &&
    query.numberFilters.every((filter) => matchesNumberFilter(prNumberValue(pr, filter.field), filter.value)) &&
    matchesFreeText(searchable, query.metadataTerms) &&
    matchesFreeText(valuesForInFields(searchable, query.inFields, pullRequestFieldValues(pr)), query.text) &&
    query.excludes.every((exclude) => !matchesPullRequestQuery(pr, exclude, login))
  );
}

function matchesIssueQuery(issue: IssueSummary, query: ParsedEntityQuery, login?: string): boolean {
  if (query.kind === "pr") return false;
  const searchable = issueSearchValues(issue);
  return (
    matchesStates(query.states, (state) => matchesIssueState(issue, state, login)) &&
    matchesPeople(query.authors, issue.authorLogin, login) &&
    query.assignees.every((assignee) => matchesPersonList(issue.assigneeLogins, assignee, login)) &&
    query.involved.every((person) => matchesInvolved(person, login, issue.authorLogin, issue.assigneeLogins, [], issue.body)) &&
    query.mentions.every((person) => matchesMentionFilter(issue.body, person, login)) &&
    matchesLabels(issue.labels, query.labels) &&
    matchesLooseList(query.issueTypes, [issue.issueTypeName]) &&
    matchesRepos(query.repos, issue.repoFullName) &&
    query.dateFilters.every((filter) => matchesDateFilter(issueDateValue(issue, filter.field), filter.value)) &&
    query.numberFilters.every((filter) => matchesNumberFilter(issueNumberValue(issue, filter.field), filter.value)) &&
    matchesFreeText(searchable, [
      ...query.metadataTerms,
      ...query.shas,
      ...query.statuses,
      ...query.reviewStates,
      ...query.baseRefs,
      ...query.headRefs
    ]) &&
    matchesFreeText(valuesForInFields(searchable, query.inFields, issueFieldValues(issue)), query.text) &&
    query.excludes.every((exclude) => !matchesIssueQuery(issue, exclude, login))
  );
}

function matchesPullRequestState(pr: PullRequestSummary, state: string, login?: string): boolean {
  if (state === "all") return true;
  if (state === "open" || state === "closed") return pr.state === state;
  if (state === "merged") return pr.merged;
  if (state === "draft") return pr.isDraft;
  if (state === "draft:true") return pr.isDraft;
  if (state === "draft:false") return !pr.isDraft;
  if (state === "review-requested" || state === "needs-review") return pr.state === "open" && !pr.isDraft && !pr.merged;
  if (state === "assigned") return matchesPersonList(pr.assigneeLogins, "@me", login);
  if (state === "mentioned") return mentionsUser(pr.body, login);
  return true;
}

function matchesIssueState(issue: IssueSummary, state: string, login?: string): boolean {
  if (state === "all") return true;
  if (state === "open" || state === "closed") return issue.state === state;
  if (state === "assigned") return matchesPersonList(issue.assigneeLogins, "@me", login);
  if (state === "mentioned") return mentionsUser(issue.body, login);
  return true;
}

function matchesStates(states: string[], predicate: (state: string) => boolean): boolean {
  return states.length === 0 || states.some(predicate);
}

function matchesPeople(filters: string[], value: string | null, login?: string): boolean {
  return filters.every((filter) => matchesPerson(value, filter, login));
}

function matchesPersonList(values: string[], filter: string, login?: string): boolean {
  const expected = resolvePersonFilter(filter, login);
  if (!expected) return false;
  return values.some((value) => matchesResolvedPerson(value, expected, isSelfPersonFilter(filter)));
}

function matchesPerson(value: string | null, filter: string, login?: string): boolean {
  const expected = resolvePersonFilter(filter, login);
  return Boolean(expected && value && matchesResolvedPerson(value, expected, isSelfPersonFilter(filter)));
}

function resolvePersonFilter(filter: string, login?: string): string | null {
  const normalized = filter.replace(/^@/, "").toLowerCase();
  if (normalized === "me") return login?.toLowerCase() ?? null;
  return normalized || null;
}

function isSelfPersonFilter(filter: string): boolean {
  return filter.replace(/^@/, "").toLowerCase() === "me";
}

function matchesResolvedPerson(value: string, expected: string, exact: boolean): boolean {
  const normalizedValue = value.toLowerCase();
  return exact ? normalizedValue === expected : normalizedValue.includes(expected);
}

function matchesLabels(values: string[], labels: string[]): boolean {
  const lowerValues = values.map((value) => value.toLowerCase());
  return labels.every((label) => lowerValues.includes(label.toLowerCase()));
}

function matchesRepos(filters: string[], repoFullName?: string | null): boolean {
  if (filters.length === 0) return true;
  const normalizedRepo = repoFullName?.toLowerCase() ?? "";
  return filters.every((filter) => normalizedRepo.includes(filter.toLowerCase()));
}

function matchesLooseList(filters: string[], values: Array<string | null | undefined>): boolean {
  return filters.every((filter) => values.some((value) => value?.toLowerCase().includes(filter.replace(/^@/, "").toLowerCase())));
}

function matchesInvolved(
  filter: string,
  login: string | undefined,
  author: string | null,
  assignees: string[],
  reviewers: string[],
  body: string | null
): boolean {
  return (
    matchesPerson(author, filter, login) ||
    matchesPersonList(assignees, filter, login) ||
    matchesPersonList(reviewers, filter, login) ||
    matchesMentionFilter(body, filter, login)
  );
}

function matchesMentionFilter(body: string | null, filter: string, login?: string): boolean {
  const expected = resolvePersonFilter(filter, login);
  return Boolean(expected && body?.toLowerCase().includes(`@${expected}`));
}

function matchesDateFilter(value: string | null, filter: string): boolean {
  const target = timestamp(value);
  if (!target) return false;
  const range = filter.split("..");
  if (range.length === 2) {
    const start = parseDateFilter(range[0]);
    const end = parseDateFilter(range[1]);
    return (!start || target >= start.start) && (!end || target <= end.end);
  }
  const operator = filter.match(/^(>=|<=|>|<)(.+)$/);
  if (operator) {
    const date = parseDateFilter(operator[2] ?? "");
    if (!date) return false;
    if (operator[1] === ">") return target > date.end;
    if (operator[1] === ">=") return target >= date.start;
    if (operator[1] === "<") return target < date.start;
    if (operator[1] === "<=") return target <= date.end;
  }
  const date = parseDateFilter(filter);
  return Boolean(date && target >= date.start && target <= date.end);
}

function parseDateFilter(value: string): { start: number; end: number } | null {
  const clean = value.trim();
  if (!clean) return null;
  const slash = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  const normalized = slash
    ? `${slash[3]!.length === 2 ? 2000 + Number(slash[3]) : Number(slash[3])}-${String(Number(slash[1])).padStart(2, "0")}-${String(Number(slash[2])).padStart(2, "0")}`
    : clean;
  const start = Date.parse(`${normalized}T00:00:00`);
  const end = Date.parse(`${normalized}T23:59:59`);
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
}

function matchesNumberFilter(value: number | null, filter: string): boolean {
  if (value == null) return false;
  const operator = filter.match(/^(>=|<=|>|<)(\d+)$/);
  if (operator) {
    const expected = Number(operator[2]);
    if (operator[1] === ">") return value > expected;
    if (operator[1] === ">=") return value >= expected;
    if (operator[1] === "<") return value < expected;
    if (operator[1] === "<=") return value <= expected;
  }
  const expected = Number(filter);
  return Number.isFinite(expected) ? value === expected : false;
}

function prDateValue(pr: PullRequestSummary, field: "created" | "updated" | "closed" | "merged"): string | null {
  if (field === "created") return pr.createdAt;
  if (field === "updated") return pr.updatedAt;
  if (field === "closed") return pr.closedAt;
  return pr.mergedAt;
}

function issueDateValue(issue: IssueSummary, field: "created" | "updated" | "closed" | "merged"): string | null {
  if (field === "created") return issue.createdAt;
  if (field === "updated") return issue.updatedAt;
  if (field === "closed") return issue.closedAt;
  return null;
}

function prNumberValue(pr: PullRequestSummary, field: "comments" | "interactions" | "reactions"): number | null {
  if (field === "comments") return (pr.commentsCount ?? 0) + (pr.reviewCommentsCount ?? 0);
  if (field === "interactions") return (pr.commentsCount ?? 0) + (pr.reviewCommentsCount ?? 0) + (pr.checkCount ?? 0);
  return null;
}

function issueNumberValue(issue: IssueSummary, field: "comments" | "interactions" | "reactions"): number | null {
  if (field === "comments" || field === "interactions") return issue.commentsCount;
  return null;
}

function pullRequestSearchValues(pr: PullRequestSummary): Array<string | number | null | undefined> {
  return [
    pr.title,
    pr.body,
    pr.repoFullName,
    pr.authorLogin,
    pr.number,
    pr.baseBranch,
    pr.headBranch,
    pr.baseSha,
    pr.headSha,
    pr.checkState,
    pr.reviewState,
    ...pr.assigneeLogins,
    ...pr.requestedReviewerLogins,
    ...pr.labels
  ];
}

function issueSearchValues(issue: IssueSummary): Array<string | number | null | undefined> {
  return [
    issue.title,
    issue.body,
    issue.repoFullName,
    issue.authorLogin,
    issue.number,
    issue.issueTypeName,
    ...issue.assigneeLogins,
    ...issue.labels
  ];
}

function pullRequestFieldValues(pr: PullRequestSummary): Record<string, Array<string | number | null | undefined>> {
  return {
    title: [pr.title],
    body: [pr.body],
    comments: [pr.body],
    number: [pr.number],
    branch: [pr.baseBranch, pr.headBranch],
    base: [pr.baseBranch, pr.baseSha],
    head: [pr.headBranch, pr.headSha],
    label: pr.labels,
    author: [pr.authorLogin]
  };
}

function issueFieldValues(issue: IssueSummary): Record<string, Array<string | number | null | undefined>> {
  return {
    title: [issue.title],
    body: [issue.body],
    comments: [issue.body],
    number: [issue.number],
    type: [issue.issueTypeName],
    label: issue.labels,
    author: [issue.authorLogin]
  };
}

function valuesForInFields(
  fallback: Array<string | number | null | undefined>,
  fields: string[],
  byField: Record<string, Array<string | number | null | undefined>>
): Array<string | number | null | undefined> {
  if (fields.length === 0) return fallback;
  return fields.flatMap((field) => byField[field] ?? []);
}

function matchesFreeText(values: Array<string | number | null | undefined>, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = values
    .filter((value) => value != null)
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term.toLowerCase()));
}

function tokenizeQuery(query: string): string[] {
  const tokens: string[] = [];
  const matcher = /(?:[^\s"']+:"[^"]*"|[^\s"']+:'[^']*'|"[^"]*"|'[^']*'|\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(query))) {
    tokens.push(match[0] ?? "");
  }
  return tokens.filter(Boolean);
}

function stripQueryQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "").replace(/(:)["'](.*)["']$/, "$1$2");
}

export function queryWithDefaultOpen(query: string): string {
  const parsed = parseEntityQuery(query);
  return parsed.states.length > 0 ? query : [query.trim(), "is:open"].filter(Boolean).join(" ");
}
