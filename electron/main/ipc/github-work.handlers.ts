import { syncPriority } from "../../../src/shared/sync-policy.js";
import type {
  IssueListInput,
  SubmitPullRequestReviewInput,
  UpdatePullRequestReviewDraftInput
} from "../../../src/shared/domain/github-work.js";
import type { QueueAwareWritebackOptions } from "../github-work/offline-writeback-queue.js";
import type { WritebackSubmitResult } from "../../../src/shared/domain/offline-action.js";
import type { SyncActiveContext } from "../../../src/shared/domain/sync.js";
import type { AppServices } from "../app-services.js";
import { RepoOperationRunner } from "../modules/local-git/repo-operation-runner.js";
import { onAppEvent } from "./app-events.js";
import { assertNumber, assertString } from "./validation.js";
import { createIpcHandlerRegistrar } from "./ipc-handler-registry.js";

const dbListCacheTtlMs = 60_000;

export function registerGitHubWorkHandlers(services: AppServices): void {
  const ipc = createIpcHandlerRegistrar(services);
  const operations = new RepoOperationRunner(services);
  const dbListCache = new Map<string, { expiresAt: number; value: unknown }>();
  const cachedDbList = <T>(key: string, load: () => T): T => {
    const scopedKey = accountScopedCacheKey(services, key);
    const cached = dbListCache.get(scopedKey) as { expiresAt: number; value: T } | undefined;
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const value = load();
    dbListCache.set(scopedKey, { expiresAt: Date.now() + dbListCacheTtlMs, value });
    return value;
  };
  const clearRepoCache = (repoId?: string | null) => {
    if (!repoId) {
      dbListCache.clear();
      return;
    }
    for (const key of dbListCache.keys()) {
      if (key.endsWith(`:${repoId}`) || key.includes(`:${repoId}:`)) dbListCache.delete(key);
    }
    for (const key of dbListCache.keys()) {
      if (key.endsWith(":prs:mine") || key.endsWith(":issues:mine")) dbListCache.delete(key);
    }
  };
  onAppEvent((name, payload) => {
    if (name === "profile") {
      dbListCache.clear();
      return;
    }
    if (name === "repos" || name === "sync" || name === "notifications") clearRepoCache(payload.repoId);
  });

  ipc.handle("prsList", async (_event, repoId: string) => {
    const id = assertString(repoId, "Repo ID");
    services.database.localCache.repos.requireRepoVisibleToActiveAccount(id);
    return cachedDbList(`prs:${id}`, () => services.database.localCache.githubWork.listPullRequests(id));
  });
  ipc.handle("prsListMine", async () => cachedDbList("prs:mine", () => services.database.localCache.githubWork.listUserPullRequests()));
  ipc.handle("prsGet", async (_event, repoId: string, number: number) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) =>
      cachedDbList(`pr:${id}:${assertNumber(number, "Pull request number")}`, () =>
        services.database.localCache.githubWork.getPullRequest(id, assertNumber(number, "Pull request number"))
      )
    )
  );
  ipc.handle("prsGetDiff", async (_event, repoId: string, number: number) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) =>
      services.sync.pullRequestDiff(id, assertNumber(number, "Pull request number"))
    )
  );
  ipc.handle("prsAddComment", async (_event, repoId: string, number: number, body: string, options?: QueueAwareWritebackOptions) => {
    const id = assertString(repoId, "Repo ID");
    services.database.localCache.repos.requireRepoVisibleToActiveAccount(id);
    const prNumber = assertNumber(number, "Pull request number");
    return operations.run(
      id,
      "pr_comment",
      "normal",
      `Comment on PR #${prNumber}`,
      `POST /pulls/${prNumber}/comments`,
      () =>
        services.offlineWritebacks.submitPullRequestComment(
          id,
          prNumber,
          assertString(body, "Comment body"),
          normalizeWritebackOptions(options)
        ),
      false,
      undefined,
      writebackOperationPatch
    );
  });
  ipc.handle(
    "prsSubmitReview",
    async (_event, repoId: string, number: number, input: SubmitPullRequestReviewInput, options?: QueueAwareWritebackOptions) => {
      const id = assertString(repoId, "Repo ID");
      services.database.localCache.repos.requireRepoVisibleToActiveAccount(id);
      const prNumber = assertNumber(number, "Pull request number");
      return operations.run(
        id,
        "pr_review",
        "normal",
        `Submit review on PR #${prNumber}`,
        `POST /pulls/${prNumber}/reviews`,
        () => services.offlineWritebacks.submitPullRequestReview(id, prNumber, input, normalizeWritebackOptions(options)),
        false,
        undefined,
        writebackOperationPatch
      );
    }
  );
  ipc.handle("prsGetReviewDraft", async (_event, repoId: string, number: number) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) =>
      services.database.localCache.reviewDrafts.getPullRequestReviewDraft(id, assertNumber(number, "Pull request number"))
    )
  );
  ipc.handle("prsUpdateReviewDraft", async (_event, repoId: string, number: number, input: UpdatePullRequestReviewDraftInput) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) =>
      services.database.localCache.reviewDrafts.upsertPullRequestReviewDraft(id, assertNumber(number, "Pull request number"), input)
    )
  );
  ipc.handle("prsClearReviewDraft", async (_event, repoId: string, number: number, headSha?: string | null) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) =>
      services.database.localCache.reviewDrafts.clearPullRequestReviewDraft(id, assertNumber(number, "Pull request number"), headSha)
    )
  );
  ipc.handle("prsRefresh", async (_event, repoId: string, number: number) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) =>
      services.sync.syncPullRequest(id, assertNumber(number, "Pull request number"))
    )
  );
  ipc.handle("prsRefreshMine", async () =>
    services.sync.syncUserPullRequests({ priority: syncPriority.manual, reason: "manual_refresh", bypassCooldown: true })
  );

  ipc.handle("issuesList", async (_event, repoId: string, input?: IssueListInput) => {
    const id = assertString(repoId, "Repo ID");
    services.database.localCache.repos.requireRepoVisibleToActiveAccount(id);
    const options = normalizeIssueListInput(input);
    const cacheKey = `issues:${id}:${options.state ?? "all"}:${options.limit}:${options.offset}`;
    const countKey = `issues-count:${id}:${options.state ?? "all"}`;
    const items = cachedDbList(cacheKey, () => services.database.localCache.githubWork.listIssues(id, options));
    const total = cachedDbList(countKey, () => services.database.localCache.githubWork.countIssues(id, options));
    const issueTypes = cachedDbList(`issue-types:${id}`, () => services.database.localCache.githubWork.listIssueTypes(id));
    const issueFieldOptions = cachedDbList(`issue-field-options:${id}`, () =>
      services.database.localCache.githubWork.listIssueFieldOptions(id, ["priority", "effort"])
    );
    return {
      items,
      issueTypes,
      issueFieldOptions,
      total,
      limit: options.limit,
      offset: options.offset,
      hasMore: options.offset + items.length < total
    };
  });
  ipc.handle("issuesListMine", async () => cachedDbList("issues:mine", () => services.database.localCache.githubWork.listUserIssues()));
  ipc.handle("issuesGet", async (_event, repoId: string, number: number) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) =>
      cachedDbList(`issue:${id}:${assertNumber(number, "Issue number")}`, () =>
        services.database.localCache.githubWork.getIssue(id, assertNumber(number, "Issue number"))
      )
    )
  );
  ipc.handle("issuesAddComment", async (_event, repoId: string, number: number, body: string, options?: QueueAwareWritebackOptions) => {
    const id = assertString(repoId, "Repo ID");
    services.database.localCache.repos.requireRepoVisibleToActiveAccount(id);
    const issueNumber = assertNumber(number, "Issue number");
    return operations.run(
      id,
      "issue_comment",
      "normal",
      `Comment on issue #${issueNumber}`,
      `POST /issues/${issueNumber}/comments`,
      () =>
        services.offlineWritebacks.submitIssueComment(
          id,
          issueNumber,
          assertString(body, "Comment body"),
          normalizeWritebackOptions(options)
        ),
      false,
      undefined,
      writebackOperationPatch
    );
  });
  ipc.handle("issuesRefresh", async (_event, repoId: string, number: number) =>
    withVisibleRepo(services, assertString(repoId, "Repo ID"), (id) => services.sync.syncIssue(id, assertNumber(number, "Issue number")))
  );
  ipc.handle("commentsListRecent", async (_event, repoId: string) => {
    const id = assertString(repoId, "Repo ID");
    services.database.localCache.repos.requireRepoVisibleToActiveAccount(id);
    return cachedDbList(`comments:${id}`, () => services.database.localCache.githubWork.listRecentComments(id));
  });
  ipc.handle("actionsListChecks", async (_event, repoId: string) => {
    const id = assertString(repoId, "Repo ID");
    services.database.localCache.repos.requireRepoVisibleToActiveAccount(id);
    return cachedDbList(`checks:${id}`, () => services.database.localCache.githubWork.listActionChecks(id));
  });
  ipc.handle("actionsListWorkflowRuns", async (_event, repoId: string) => {
    const id = assertString(repoId, "Repo ID");
    services.database.localCache.repos.requireRepoVisibleToActiveAccount(id);
    return cachedDbList(`runs:${id}`, () => services.database.localCache.githubWork.listWorkflowRuns(id));
  });
  ipc.handle("syncSetActiveContext", async (_event, context: SyncActiveContext) => services.scheduler.setActiveContext(context));
}

function normalizeWritebackOptions(options: QueueAwareWritebackOptions | undefined): QueueAwareWritebackOptions {
  return { clientOnline: typeof options?.clientOnline === "boolean" ? options.clientOnline : undefined };
}

function writebackOperationPatch(result: WritebackSubmitResult) {
  if (result.mode === "sent") return { resultSummary: "Posted to GitHub." };
  return { resultSummary: "Queued locally. Fallback will send this when GitHub is reachable." };
}

function withVisibleRepo<T>(services: AppServices, repoId: string, load: (repoId: string) => T): T {
  services.database.localCache.repos.requireRepoVisibleToActiveAccount(repoId);
  return load(repoId);
}

function accountScopedCacheKey(services: AppServices, key: string): string {
  const account = services.database.localCache.accounts.getGitHubAccount();
  return `${account?.id ?? "anonymous"}:${key}`;
}

function normalizeIssueListInput(
  input: IssueListInput | undefined
): Required<Pick<IssueListInput, "limit" | "offset">> & Pick<IssueListInput, "state"> {
  const requestedLimit = Number(input?.limit ?? 250);
  const requestedOffset = Number(input?.offset ?? 0);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.floor(requestedLimit), 2_000)) : 250;
  const offset = Number.isFinite(requestedOffset) ? Math.max(0, Math.floor(requestedOffset)) : 0;
  const state = input?.state === "open" || input?.state === "closed" || input?.state === "all" ? input.state : "open";
  return { limit, offset, state };
}
