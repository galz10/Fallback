import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Surface } from "../../components/ui";
import { Badge } from "../../components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Separator } from "../../components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import type { AuthState } from "../../../shared/domain/auth";
import type { WatchedRepo } from "../../../shared/domain/watched-repo";
import type { PullRequestDetail, TimelineComment } from "../../../shared/domain/github-work";
import { triagePullRequest } from "../../../shared/triage";
import { CacheTimestamp, type CacheStampState } from "../../components/CacheTimestamp";
import { SignalBadge } from "../../components/SignalBadge";
import { checkLabel, checkTone, LabelChips, reviewLabel, reviewTone } from "./EntityRows";
import { MarkdownBody, githubRepoUrlFromEntityUrl } from "./MarkdownBody";
import { PullRequestDiffView } from "./PullRequestDiffView";
import { parsePatchFilesForView } from "../../diffs/patch-files";
import { compactCount, formatRelative } from "../../lib/format";
import {
  ConversationComment,
  ConversationFilterItem,
  EntityStateDot,
  GitHubCommentComposer,
  isAutomatedComment,
  prUnderlineTabClass,
  QueuedWritebackRows,
  timestamp,
  useNetworkOnline
} from "./GitHubConversation";

export function PRDetailView({
  repoId,
  prNumber,
  auth,
  repo,
  onBack: _onBack,
  backLabel: _backLabel = "Pull requests"
}: {
  repoId: string | null;
  prNumber: number;
  auth: AuthState;
  repo?: WatchedRepo | null;
  onBack: () => void;
  backLabel?: string;
}) {
  const queryClient = useQueryClient();
  const [activePrTab, setActivePrTab] = useState<"activity" | "changes">("activity");
  const [conversationRailOpen, setConversationRailOpen] = useState(true);
  const [conversationSheetOpen, setConversationSheetOpen] = useState(false);
  const online = useNetworkOnline();
  const { data: pr } = useQuery({
    queryKey: ["prDetail", repoId, prNumber],
    queryFn: () => window.fallback.prs.get(repoId!, prNumber),
    enabled: Boolean(repoId && prNumber)
  });
  const refreshPr = useMutation({
    mutationFn: () => window.fallback.prs.refresh(repoId!, prNumber),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["prDetail", repoId, prNumber] }),
        queryClient.invalidateQueries({ queryKey: ["prs", repoId] }),
        queryClient.invalidateQueries({ queryKey: ["myPrs"] })
      ]);
    }
  });
  const {
    data: prDiff,
    error: diffError,
    isFetching: diffFetching
  } = useQuery({
    queryKey: ["prDiff", repoId, prNumber],
    queryFn: () => window.fallback.prs.getDiff(repoId!, prNumber),
    enabled: Boolean(repoId && prNumber && activePrTab === "changes"),
    staleTime: 60_000
  });
  const diffCacheWarming = Boolean(activePrTab === "changes" && prDiff?.fromCache && !prDiff.cachedAt && prDiff.patch.trim().length === 0);

  const patchFiles = useMemo(
    () =>
      activePrTab === "changes"
        ? parsePatchFilesForView(
            prDiff?.patch ?? "",
            `pr:${repoId ?? "unknown"}:${pr?.number ?? prNumber}:${pr?.headSha ?? prDiff?.cachedAt ?? "cached"}`
          )
        : [],
    [activePrTab, pr?.headSha, pr?.number, prDiff?.cachedAt, prDiff?.patch, prNumber, repoId]
  );

  if (!pr) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <button
          onClick={_onBack}
          className="h-8 inline-flex items-center text-neutral-400 hover:text-neutral-200 text-[13px] bg-neutral-900 border border-neutral-800 px-3 rounded-md transition-colors cursor-pointer"
        >
          ← Back
        </button>
        <div className="mt-8 text-center text-neutral-500">Loading PR #{prNumber}...</div>
      </div>
    );
  }

  const login = auth.status === "connected" ? auth.login : undefined;
  return (
    <div className="flex-1 overflow-hidden w-full bg-[#050506] text-[#d7d7da]">
      <div className="h-full overflow-y-auto">
        <div className="sticky top-0 z-10 flex h-[58px] items-end justify-between border-b border-white/[0.08] bg-[#050506]/95 px-7 backdrop-blur">
          <div className="flex h-full items-end gap-7">
            <button
              onClick={_onBack}
              className="mb-[17px] -ml-1 rounded-md px-2 py-1 text-sm font-medium text-neutral-500 transition-colors hover:bg-white/[0.04] hover:text-neutral-200"
            >
              ← {_backLabel}
            </button>
            <button onClick={() => setActivePrTab("activity")} className={prUnderlineTabClass(activePrTab === "activity")}>
              Activity
            </button>
            <button onClick={() => setActivePrTab("changes")} className={prUnderlineTabClass(activePrTab === "changes")}>
              Changes
            </button>
          </div>
          <div className="mb-[17px] flex items-center gap-3">
            {activePrTab === "changes" && <div className="hidden text-xs text-neutral-600 md:block">Select code lines to comment</div>}
            <button
              type="button"
              onClick={() => {
                if (activePrTab === "activity") {
                  setConversationRailOpen((open) => !open);
                  return;
                }
                setConversationSheetOpen(true);
              }}
              className="hidden rounded-md px-2 py-1 text-sm font-medium text-neutral-500 transition-colors hover:bg-white/[0.04] hover:text-neutral-200 lg:inline-flex"
            >
              {activePrTab === "activity" && conversationRailOpen ? "Hide conversation" : "Conversation"}
            </button>
            <button
              type="button"
              onClick={() => setConversationSheetOpen(true)}
              className="rounded-md px-2 py-1 text-sm font-medium text-neutral-500 transition-colors hover:bg-white/[0.04] hover:text-neutral-200 lg:hidden"
            >
              Conversation
            </button>
            <button
              type="button"
              onClick={() => refreshPr.mutate()}
              disabled={refreshPr.isPending}
              className="rounded-md px-2 py-1 text-sm font-medium text-neutral-500 transition-colors hover:bg-white/[0.04] hover:text-neutral-200 disabled:opacity-50"
            >
              {refreshPr.isPending ? "Refreshing..." : "Refresh PR"}
            </button>
          </div>
        </div>

        {activePrTab === "changes" && <PullRequestStatusHeader pr={pr} login={login} online={online} />}

        {activePrTab === "activity" && (
          <PullRequestActivityView
            pr={pr}
            repoId={repoId!}
            login={login}
            online={online}
            conversationRailOpen={conversationRailOpen}
            onOpenConversation={() => setConversationSheetOpen(true)}
          />
        )}

        {activePrTab === "changes" && (
          <PullRequestDiffView
            diff={prDiff}
            pr={pr}
            files={patchFiles}
            error={diffError}
            login={login}
            repo={repo}
            isFetching={diffFetching}
            isCacheWarming={diffCacheWarming}
          />
        )}
      </div>
      <PullRequestConversationSheet
        open={conversationSheetOpen}
        onOpenChange={setConversationSheetOpen}
        pr={pr}
        repoId={repoId!}
        login={login}
        online={online}
      />
    </div>
  );
}

function PullRequestStatusHeader({ pr, login, online }: { pr: PullRequestDetail; login?: string; online: boolean }) {
  const triage = triagePullRequest(pr, login);
  const cacheState: CacheStampState = online ? "cached" : "offline-cached";
  return (
    <div className="border-b border-white/[0.06] bg-black/40 px-7 py-3">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 text-xs">
        <SignalBadge tone={checkTone(pr.checkState)}>{checkLabel(pr.checkState, pr.checkCount)}</SignalBadge>
        <SignalBadge tone={reviewTone(triage.reviewSignal)}>{reviewLabel(triage.reviewSignal)}</SignalBadge>
        {pr.assigneeLogins.length > 0 && <span className="text-neutral-500">{compactCount(pr.assigneeLogins.length)} assignee</span>}
        {pr.requestedReviewerLogins.length > 0 && (
          <span className="text-neutral-500">{compactCount(pr.requestedReviewerLogins.length)} requested reviewer</span>
        )}
        <span className="text-neutral-600">{pr.updatedAt ? `updated ${formatRelative(pr.updatedAt)}` : "update unknown"}</span>
        <CacheTimestamp cachedAt={pr.lastSyncedAt} state={cacheState} />
        {pr.htmlUrl && (
          <button
            type="button"
            onClick={() => void window.fallback.shell.openExternal(pr.htmlUrl!)}
            className="ml-auto rounded-md px-2 py-1 text-neutral-500 transition-colors hover:bg-white/[0.04] hover:text-neutral-200"
          >
            Open on GitHub
          </button>
        )}
      </div>
      <div className="mx-auto mt-2 max-w-5xl">
        <LabelChips labels={pr.labels} />
      </div>
    </div>
  );
}

function PullRequestActivityView({
  pr,
  repoId,
  login,
  online,
  conversationRailOpen,
  onOpenConversation
}: {
  pr: PullRequestDetail;
  repoId: string;
  login?: string;
  online: boolean;
  conversationRailOpen: boolean;
  onOpenConversation: () => void;
}) {
  const cacheState: CacheStampState = online ? "cached" : "offline-cached";
  const repoUrl = githubRepoUrlFromEntityUrl(pr.htmlUrl);
  const triage = triagePullRequest(pr, login);
  const commentCount = pr.comments.length + pr.reviewComments.length;

  return (
    <div
      className={`mx-auto grid max-w-[1480px] gap-6 px-6 py-8 ${
        conversationRailOpen ? "lg:grid-cols-[minmax(0,1fr)_minmax(390px,460px)]" : "lg:max-w-5xl"
      }`}
    >
      <div className="min-w-0 space-y-6">
        <Surface tone="elevated" className="overflow-hidden border-border bg-background-100 shadow-border-small">
          <div className="px-6 py-5">
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <EntityStateDot state={pr.merged ? "merged" : pr.state} kind="pr" />
              <span>
                <span className="font-medium text-foreground">{pr.authorLogin ?? "unknown"}</span>
                {pr.createdAt ? ` opened ${formatRelative(pr.createdAt)}` : " opened this pull request"}
              </span>
              <span className="text-muted-foreground/50">·</span>
              <button
                type="button"
                onClick={onOpenConversation}
                className="rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {compactCount(commentCount)} comments
              </button>
              <span className="text-muted-foreground/50">·</span>
              <CacheTimestamp cachedAt={pr.lastSyncedAt} state={cacheState} />
            </div>
            <h1 className="mt-4 max-w-5xl text-[32px] font-semibold leading-[1.12] tracking-tight text-foreground">
              {pr.title} <span className="font-light text-muted-foreground">#{pr.number}</span>
            </h1>
            <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
              <SignalBadge tone={checkTone(pr.checkState)}>{checkLabel(pr.checkState, pr.checkCount)}</SignalBadge>
              <SignalBadge tone={reviewTone(triage.reviewSignal)}>{reviewLabel(triage.reviewSignal)}</SignalBadge>
              {pr.assigneeLogins.length > 0 && <Badge variant="outline">{compactCount(pr.assigneeLogins.length)} assignee</Badge>}
              {pr.requestedReviewerLogins.length > 0 && (
                <Badge variant="outline">{compactCount(pr.requestedReviewerLogins.length)} requested reviewer</Badge>
              )}
              <span className="text-muted-foreground">{pr.updatedAt ? `updated ${formatRelative(pr.updatedAt)}` : "update unknown"}</span>
              {pr.htmlUrl && (
                <button
                  type="button"
                  onClick={() => void window.fallback.shell.openExternal(pr.htmlUrl!)}
                  className="ml-auto rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  Open on GitHub
                </button>
              )}
            </div>
            <LabelChips labels={pr.labels} />
          </div>
          <Separator />
          <div className="px-6 py-6">
            <MarkdownBody value={pr.body} empty="No description cached." repoUrl={repoUrl} />
          </div>
        </Surface>
      </div>

      {conversationRailOpen && (
        <aside className="hidden min-w-0 lg:block">
          <PullRequestConversationPanel pr={pr} repoId={repoId} login={login} online={online} mode="rail" />
        </aside>
      )}
    </div>
  );
}

type PullRequestConversationFilter = "all" | "people" | "bots" | "files";
type PullRequestConversationItem = { kind: "comment" | "review-comment"; comment: TimelineComment };

function pullRequestConversationItems(pr: PullRequestDetail): PullRequestConversationItem[] {
  return [
    ...pr.comments.map((comment) => ({ kind: "comment" as const, comment })),
    ...pr.reviewComments.map((comment) => ({ kind: "review-comment" as const, comment }))
  ].sort((a, b) => timestamp(a.comment.createdAt) - timestamp(b.comment.createdAt));
}

function isFileConversationItem(item: PullRequestConversationItem): boolean {
  return item.kind === "review-comment";
}

function filterConversationItems(
  items: PullRequestConversationItem[],
  filter: PullRequestConversationFilter
): PullRequestConversationItem[] {
  if (filter === "people") return items.filter((item) => !isAutomatedComment(item.comment) && !isFileConversationItem(item));
  if (filter === "bots") return items.filter((item) => isAutomatedComment(item.comment));
  if (filter === "files") return items.filter(isFileConversationItem);
  return items.filter((item) => !isAutomatedComment(item.comment));
}

function PullRequestConversationSheet({
  open,
  onOpenChange,
  pr,
  repoId,
  login,
  online
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pr: PullRequestDetail;
  repoId: string;
  login?: string;
  online: boolean;
}) {
  const commentCount = pr.comments.length + pr.reviewComments.length;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[min(92vw,540px)] gap-0 border-border bg-background-100 p-0 sm:max-w-none">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle>Conversation</SheetTitle>
          <SheetDescription>
            {compactCount(commentCount)} comments on #{pr.number}
          </SheetDescription>
        </SheetHeader>
        <PullRequestConversationPanel pr={pr} repoId={repoId} login={login} online={online} mode="sheet" />
      </SheetContent>
    </Sheet>
  );
}

function PullRequestConversationPanel({
  pr,
  repoId,
  login,
  online,
  mode = "rail"
}: {
  pr: PullRequestDetail;
  repoId: string;
  login?: string;
  online: boolean;
  mode?: "rail" | "sheet";
}) {
  const items = pullRequestConversationItems(pr);
  const [expandedCommentIds, setExpandedCommentIds] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState<PullRequestConversationFilter>("all");
  const [botUpdatesOpen, setBotUpdatesOpen] = useState(false);
  const cacheState: CacheStampState = online ? "cached" : "offline-cached";
  const repoUrl = githubRepoUrlFromEntityUrl(pr.htmlUrl);
  const commentCount = items.length;
  const peopleCount = items.filter((item) => !isAutomatedComment(item.comment) && !isFileConversationItem(item)).length;
  const botItems = items.filter((item) => isAutomatedComment(item.comment));
  const fileCount = items.filter(isFileConversationItem).length;
  const visibleItems = filterConversationItems(items, filter);
  const showBotGroup = filter === "all" && botItems.length > 0;
  const feedEmpty = visibleItems.length === 0 && !showBotGroup;
  const frameClass =
    mode === "sheet"
      ? "flex h-full min-h-0 flex-col overflow-hidden border-0 bg-transparent shadow-none"
      : "sticky top-[82px] flex h-[calc(100vh-152px)] min-h-0 flex-col overflow-hidden rounded-none border-0 bg-transparent shadow-none";

  return (
    <Surface tone="elevated" className={frameClass}>
      {mode === "rail" && (
        <div className="flex items-center justify-between gap-3 border-b border-border px-1 pb-3">
          <div>
            <div className="text-sm font-semibold text-foreground">Conversation</div>
            <div className="text-xs text-muted-foreground">
              {commentCount === 0 ? "No discussion yet" : `${compactCount(commentCount)} comments`}
            </div>
          </div>
          <Badge variant="outline">{compactCount(commentCount)}</Badge>
        </div>
      )}
      <div className={mode === "sheet" ? "border-b border-border px-3 py-2" : "border-b border-border py-2 pr-1"}>
        <div className="flex max-w-full items-center gap-3 overflow-x-auto text-xs" role="tablist" aria-label="Conversation filter">
          <ConversationFilterItem value="all" count={commentCount} active={filter === "all"} onSelect={setFilter}>
            All
          </ConversationFilterItem>
          <ConversationFilterItem value="people" count={peopleCount} active={filter === "people"} onSelect={setFilter}>
            People
          </ConversationFilterItem>
          <ConversationFilterItem value="bots" count={botItems.length} active={filter === "bots"} onSelect={setFilter}>
            Bots
          </ConversationFilterItem>
          <ConversationFilterItem value="files" count={fileCount} active={filter === "files"} onSelect={setFilter}>
            Files
          </ConversationFilterItem>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1 basis-0">
        <div className={mode === "sheet" ? "space-y-3 p-3" : "space-y-3 py-3 pr-3"}>
          <QueuedWritebackRows repoId={repoId} entityType="pull_request" number={pr.number} />
          {feedEmpty ? (
            <div className="rounded-lg border border-dashed border-border bg-background-200 px-4 py-8 text-center text-sm text-muted-foreground">
              {items.length === 0 ? "No conversation yet. The PR brief is ready on the left." : "No comments match this filter."}
            </div>
          ) : (
            visibleItems.map(({ kind, comment }) => (
              <ConversationComment
                key={comment.id}
                kind={kind}
                comment={comment}
                cacheState={cacheState}
                cachedAt={pr.lastSyncedAt}
                repoUrl={repoUrl}
                compact={!expandedCommentIds.has(comment.id)}
                expanded={expandedCommentIds.has(comment.id)}
                onToggleExpanded={() =>
                  setExpandedCommentIds((current) => {
                    const next = new Set(current);
                    if (next.has(comment.id)) next.delete(comment.id);
                    else next.add(comment.id);
                    return next;
                  })
                }
              />
            ))
          )}
          {showBotGroup && (
            <Collapsible
              open={botUpdatesOpen}
              onOpenChange={setBotUpdatesOpen}
              className="rounded-lg border border-border bg-background-100"
            >
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <div>
                  <div className="text-sm font-medium text-foreground">Bot updates</div>
                  <div className="text-xs text-muted-foreground">
                    {compactCount(botItems.length)} automated {botItems.length === 1 ? "comment" : "comments"}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">{botUpdatesOpen ? "Hide" : "Show"}</span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t border-border px-3 py-2">
                  <div className="space-y-2">
                    {botItems.map(({ kind, comment }) => (
                      <ConversationComment
                        key={comment.id}
                        kind={kind}
                        comment={comment}
                        cacheState={cacheState}
                        cachedAt={pr.lastSyncedAt}
                        repoUrl={repoUrl}
                        compact={!expandedCommentIds.has(comment.id)}
                        expanded={expandedCommentIds.has(comment.id)}
                        onToggleExpanded={() =>
                          setExpandedCommentIds((current) => {
                            const next = new Set(current);
                            if (next.has(comment.id)) next.delete(comment.id);
                            else next.add(comment.id);
                            return next;
                          })
                        }
                      />
                    ))}
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      </ScrollArea>
      <Separator />
      <GitHubCommentComposer repoId={repoId} number={pr.number} login={login} kind="pull_request" variant="panel" />
    </Surface>
  );
}
