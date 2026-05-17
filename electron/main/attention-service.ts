import type { DatabaseService } from "./database-service.js";
import type { SettingsService } from "./settings-service.js";
import {
  attentionEntityId,
  attentionForIssue,
  attentionForPullRequest,
  isLikelyBotLogin,
  sortAttentionItems,
  type AttentionEntityType,
  type AttentionEventSummary,
  type AttentionItem,
  type AttentionListInput,
  type AttentionLocalState,
  type AttentionReviewDraftSummary,
  type AttentionSummary,
  type AttentionSurface,
  type AttentionUrgency,
  type NotificationEventRecord
} from "../../src/shared/attention.js";
import type { IssueSummary, PullRequestSummary } from "../../src/shared/domain/github-work.js";
import { nowIso } from "./path-utils.js";

export class AttentionService {
  private lastDerivedAllAt = 0;
  private derivingAll = false;
  private summaryRefreshScheduled = false;
  private cachedSummaries = new Map<string, { expiresAt: number; value: AttentionSummary }>();
  private cachedLists = new Map<string, { expiresAt: number; value: AttentionItem[] }>();

  constructor(
    private readonly database: DatabaseService,
    private readonly settings: SettingsService
  ) {}

  summary(): AttentionSummary {
    const account = this.activeAccount();
    if (!account) return emptyAttentionSummary();
    const cacheKey = accountScopedCacheKey("notifications", account);
    const cached = this.cachedSummaries.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const snapshot = this.database.localCache.cacheSummary.attentionSummarySnapshot(account.login) ?? emptyAttentionSummary();
    this.cachedSummaries.set(cacheKey, { expiresAt: Date.now() + 60_000, value: snapshot });
    this.scheduleSummarySnapshotRefresh(account, 1_500);
    return snapshot;
  }

  private computeSummary(): AttentionSummary {
    const account = this.activeAccount();
    if (!account) return emptyAttentionSummary();
    const notificationItems = this.list({ surface: "notifications", limit: 500 });
    const myWorkItems = this.list({ surface: "my_work", limit: 500 });
    const meaningfulItems = uniqueAttentionItems([...myWorkItems, ...notificationItems]);
    const summary = {
      unreadCount: notificationItems.filter((item) => item.unread && !item.muted && item.lane !== "noise" && item.lane !== "muted").length,
      actionableCount: meaningfulItems.filter((item) => !item.muted && (item.actionable || item.blocking)).length,
      waitingCount: meaningfulItems.filter((item) => !item.muted && ["waiting", "reviewing"].includes(item.lane)).length,
      blockingCount: meaningfulItems.filter((item) => !item.muted && item.blocking).length,
      botCollapsedCount: notificationItems
        .filter((item) => item.entityType === "bot_group")
        .reduce((count, item) => count + Number(item.number ?? 1), 0),
      lastSyncedAt:
        meaningfulItems
          .map((item) => item.lastSyncedAt ?? item.updatedAt)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null,
      fromCache: true
    };
    this.cachedSummaries.set(accountScopedCacheKey("notifications", account), { expiresAt: Date.now() + 60_000, value: summary });
    return summary;
  }

  list(input: AttentionListInput = {}): AttentionItem[] {
    const account = this.activeAccount();
    if (!account) return [];
    const cacheKey = accountScopedCacheKey(stableInputKey(input), account);
    const cached = this.cachedLists.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    this.scheduleDeriveAllCachedEventsIfStale();
    const states = new Map(
      this.database.localCache.attention
        .listAttentionStates(account.login)
        .map((state) => [attentionEntityId(state.entityType, state.repoId, state.entityNumber), state])
    );
    const events = this.database.localCache.notifications.listNotificationEvents({ repoId: input.repoId, limit: 500 });
    const latestEvents = latestEventsByEntity(events, account.login);
    const contextBase = {
      login: account.login,
      now: nowIso(),
      settings: this.settings.get().attention
    };
    const reviewDrafts = reviewDraftSummaries(this.database);

    const prs = this.database.localCache.githubWork
      .listUserPullRequests(account.login, { activeOnly: input.surface === "my_work" })
      .filter((pr) => !input.repoId || pr.repoId === input.repoId)
      .filter((pr) => input.surface !== "my_work" || isActivePullRequest(pr));
    const issues = this.database.localCache.githubWork
      .listUserIssues(account.login, { activeOnly: input.surface === "my_work" })
      .filter((issue) => !input.repoId || issue.repoId === input.repoId);
    const items = [
      ...prs.map((pr) =>
        attentionForPullRequest(pr, {
          ...contextBase,
          localState: states.get(attentionEntityId("pull_request", pr.repoId, pr.number)) ?? null,
          latestEvent: latestEvents.get(attentionEntityId("pull_request", pr.repoId, pr.number)) ?? null,
          reviewDraft: reviewDrafts.get(`${pr.repoId}:${pr.number}`) ?? null
        })
      ),
      ...issues.map((issue) =>
        attentionForIssue(issue, {
          ...contextBase,
          localState: states.get(attentionEntityId("issue", issue.repoId, issue.number)) ?? null,
          latestEvent: latestEvents.get(attentionEntityId("issue", issue.repoId, issue.number)) ?? null
        })
      )
    ];

    const eventOnlyItems = this.eventOnlyItems(events, states, items, contextBase);
    const filtered = sortAttentionItems([...items, ...eventOnlyItems]).filter((item) => matchesAttentionInput(item, input));
    const collapsed =
      input.surface === "notifications" && !["actionable", "waiting", "bots"].includes(input.filter ?? "all")
        ? collapseBotItems(filtered, this.settings.get().attention.collapseBotActivity)
        : filtered;
    const result = collapsed
      .filter((item) => matchesAttentionInput(item, input))
      .slice(0, Math.min(Math.max(Math.floor(input.limit ?? 100), 1), 500));
    this.cachedLists.set(cacheKey, { expiresAt: Date.now() + 10_000, value: result });
    return result;
  }

  markRead(ids: string[]): void {
    const login = this.requireLogin();
    this.database.localCache.attention.markAttentionRead(ids, login);
    this.clearCache();
  }

  markAllRead(input: AttentionListInput = {}): void {
    const login = this.requireLogin();
    const ids = new Set(this.list({ ...input, surface: "notifications", limit: 500 }).map((item) => item.id));
    if (!input.filter || input.filter === "all") {
      for (const item of this.list({ ...input, surface: "notifications", filter: "bots", limit: 500 })) ids.add(item.id);
    }
    this.database.localCache.attention.markAttentionRead([...ids], login);
    this.clearCache();
  }

  markDone(id: string): void {
    this.patchByItemId(id, { doneAt: nowIso(), snoozedUntil: null });
  }

  undoDone(id: string): void {
    this.patchByItemId(id, { doneAt: null });
  }

  snooze(id: string, until: string): void {
    this.patchByItemId(id, { snoozedUntil: until, doneAt: null });
  }

  unsnooze(id: string): void {
    this.patchByItemId(id, { snoozedUntil: null });
  }

  mute(id: string, until?: string | null): void {
    this.patchByItemId(id, { mutedUntil: until ?? "9999-12-31T23:59:59.999Z" });
  }

  unmute(id: string): void {
    this.patchByItemId(id, { mutedUntil: null });
  }

  deriveForRepo(repoId: string): void {
    this.lastDerivedAllAt = Date.now();
    this.clearCache();
    const prs = this.database.localCache.githubWork.listPullRequests(repoId);
    const issues = this.database.localCache.githubWork.listIssues(repoId);
    for (const pr of prs) this.derivePullRequestEvents(pr);
    for (const issue of issues) this.deriveIssueEvents(issue);
    this.deriveCommentEvents(repoId);
    this.deriveReviewEvents(repoId);
    this.deriveCheckEvents(repoId);
    this.deriveWorkflowEvents(repoId);
    const account = this.activeAccount();
    if (account) {
      const summary = this.computeSummary();
      this.database.localCache.cacheSummary.upsertAttentionSummarySnapshot(account.login, summary);
    }
  }

  private scheduleDeriveAllCachedEventsIfStale(): void {
    const now = Date.now();
    if (this.derivingAll || now - this.lastDerivedAllAt < 60_000) return;
    this.lastDerivedAllAt = now;
    this.derivingAll = true;
    const repos = this.database.localCache.repos.listWatchedReposForActiveAccount();
    const deriveNext = () => {
      const repo = repos.shift();
      if (!repo) {
        this.derivingAll = false;
        return;
      }
      try {
        this.deriveForRepo(repo.id);
      } catch (error) {
        console.warn("Failed to refresh attention events.", error);
      }
      setTimeout(deriveNext, 25);
    };
    setTimeout(deriveNext, 5_000);
  }

  private clearCache(): void {
    this.cachedSummaries.clear();
    this.cachedLists.clear();
    const account = this.activeAccount();
    if (account) this.scheduleSummarySnapshotRefresh(account, 250);
  }

  private scheduleSummarySnapshotRefresh(account: ActiveAttentionAccount, delayMs: number): void {
    if (this.summaryRefreshScheduled) return;
    this.summaryRefreshScheduled = true;
    setTimeout(() => {
      try {
        const active = this.activeAccount();
        if (!active || active.id !== account.id) return;
        const summary = this.computeSummary();
        this.database.localCache.cacheSummary.upsertAttentionSummarySnapshot(active.login, summary);
        this.cachedSummaries.set(accountScopedCacheKey("notifications", active), { expiresAt: Date.now() + 60_000, value: summary });
      } catch (error) {
        console.warn("Failed to refresh attention summary snapshot.", error);
      } finally {
        this.summaryRefreshScheduled = false;
      }
    }, delayMs);
  }

  private derivePullRequestEvents(pr: PullRequestSummary): void {
    if (pr.requestedReviewerLogins.length > 0) {
      for (const reviewer of pr.requestedReviewerLogins) {
        this.database.localCache.notifications.upsertNotificationEvent({
          eventKey: `pr-state:${pr.repoId}:${pr.number}:${pr.headSha ?? "head"}:review-requested:${reviewer}`,
          entityType: "pull_request",
          repoId: pr.repoId,
          entityNumber: pr.number,
          eventKind: "review_request",
          actorLogin: null,
          actorIsBot: false,
          title: `${reviewer} was requested for review`,
          bodyPreview: pr.title,
          htmlUrl: pr.htmlUrl,
          githubCreatedAt: pr.updatedAt,
          githubUpdatedAt: pr.updatedAt,
          importance: 90,
          promotesToMyWork: true,
          collapseKey: null,
          payload: { reviewer }
        });
      }
    }
    if (pr.headSha) {
      this.database.localCache.notifications.upsertNotificationEvent({
        eventKey: `pr-head:${pr.repoId}:${pr.number}:${pr.headSha}`,
        entityType: "pull_request",
        repoId: pr.repoId,
        entityNumber: pr.number,
        eventKind: "commit_push",
        actorLogin: pr.authorLogin,
        actorIsBot: isLikelyBotLogin(pr.authorLogin),
        title: `New commits on #${pr.number}`,
        bodyPreview: pr.title,
        htmlUrl: pr.htmlUrl,
        githubCreatedAt: pr.updatedAt,
        githubUpdatedAt: pr.updatedAt,
        importance: 20,
        promotesToMyWork: false,
        collapseKey: null,
        payload: { headSha: pr.headSha }
      });
    }
    this.database.localCache.notifications.upsertNotificationEvent({
      eventKey: `pr-state:${pr.repoId}:${pr.number}:${pr.state}:${pr.isDraft ? "draft" : "ready"}:${pr.mergedAt ?? "unmerged"}`,
      entityType: "pull_request",
      repoId: pr.repoId,
      entityNumber: pr.number,
      eventKind: "state_change",
      actorLogin: pr.authorLogin,
      actorIsBot: isLikelyBotLogin(pr.authorLogin),
      title: `PR #${pr.number} ${pr.mergedAt ? "merged" : pr.state}`,
      bodyPreview: pr.title,
      htmlUrl: pr.htmlUrl,
      githubCreatedAt: pr.updatedAt,
      githubUpdatedAt: pr.updatedAt,
      importance: pr.state === "closed" ? 10 : 20,
      promotesToMyWork: false,
      collapseKey: null,
      payload: { state: pr.state, isDraft: pr.isDraft, mergedAt: pr.mergedAt }
    });
    if (pr.labels.length > 0) {
      this.database.localCache.notifications.upsertNotificationEvent({
        eventKey: `pr-labels:${pr.repoId}:${pr.number}:${stableToken(pr.labels)}`,
        entityType: "pull_request",
        repoId: pr.repoId,
        entityNumber: pr.number,
        eventKind: "label",
        actorLogin: pr.authorLogin,
        actorIsBot: isLikelyBotLogin(pr.authorLogin),
        title: `Labels changed on #${pr.number}`,
        bodyPreview: pr.labels.join(", "),
        htmlUrl: pr.htmlUrl,
        githubCreatedAt: pr.updatedAt,
        githubUpdatedAt: pr.updatedAt,
        importance: pr.labels.some((label) => /^(p0|p1|priority|urgent|blocker|critical|security)$/i.test(label)) ? 60 : 10,
        promotesToMyWork: false,
        collapseKey: null,
        payload: { labels: pr.labels }
      });
    }
  }

  private deriveIssueEvents(issue: IssueSummary): void {
    if (issue.assigneeLogins.length > 0) {
      this.database.localCache.notifications.upsertNotificationEvent({
        eventKey: `issue-assignment:${issue.repoId}:${issue.number}:${issue.assigneeLogins.join(",")}`,
        entityType: "issue",
        repoId: issue.repoId,
        entityNumber: issue.number,
        eventKind: "assignment",
        actorLogin: issue.authorLogin,
        actorIsBot: isLikelyBotLogin(issue.authorLogin),
        title: `Issue #${issue.number} assigned`,
        bodyPreview: issue.title,
        htmlUrl: issue.htmlUrl,
        githubCreatedAt: issue.updatedAt,
        githubUpdatedAt: issue.updatedAt,
        importance: 50,
        promotesToMyWork: true,
        collapseKey: null,
        payload: { assignees: issue.assigneeLogins }
      });
    }
    this.database.localCache.notifications.upsertNotificationEvent({
      eventKey: `issue-state:${issue.repoId}:${issue.number}:${issue.state}`,
      entityType: "issue",
      repoId: issue.repoId,
      entityNumber: issue.number,
      eventKind: "state_change",
      actorLogin: issue.authorLogin,
      actorIsBot: isLikelyBotLogin(issue.authorLogin),
      title: `Issue #${issue.number} ${issue.state}`,
      bodyPreview: issue.title,
      htmlUrl: issue.htmlUrl,
      githubCreatedAt: issue.updatedAt,
      githubUpdatedAt: issue.updatedAt,
      importance: issue.state === "closed" ? 10 : 20,
      promotesToMyWork: false,
      collapseKey: null,
      payload: { state: issue.state }
    });
    if (issue.labels.length > 0) {
      this.database.localCache.notifications.upsertNotificationEvent({
        eventKey: `issue-labels:${issue.repoId}:${issue.number}:${stableToken(issue.labels)}`,
        entityType: "issue",
        repoId: issue.repoId,
        entityNumber: issue.number,
        eventKind: "label",
        actorLogin: issue.authorLogin,
        actorIsBot: isLikelyBotLogin(issue.authorLogin),
        title: `Labels changed on issue #${issue.number}`,
        bodyPreview: issue.labels.join(", "),
        htmlUrl: issue.htmlUrl,
        githubCreatedAt: issue.updatedAt,
        githubUpdatedAt: issue.updatedAt,
        importance: issue.labels.some((label) => /^(p0|p1|priority|urgent|blocker|critical|security)$/i.test(label)) ? 60 : 10,
        promotesToMyWork: false,
        collapseKey: null,
        payload: { labels: issue.labels }
      });
    }
  }

  private deriveCommentEvents(repoId: string): void {
    for (const row of this.database.db.prepare("SELECT * FROM comments WHERE repo_id = ?").all(repoId) as Record<string, unknown>[]) {
      const entityType = String(row.entity_type) === "issue" ? "issue" : "pull_request";
      const actorLogin = nullableString(row.author_login);
      this.database.localCache.notifications.upsertNotificationEvent({
        eventKey: `comment:${repoId}:${entityType}:${row.entity_number}:${row.github_comment_id}`,
        entityType,
        repoId,
        entityNumber: Number(row.entity_number),
        eventKind: "comment",
        actorLogin,
        actorIsBot: isLikelyBotLogin(actorLogin),
        title: `${actorLogin ?? "Someone"} commented`,
        bodyPreview: previewText(nullableString(row.body)),
        htmlUrl: nullableString(row.html_url),
        githubCreatedAt: nullableString(row.created_at),
        githubUpdatedAt: nullableString(row.updated_at) ?? nullableString(row.created_at),
        importance: isLikelyBotLogin(actorLogin) ? 0 : 35,
        promotesToMyWork: !isLikelyBotLogin(actorLogin),
        collapseKey: isLikelyBotLogin(actorLogin) ? botCollapseKey(actorLogin, repoId) : null,
        payload: null
      });
    }
  }

  private deriveReviewEvents(repoId: string): void {
    for (const row of this.database.db.prepare("SELECT * FROM reviews WHERE repo_id = ?").all(repoId) as Record<string, unknown>[]) {
      const actorLogin = nullableString(row.author_login);
      this.database.localCache.notifications.upsertNotificationEvent({
        eventKey: `review:${repoId}:${row.pr_number}:${row.github_review_id}`,
        entityType: "pull_request",
        repoId,
        entityNumber: Number(row.pr_number),
        eventKind: "review",
        actorLogin,
        actorIsBot: isLikelyBotLogin(actorLogin),
        title: `${actorLogin ?? "Someone"} submitted a review`,
        bodyPreview: nullableString(row.state)?.replaceAll("_", " ").toLowerCase() ?? null,
        htmlUrl: nullableString(row.html_url),
        githubCreatedAt: nullableString(row.submitted_at),
        githubUpdatedAt: nullableString(row.submitted_at),
        importance: 55,
        promotesToMyWork: false,
        collapseKey: null,
        payload: { state: nullableString(row.state) }
      });
    }
  }

  private deriveCheckEvents(repoId: string): void {
    for (const row of this.database.db.prepare("SELECT * FROM check_runs WHERE repo_id = ?").all(repoId) as Record<string, unknown>[]) {
      const conclusion = nullableString(row.conclusion);
      const failed = Boolean(conclusion && !["success", "neutral", "skipped"].includes(conclusion));
      this.database.localCache.notifications.upsertNotificationEvent({
        eventKey: `check:${repoId}:${row.commit_sha}:${row.github_check_run_id ?? row.id}:${conclusion ?? row.status ?? "pending"}`,
        entityType: "check",
        repoId,
        entityNumber: nullableNumber(row.pr_number),
        eventKind: failed ? "check_failed" : "check_passed",
        actorLogin: "github-actions[bot]",
        actorIsBot: true,
        title: `${String(row.name)} ${failed ? "failed" : "completed"}`,
        bodyPreview: conclusion,
        htmlUrl: nullableString(row.html_url),
        githubCreatedAt: nullableString(row.completed_at) ?? nullableString(row.started_at),
        githubUpdatedAt: nullableString(row.completed_at) ?? nullableString(row.started_at),
        importance: failed ? 80 : -20,
        promotesToMyWork: failed,
        collapseKey: `github-actions:${repoId}:${row.pr_number ?? row.commit_sha}`,
        payload: { conclusion }
      });
    }
  }

  private deriveWorkflowEvents(repoId: string): void {
    for (const row of this.database.db.prepare("SELECT * FROM workflow_runs WHERE repo_id = ?").all(repoId) as Record<string, unknown>[]) {
      const conclusion = nullableString(row.conclusion);
      const failed = Boolean(conclusion && !["success", "neutral", "skipped"].includes(conclusion));
      const actorLogin = nullableString(row.actor_login);
      this.database.localCache.notifications.upsertNotificationEvent({
        eventKey: `workflow:${repoId}:${row.github_workflow_run_id}:${row.status ?? "status"}:${conclusion ?? "pending"}`,
        entityType: "workflow_run",
        repoId,
        entityNumber: nullableNumber(row.run_number),
        eventKind: failed ? "workflow_failed" : "workflow_passed",
        actorLogin,
        actorIsBot: isLikelyBotLogin(actorLogin),
        title: `${String(row.workflow_name ?? "Workflow")} ${failed ? "failed" : "completed"}`,
        bodyPreview: nullableString(row.display_title),
        htmlUrl: nullableString(row.html_url),
        githubCreatedAt: nullableString(row.run_started_at) ?? nullableString(row.created_at),
        githubUpdatedAt: nullableString(row.updated_at),
        importance: failed ? 75 : -25,
        promotesToMyWork: false,
        collapseKey: `workflow:${repoId}:${row.workflow_name ?? "workflow"}`,
        payload: { conclusion }
      });
    }
  }

  private eventOnlyItems(
    events: NotificationEventRecord[],
    states: Map<string, AttentionLocalState>,
    existing: AttentionItem[],
    context: { login: string; now: string }
  ): AttentionItem[] {
    const existingIds = new Set(existing.map((item) => item.id));
    const existingPrNumbers = new Set(
      existing.filter((item) => item.entityType === "pull_request" && item.number != null).map((item) => `${item.repoId}:${item.number}`)
    );
    return events
      .filter((event) => !existingIds.has(attentionEntityId(event.entityType, event.repoId, event.entityNumber)))
      .filter((event) => !isClosedOrMergedEvent(event))
      .filter((event) => !this.isCurrentCachedEntityClosedOrMerged(event))
      .filter((event) => !isReviewRequestForOtherUser(event, context.login))
      .filter((event) => !isAssignmentForOtherUser(event, context.login))
      .filter((event) => !isGenericRepoEventOnlyEvent(event))
      .filter((event) => !isUnrelatedEventOnlyConversationEvent(event, context.login))
      .filter(
        (event) =>
          !(event.entityType === "check" && event.entityNumber != null && existingPrNumbers.has(`${event.repoId}:${event.entityNumber}`))
      )
      .map((event) =>
        eventToAttentionItem(event, states.get(attentionEntityId(event.entityType, event.repoId, event.entityNumber)) ?? null, context)
      );
  }

  private isCurrentCachedEntityClosedOrMerged(event: NotificationEventRecord): boolean {
    if (event.entityNumber == null) return false;
    if (event.entityType === "issue") {
      const row = this.database.db
        .prepare("SELECT state, closed_at FROM issues WHERE repo_id = ? AND number = ? AND is_pull_request = 0")
        .get(event.repoId, event.entityNumber) as Record<string, unknown> | undefined;
      return Boolean(row && (String(row.state) === "closed" || nullableString(row.closed_at)));
    }
    if (event.entityType === "pull_request") {
      const row = this.database.db
        .prepare("SELECT state, merged, closed_at, merged_at FROM pull_requests WHERE repo_id = ? AND number = ?")
        .get(event.repoId, event.entityNumber) as Record<string, unknown> | undefined;
      return Boolean(
        row &&
        (String(row.state) === "closed" || Number(row.merged) === 1 || nullableString(row.closed_at) || nullableString(row.merged_at))
      );
    }
    return false;
  }

  private patchByItemId(id: string, patch: Partial<AttentionLocalState>): void {
    const parsed = parseAttentionItemId(id);
    if (!parsed) return;
    this.database.localCache.attention.patchAttentionState(
      parsed.entityType,
      parsed.repoId,
      parsed.entityNumber,
      this.requireLogin(),
      patch
    );
    this.clearCache();
  }

  private accountLogin(): string | null {
    return this.database.localCache.accounts.getGitHubAccount()?.login ?? null;
  }

  private activeAccount(): ActiveAttentionAccount | null {
    const account = this.database.localCache.accounts.getGitHubAccount();
    return account?.login ? { id: account.id, login: account.login } : null;
  }

  private requireLogin(): string {
    const login = this.accountLogin();
    if (!login) throw new Error("Connect GitHub before updating attention state.");
    return login;
  }
}

interface ActiveAttentionAccount {
  id: string;
  login: string;
}

function stableInputKey(input: AttentionListInput): string {
  return JSON.stringify({
    surface: input.surface ?? null,
    lane: input.lane ?? null,
    filter: input.filter ?? null,
    repoId: input.repoId ?? null,
    limit: input.limit ?? null
  });
}

function accountScopedCacheKey(key: string, account: ActiveAttentionAccount): string {
  return `${account.id}:${account.login}:${key}`;
}

function uniqueAttentionItems(items: AttentionItem[]): AttentionItem[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

function reviewDraftSummaries(database: DatabaseService): Map<string, AttentionReviewDraftSummary> {
  const rows = database.db
    .prepare(
      `SELECT draft.repo_id, draft.pr_number, draft.comments_json, draft.reviewed_files_json, draft.updated_at, draft.head_sha, pr.head_sha AS current_head_sha
       FROM pr_review_drafts draft
       LEFT JOIN pull_requests pr ON pr.repo_id = draft.repo_id AND pr.number = draft.pr_number
       WHERE pr.state IS NULL OR (pr.state = 'open' AND COALESCE(pr.merged, 0) = 0)`
    )
    .all() as Record<string, unknown>[];
  const summaries = new Map<string, AttentionReviewDraftSummary>();
  for (const row of rows) {
    const repoId = nullableString(row.repo_id);
    const prNumber = numberValue(row.pr_number);
    if (!repoId || prNumber == null) continue;
    const current = summaries.get(`${repoId}:${prNumber}`);
    const next: AttentionReviewDraftSummary = {
      commentCount: countNonEmptyReviewComments(row.comments_json),
      reviewedFileCount: countStrings(row.reviewed_files_json),
      updatedAt: nullableString(row.updated_at),
      outdated: Boolean(nullableString(row.current_head_sha) && nullableString(row.head_sha) !== nullableString(row.current_head_sha))
    };
    if (!current || Date.parse(next.updatedAt ?? "") > Date.parse(current.updatedAt ?? "")) {
      summaries.set(`${repoId}:${prNumber}`, next);
    }
  }
  return summaries;
}

function eventToAttentionItem(
  event: NotificationEventRecord,
  state: AttentionLocalState | null,
  context: { login: string; now: string }
): AttentionItem {
  const id = attentionEntityId(event.entityType, event.repoId, event.entityNumber);
  const eventSummary: AttentionEventSummary = {
    id: event.eventKey,
    kind: event.eventKind,
    label: event.title,
    preview: event.bodyPreview,
    actorLogin: event.actorLogin,
    actorIsBot: event.actorIsBot,
    createdAt: event.githubUpdatedAt ?? event.githubCreatedAt
  };
  const readAt = state?.readAt ?? state?.lastSeenAt;
  const muted = Boolean(state?.mutedUntil && Date.parse(state.mutedUntil) > Date.parse(context.now));
  const snoozed = Boolean(state?.snoozedUntil && Date.parse(state.snoozedUntil) > Date.parse(context.now));
  const done = Boolean(
    state?.doneAt && !(eventSummary.createdAt && !eventSummary.actorIsBot && Date.parse(eventSummary.createdAt) > Date.parse(state.doneAt))
  );
  const lane = muted
    ? "muted"
    : snoozed
      ? "snoozed"
      : done
        ? "done"
        : event.actorIsBot
          ? "noise"
          : event.promotesToMyWork
            ? "needs_me"
            : "watching";
  return {
    id,
    entityType: event.entityType,
    repoId: event.repoId,
    repoFullName: null,
    number: event.entityNumber,
    title: event.title,
    htmlUrl: event.htmlUrl,
    lane,
    surfaces: ["notifications"],
    reason: event.actorIsBot
      ? "bot_activity"
      : event.eventKind.includes("check") || event.eventKind.includes("workflow")
        ? "ci_activity"
        : "repo_activity",
    reasonLabel: event.actorIsBot ? "Bot activity" : "Notification",
    why: event.title,
    latestMeaningfulEvent: eventSummary,
    whatChanged:
      event.actorLogin && !event.actorIsBot && !event.title.toLowerCase().includes(event.actorLogin.toLowerCase())
        ? `${event.actorLogin}: ${event.title}`
        : event.title,
    whyRelevant: event.title,
    suggestedAction: "Open",
    urgency:
      lane === "noise" || lane === "muted" || lane === "done" || lane === "snoozed"
        ? "low"
        : event.importance >= 80
          ? "critical"
          : event.promotesToMyWork || event.importance >= 50
            ? "high"
            : "normal",
    actorLogin: event.actorLogin,
    actorIsBot: event.actorIsBot,
    priority: event.importance,
    unread: !readAt || Date.parse(event.githubUpdatedAt ?? event.githubCreatedAt ?? event.lastSeenAt ?? "") > Date.parse(readAt),
    actionable: event.promotesToMyWork && lane === "needs_me",
    blocking: event.importance >= 80 && lane !== "done" && lane !== "snoozed" && lane !== "muted",
    snoozedUntil: snoozed ? (state?.snoozedUntil ?? null) : null,
    doneAt: done ? (state?.doneAt ?? null) : null,
    muted,
    updatedAt: event.githubUpdatedAt ?? event.githubCreatedAt,
    lastSyncedAt: event.lastSeenAt ?? null
  };
}

function isClosedOrMergedEvent(event: NotificationEventRecord): boolean {
  if (event.entityType !== "pull_request" && event.entityType !== "issue") return false;
  const payload = event.payload ?? {};
  return payload.state === "closed" || Boolean(payload.mergedAt);
}

function isReviewRequestForOtherUser(event: NotificationEventRecord, login: string): boolean {
  if (event.eventKind !== "review_request") return false;
  const reviewer = typeof event.payload?.reviewer === "string" ? event.payload.reviewer : null;
  return Boolean(reviewer && reviewer.toLowerCase() !== login.toLowerCase());
}

function isAssignmentForOtherUser(event: NotificationEventRecord, login: string): boolean {
  if (event.eventKind !== "assignment") return false;
  const assignees = assigneesFromEventPayload(event.payload);
  return assignees.length > 0 && !assignees.some((assignee) => assignee.toLowerCase() === login.toLowerCase());
}

function isGenericRepoEventOnlyEvent(event: NotificationEventRecord): boolean {
  if (event.entityType !== "pull_request" && event.entityType !== "issue") return false;
  return event.eventKind === "state_change" || event.eventKind === "label" || event.eventKind === "commit_push";
}

function isUnrelatedEventOnlyConversationEvent(event: NotificationEventRecord, login: string): boolean {
  if (event.eventKind !== "comment" && event.eventKind !== "review") return false;
  return !eventMentionsLogin(event, login);
}

function eventMentionsLogin(event: NotificationEventRecord, login: string): boolean {
  return [event.title, event.bodyPreview].some((value) =>
    Boolean(value && new RegExp(`(^|[^\\w-])@${escapeRegExp(login)}($|[^\\w-])`, "i").test(value))
  );
}

function assigneesFromEventPayload(payload: NotificationEventRecord["payload"]): string[] {
  const rawAssignees = payload?.assignees;
  if (Array.isArray(rawAssignees)) return rawAssignees.filter((assignee): assignee is string => typeof assignee === "string");
  const rawAssignee = payload?.assignee;
  return typeof rawAssignee === "string" ? [rawAssignee] : [];
}

function latestEventsByEntity(events: NotificationEventRecord[], login: string): Map<string, AttentionEventSummary> {
  const map = new Map<string, AttentionEventSummary>();
  for (const event of events) {
    if (isReviewRequestForOtherUser(event, login)) continue;
    if (isAssignmentForOtherUser(event, login)) continue;
    const id = attentionEntityId(event.entityType, event.repoId, event.entityNumber);
    const summary: AttentionEventSummary = {
      id: event.eventKey,
      kind: event.eventKind,
      label: event.title,
      preview: event.bodyPreview,
      actorLogin: event.actorLogin,
      actorIsBot: event.actorIsBot,
      createdAt: event.githubUpdatedAt ?? event.githubCreatedAt
    };
    const current = map.get(id);
    if (!current || Date.parse(summary.createdAt ?? "") > Date.parse(current.createdAt ?? "")) map.set(id, summary);
  }
  return map;
}

function matchesAttentionInput(item: AttentionItem, input: AttentionListInput): boolean {
  if (input.surface && !item.surfaces.includes(input.surface)) return false;
  if (input.lane && item.lane !== input.lane) return false;
  if (input.repoId && item.repoId !== input.repoId) return false;
  if (
    !input.lane &&
    input.filter !== "bots" &&
    input.filter !== "muted" &&
    (item.lane === "noise" || item.lane === "muted" || item.entityType === "bot_group")
  )
    return false;
  if (input.filter === "actionable" && !item.actionable && !item.blocking) return false;
  if (input.filter === "waiting" && !["waiting", "reviewing"].includes(item.lane)) return false;
  if (input.filter === "bots" && !item.actorIsBot && item.entityType !== "bot_group") return false;
  if (input.filter === "human" && item.actorIsBot) return false;
  if (input.filter === "reviews" && !["explicit_review_request", "reviewed_waiting_author"].includes(item.reason)) return false;
  if (input.filter === "checks" && !["checks_failing", "ci_activity"].includes(item.reason)) return false;
  if (input.filter === "muted" && !item.muted) return false;
  if (input.filter !== "muted" && input.lane !== "muted" && item.muted) return false;
  return true;
}

function isActivePullRequest(pr: PullRequestSummary): boolean {
  return pr.state === "open" && !pr.merged && !pr.mergedAt && !pr.closedAt;
}

function emptyAttentionSummary(): AttentionSummary {
  return {
    unreadCount: 0,
    actionableCount: 0,
    waitingCount: 0,
    blockingCount: 0,
    botCollapsedCount: 0,
    lastSyncedAt: null,
    fromCache: true
  };
}

function collapseBotItems(items: AttentionItem[], collapse: boolean): AttentionItem[] {
  if (!collapse) return items;
  const human = items.filter((item) => !item.actorIsBot || item.actionable);
  const bots = items.filter((item) => item.actorIsBot && !item.actionable);
  const groups = new Map<string, AttentionItem[]>();
  for (const item of bots) {
    const key = `${item.actorLogin ?? "bot"}:${item.repoId}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [
    ...human,
    ...Array.from(groups.entries()).map(([key, group]) => {
      const latest = sortAttentionItems(group)[0]!;
      const urgency: AttentionUrgency = group.some((item) => item.blocking) ? "normal" : "low";
      return {
        ...latest,
        id: `bot_group:${key}`,
        entityType: "bot_group" as const,
        number: group.length,
        title: `${group.length} ${latest.actorLogin ?? "bot"} updates collapsed`,
        why: "Bot activity collapsed",
        whatChanged: `${group.length} automated updates collapsed`,
        whyRelevant: "Bot and CI updates are grouped away from human asks",
        suggestedAction: "Open",
        urgency,
        actionable: false,
        blocking: group.some((item) => item.blocking),
        priority: Math.max(...group.map((item) => item.priority)),
        surfaces: ["notifications"] as AttentionSurface[]
      };
    })
  ];
}

function parseAttentionItemId(id: string): { entityType: AttentionEntityType; repoId: string; entityNumber: number | null } | null {
  const [entityType, repoId, rawNumber] = id.split(":");
  if (!entityType || !repoId || entityType === "bot_group") return null;
  return { entityType: entityType as AttentionEntityType, repoId, entityNumber: rawNumber === "none" ? null : Number(rawNumber) };
}

function botCollapseKey(actorLogin: string | null, repoId: string): string {
  return `${actorLogin ?? "bot"}:${repoId}:${new Date().toISOString().slice(0, 10)}`;
}

function stableToken(values: string[]): string {
  return (
    values
      .map((value) => value.trim().toLowerCase())
      .sort()
      .join("|") || "none"
  );
}

function previewText(value: string | null): string | null {
  return value?.replace(/\s+/g, " ").trim().slice(0, 160) || null;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function numberValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function countStrings(value: unknown): number {
  try {
    const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string" && item.trim()).length : 0;
  } catch {
    return 0;
  }
}

function countNonEmptyReviewComments(value: unknown): number {
  try {
    const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return 0;
    return parsed.filter((item) => {
      if (!item || typeof item !== "object") return false;
      const body = (item as { body?: unknown }).body;
      return typeof body === "string" && body.trim().length > 0;
    }).length;
  } catch {
    return 0;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
