import type { DatabaseService } from "../database-service.js";
import { errorCode, errorMessage, isNetworkError } from "../error-classification.js";
import { GitHubApiError } from "../github-client.js";
import type { HealthService } from "../health-service.js";
import type { SyncService } from "../sync-service.js";
import type {
  CreateOfflineActionInput,
  OfflineAction,
  OfflineActionPayload,
  OfflineActionQueueReason,
  OfflineActionType,
  UpdateOfflineActionInput,
  WritebackSubmitResult
} from "../../../src/shared/domain/offline-action.js";
import { offlineActionRequiredSurfaces } from "../../../src/shared/domain/offline-action.js";
import type { SubmitPullRequestReviewInput } from "../../../src/shared/domain/github-work.js";

export interface QueueAwareWritebackOptions {
  clientOnline?: boolean;
}

export interface OfflineWritebackQueueEvents {
  onChanged(repoId?: string | null): void;
}

const retryDelaysMs = [15_000, 45_000, 2 * 60_000, 5 * 60_000, 15 * 60_000];
const healthFreshnessMs = 2 * 60_000;

export class OfflineWritebackQueueService {
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly sync: SyncService,
    private readonly health: HealthService,
    private readonly events: OfflineWritebackQueueEvents
  ) {}

  start(): void {
    const recovered = this.database.localCache.offlineActions.recoverInterruptedOfflineActions();
    this.database.localCache.offlineActions.pruneCompletedOfflineActions();
    if (recovered > 0) this.changed();
    this.scheduleNextFlush();
    setTimeout(() => void this.flushDueActions("startup"), 3_000);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  list(input = {}): OfflineAction[] {
    return this.database.localCache.offlineActions.listOfflineActions(input);
  }

  get(id: string): OfflineAction | null {
    return this.database.localCache.offlineActions.getOfflineAction(id);
  }

  summary() {
    return this.database.localCache.offlineActions.offlineActionSummary();
  }

  update(id: string, input: UpdateOfflineActionInput): OfflineAction {
    const action = this.database.localCache.offlineActions.updateOfflineAction(id, input);
    this.changed(action.repoId);
    this.scheduleNextFlush();
    return action;
  }

  cancel(id: string): OfflineAction {
    const action = this.database.localCache.offlineActions.cancelOfflineAction(id);
    this.changed(action.repoId);
    this.scheduleNextFlush();
    return action;
  }

  async retryNow(id: string): Promise<void> {
    const action = this.database.localCache.offlineActions.getOfflineAction(id);
    if (!action) throw new Error("Queued action not found.");
    await this.sendAction(action, "manual_retry");
    this.scheduleNextFlush();
  }

  async submitIssueComment(
    repoId: string,
    number: number,
    body: string,
    options: QueueAwareWritebackOptions = {}
  ): Promise<WritebackSubmitResult> {
    const trimmed = body.trim();
    if (!trimmed) throw new Error("Comment body is required.");
    return this.submitOrQueue(
      {
        repoId,
        actionType: "issue_comment",
        entityType: "issue",
        entityNumber: number,
        body: trimmed,
        payload: { actionType: "issue_comment", body: trimmed },
        title: `Issue #${number} comment`
      },
      () => this.sync.addIssueComment(repoId, number, trimmed),
      options
    );
  }

  async submitPullRequestComment(
    repoId: string,
    number: number,
    body: string,
    options: QueueAwareWritebackOptions = {}
  ): Promise<WritebackSubmitResult> {
    const trimmed = body.trim();
    if (!trimmed) throw new Error("Comment body is required.");
    return this.submitOrQueue(
      {
        repoId,
        actionType: "pr_comment",
        entityType: "pull_request",
        entityNumber: number,
        body: trimmed,
        payload: { actionType: "pr_comment", body: trimmed },
        title: `PR #${number} comment`
      },
      () => this.sync.addPullRequestComment(repoId, number, trimmed),
      options
    );
  }

  async submitPullRequestReview(
    repoId: string,
    number: number,
    input: SubmitPullRequestReviewInput,
    options: QueueAwareWritebackOptions = {}
  ): Promise<WritebackSubmitResult> {
    const pr = this.database.localCache.githubWork.getPullRequest(repoId, number);
    const body = input.body?.trim() ?? "";
    const comments = input.comments?.map((comment) => ({ ...comment, body: comment.body.trim() })).filter((comment) => comment.body);
    const preview = body || comments?.map((comment) => comment.body).join("\n") || reviewEventLabel(input.event);
    return this.submitOrQueue(
      {
        repoId,
        actionType: "pr_review",
        entityType: "pull_request",
        entityNumber: number,
        body: preview,
        payload: {
          actionType: "pr_review",
          event: input.event,
          ...(body ? { body } : {}),
          ...(comments && comments.length > 0 ? { comments } : {}),
          headSha: pr?.headSha ?? null
        },
        title: `PR #${number} review`,
        upstreamLastSeenSha: pr?.headSha ?? null,
        upstreamLastSeenUpdatedAt: pr?.updatedAt ?? null
      },
      () => this.sync.submitPullRequestReview(repoId, number, input),
      options
    );
  }

  async flushDueActions(reason: string): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const status = await this.health.offlineStatus().catch(() => null);
      if (status && (status.state === "offline" || status.state === "github_down" || status.state === "github_degraded")) {
        this.scheduleNextFlush();
        return;
      }
      const due = this.database.localCache.offlineActions.dueOfflineActions();
      for (const action of due) {
        await this.sendAction(action, reason).catch(() => undefined);
      }
    } finally {
      this.flushing = false;
      this.scheduleNextFlush();
    }
  }

  private async submitOrQueue(
    input: CreateOfflineActionInput,
    liveSend: () => Promise<void>,
    options: QueueAwareWritebackOptions
  ): Promise<WritebackSubmitResult> {
    const preflight = await this.queueReason(input.actionType, options);
    if (preflight) return this.enqueue(input, preflight);
    try {
      await liveSend();
      return { mode: "sent" };
    } catch (error) {
      const classification = classifyQueueFailure(error);
      const action = this.database.localCache.offlineActions.createOfflineAction({
        ...input,
        nextAttemptAt: classification.retryable ? nextAttemptAt(0, classification.resetAt) : null,
        lastErrorCode: classification.code,
        lastError: classification.message
      });
      if (!classification.retryable) {
        this.database.localCache.offlineActions.markOfflineActionBlocked(action.id, classification.code, classification.message);
      }
      this.changed(input.repoId);
      this.scheduleNextFlush();
      return {
        mode: "queued",
        action: this.database.localCache.offlineActions.getOfflineAction(action.id) ?? action,
        reason: classification.reason
      };
    }
  }

  private enqueue(input: CreateOfflineActionInput, reason: OfflineActionQueueReason): WritebackSubmitResult {
    const action = this.database.localCache.offlineActions.createOfflineAction({
      ...input,
      nextAttemptAt: nextAttemptAt(0),
      lastErrorCode: reason,
      lastError: queueReasonCopy(reason)
    });
    this.changed(input.repoId);
    this.scheduleNextFlush();
    return { mode: "queued", action, reason };
  }

  private async sendAction(action: OfflineAction, reason: string): Promise<void> {
    if (action.status === "blocked" || action.status === "sent" || action.status === "cancelled") return;
    const current = this.database.localCache.offlineActions.getOfflineAction(action.id);
    if (!current || current.status === "sending") return;
    const block = this.preSendBlock(current);
    if (block) {
      this.database.localCache.offlineActions.markOfflineActionBlocked(current.id, block.code, block.message);
      this.changed(current.repoId);
      return;
    }
    if (await this.markSentIfAlreadyPosted(current)) {
      this.changed(current.repoId);
      return;
    }
    this.database.localCache.offlineActions.markOfflineActionSending(current.id);
    this.changed(current.repoId);
    try {
      await this.liveSend(current.payload, current.repoId, current.entityNumber);
      this.database.localCache.offlineActions.markOfflineActionSent(current.id);
      this.refreshEntity(current);
      this.changed(current.repoId);
    } catch (error) {
      const classification = classifyQueueFailure(error);
      if (classification.retryable) {
        const updated = this.database.localCache.offlineActions.getOfflineAction(current.id);
        const attempts = updated?.attemptCount ?? current.attemptCount + 1;
        this.database.localCache.offlineActions.markOfflineActionRetryable(
          current.id,
          classification.code,
          classification.message,
          nextAttemptAt(attempts, classification.resetAt)
        );
      } else {
        this.database.localCache.offlineActions.markOfflineActionBlocked(current.id, classification.code, classification.message);
      }
      this.changed(current.repoId);
      if (reason !== "startup") void this.health.runProbe(current.repoId).catch(() => undefined);
      throw error;
    }
  }

  private async liveSend(payload: OfflineActionPayload, repoId: string, number: number): Promise<void> {
    if (payload.actionType === "issue_comment") {
      await this.sync.addIssueComment(repoId, number, payload.body);
      return;
    }
    if (payload.actionType === "pr_comment") {
      await this.sync.addPullRequestComment(repoId, number, payload.body);
      return;
    }
    await this.sync.submitPullRequestReview(repoId, number, {
      event: payload.event,
      ...(payload.body ? { body: payload.body } : {}),
      ...(payload.comments && payload.comments.length > 0 ? { comments: payload.comments } : {})
    });
  }

  private preSendBlock(action: OfflineAction): { code: string; message: string } | null {
    if (action.payload.actionType !== "pr_review") return null;
    const pr = this.database.localCache.githubWork.getPullRequest(action.repoId, action.entityNumber);
    if (!pr) return null;
    if (pr.state !== "open" || pr.merged) return { code: "pr_not_open", message: "This pull request is no longer open." };
    if (pr.isDraft) return { code: "pr_is_draft", message: "This pull request is a draft. Mark it ready before sending the review." };
    const hasInlineComments = Boolean(action.payload.comments?.length);
    if (hasInlineComments && action.payload.headSha && pr.headSha && action.payload.headSha !== pr.headSha) {
      return {
        code: "pr_head_changed",
        message: "The PR changed since this review was queued. Open the review and confirm inline comments."
      };
    }
    return null;
  }

  private async queueReason(actionType: OfflineActionType, options: QueueAwareWritebackOptions): Promise<OfflineActionQueueReason | null> {
    if (options.clientOnline === false) return "offline";
    const status = await this.health.offlineStatus().catch(() => null);
    if (status?.state === "offline" || status?.state === "github_down" || status?.state === "github_degraded") return "github_unavailable";
    if (status?.state === "rate_limited") return "rate_limited";
    const unhealthySurface = this.latestUnhealthySurface(actionType);
    if (unhealthySurface === "rate_limited") return "rate_limited";
    if (unhealthySurface) return "github_unavailable";
    return null;
  }

  private latestUnhealthySurface(actionType: OfflineActionType): string | null {
    const required = new Set(offlineActionRequiredSurfaces(actionType));
    const probes = this.database.localCache.health.latestHealthProbes();
    const now = Date.now();
    for (const probe of probes) {
      if (!required.has(probe.surface)) continue;
      if (Date.parse(probe.checkedAt) < now - healthFreshnessMs) continue;
      if (probe.status === "rate_limited") return "rate_limited";
      if (probe.status === "offline" || probe.status === "down" || probe.status === "degraded") return probe.status;
    }
    return null;
  }

  private refreshEntity(action: OfflineAction): void {
    if (action.entityType === "issue") {
      void this.sync.syncIssue(action.repoId, action.entityNumber).catch(() => undefined);
      return;
    }
    void this.sync.syncPullRequest(action.repoId, action.entityNumber).catch(() => undefined);
  }

  private async markSentIfAlreadyPosted(action: OfflineAction): Promise<boolean> {
    if (!action.lastAttemptAt || action.attemptCount === 0) return false;
    const login = this.database.localCache.accounts.getGitHubAccount()?.login;
    if (!login) return false;
    try {
      if (action.entityType === "issue") await this.sync.syncIssue(action.repoId, action.entityNumber);
      else await this.sync.syncPullRequest(action.repoId, action.entityNumber);
    } catch {
      return false;
    }

    if (action.payload.actionType === "issue_comment") {
      const issue = this.database.localCache.githubWork.getIssue(action.repoId, action.entityNumber);
      const body = action.payload.body;
      if (issue?.comments.some((comment) => sameLogin(comment.authorLogin, login) && sameBody(comment.body, body))) {
        this.database.localCache.offlineActions.markOfflineActionSent(action.id);
        return true;
      }
    }
    if (action.payload.actionType === "pr_comment") {
      const pr = this.database.localCache.githubWork.getPullRequest(action.repoId, action.entityNumber);
      const body = action.payload.body;
      if (pr?.comments.some((comment) => sameLogin(comment.authorLogin, login) && sameBody(comment.body, body))) {
        this.database.localCache.offlineActions.markOfflineActionSent(action.id);
        return true;
      }
    }
    if (action.payload.actionType === "pr_review") {
      const pr = this.database.localCache.githubWork.getPullRequest(action.repoId, action.entityNumber);
      const body = action.payload.body ?? "";
      if (body && pr?.reviews.some((review) => sameLogin(review.authorLogin, login) && sameBody(review.body, body))) {
        this.database.localCache.offlineActions.markOfflineActionSent(action.id);
        return true;
      }
    }
    return false;
  }

  private scheduleNextFlush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const summary = this.summary();
    if (summary.active === 0) return;
    const target = summary.nextAttemptAt ? Math.max(5_000, Date.parse(summary.nextAttemptAt) - Date.now()) : 60_000;
    const delay = Math.min(Math.max(target, 5_000), 60_000);
    this.timer = setTimeout(() => void this.flushDueActions("timer"), delay);
  }

  private changed(repoId?: string | null): void {
    this.events.onChanged(repoId);
  }
}

function classifyQueueFailure(error: unknown): {
  retryable: boolean;
  code: string;
  message: string;
  reason: OfflineActionQueueReason;
  resetAt?: string | null;
} {
  const code = errorCode(error, "github_write_failed");
  const message = queueFailureCopy(error);
  if (error instanceof GitHubApiError) {
    if (error.status === 429 || error.rateLimit?.remaining === 0 || /rate limit/i.test(error.body)) {
      return { retryable: true, code: "github_rate_limit", message, reason: "rate_limited", resetAt: error.rateLimit?.resetAt };
    }
    if (error.status >= 500 || error.status === 408) return { retryable: true, code, message, reason: "github_unavailable" };
    return { retryable: false, code, message, reason: "github_unavailable" };
  }
  if (isNetworkError(error)) return { retryable: true, code: "network_offline", message, reason: "network_error" };
  return { retryable: false, code, message, reason: "github_unavailable" };
}

function queueFailureCopy(error: unknown): string {
  const message = errorMessage(error);
  if (/rate limit|secondary rate|abuse/i.test(message))
    return "GitHub rate limited this write. Fallback will retry after the limit resets.";
  if (/offline|network|fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(message)) {
    return "Network failed while sending. Fallback will retry automatically.";
  }
  if (/403|permission|forbidden|resource not accessible|sso|scope/i.test(message)) {
    return "GitHub rejected permissions for this write. Check account access, token scopes, or organization SSO.";
  }
  return message;
}

function queueReasonCopy(reason: OfflineActionQueueReason): string {
  if (reason === "offline") return "Queued locally because this device is offline.";
  if (reason === "rate_limited") return "Queued locally until the GitHub rate limit resets.";
  if (reason === "network_error") return "Queued locally because the network request failed.";
  return "Queued locally because GitHub is unavailable or degraded.";
}

function nextAttemptAt(attemptCount: number, resetAt?: string | null): string {
  if (resetAt && Date.parse(resetAt) > Date.now()) return resetAt;
  const base = retryDelaysMs[Math.min(attemptCount, retryDelaysMs.length - 1)] ?? retryDelaysMs.at(-1)!;
  const jitter = Math.round(base * (Math.random() * 0.2));
  return new Date(Date.now() + base + jitter).toISOString();
}

function reviewEventLabel(event: SubmitPullRequestReviewInput["event"]): string {
  if (event === "APPROVE") return "Approve";
  if (event === "REQUEST_CHANGES") return "Request changes";
  return "Comment";
}

function sameLogin(left: string | null | undefined, right: string): boolean {
  return left?.toLowerCase() === right.toLowerCase();
}

function sameBody(left: string | null | undefined, right: string): boolean {
  return (left ?? "").trim() === right.trim();
}
