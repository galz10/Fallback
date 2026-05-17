import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuthState } from "../../../shared/domain/auth";
import type { IssueDetail, TimelineComment } from "../../../shared/domain/github-work";
import { triageIssue } from "../../../shared/triage";
import { CacheTimestamp, type CacheStampState } from "../../components/CacheTimestamp";
import { SignalBadge } from "../../components/SignalBadge";
import { Badge } from "../../components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Separator } from "../../components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { Surface } from "../../components/ui";
import { compactCount, formatRelative } from "../../lib/format";
import { LabelChips } from "./EntityRows";
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
import { githubRepoUrlFromEntityUrl, MarkdownBody } from "./MarkdownBody";

export function IssueDetailView({
  repoId,
  issueNumber,
  auth,
  onBack,
  backLabel = "Issues"
}: {
  repoId: string | null;
  issueNumber: number;
  auth: AuthState;
  onBack: () => void;
  backLabel?: string;
}) {
  const queryClient = useQueryClient();
  const [conversationRailOpen, setConversationRailOpen] = useState(true);
  const [conversationSheetOpen, setConversationSheetOpen] = useState(false);
  const online = useNetworkOnline();
  const { data: issue } = useQuery({
    queryKey: ["issueDetail", repoId, issueNumber],
    queryFn: () => window.fallback.issues.get(repoId!, issueNumber),
    enabled: Boolean(repoId && issueNumber)
  });
  const refreshIssue = useMutation({
    mutationFn: () => window.fallback.issues.refresh(repoId!, issueNumber),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["issueDetail", repoId, issueNumber] }),
        queryClient.invalidateQueries({ queryKey: ["issues", repoId] }),
        queryClient.invalidateQueries({ queryKey: ["myIssues"] })
      ]);
    }
  });
  const login = auth.status === "connected" ? auth.login : undefined;

  if (!issue) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <button
          onClick={onBack}
          className="h-8 inline-flex items-center text-neutral-400 hover:text-neutral-200 text-[13px] bg-neutral-900 border border-neutral-800 px-3 rounded-md transition-colors cursor-pointer"
        >
          ← Back
        </button>
        <div className="mt-8 text-center text-neutral-500">Loading issue #{issueNumber}...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden w-full bg-[#050506] text-[#d7d7da]">
      <div className="h-full overflow-y-auto">
        <div className="sticky top-0 z-10 flex h-[58px] items-end justify-between border-b border-white/[0.08] bg-[#050506]/95 px-7 backdrop-blur">
          <div className="flex h-full items-end gap-7">
            <button
              onClick={onBack}
              className="mb-[17px] -ml-1 rounded-md px-2 py-1 text-sm font-medium text-neutral-500 transition-colors hover:bg-white/[0.04] hover:text-neutral-200"
            >
              ← {backLabel}
            </button>
            <button className={prUnderlineTabClass(true)}>Conversation</button>
          </div>
          <div className="mb-[17px] flex items-center gap-3">
            <button
              type="button"
              onClick={() => setConversationRailOpen((open) => !open)}
              className="hidden rounded-md px-2 py-1 text-sm font-medium text-neutral-500 transition-colors hover:bg-white/[0.04] hover:text-neutral-200 lg:inline-flex"
            >
              {conversationRailOpen ? "Hide conversation" : "Conversation"}
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
              onClick={() => refreshIssue.mutate()}
              disabled={refreshIssue.isPending}
              className="rounded-md px-2 py-1 text-sm font-medium text-neutral-500 transition-colors hover:bg-white/[0.04] hover:text-neutral-200 disabled:opacity-50"
            >
              {refreshIssue.isPending ? "Refreshing..." : "Refresh issue"}
            </button>
          </div>
        </div>

        <IssueActivityView
          issue={issue}
          repoId={repoId!}
          login={login}
          online={online}
          conversationRailOpen={conversationRailOpen}
          onOpenConversation={() => setConversationSheetOpen(true)}
        />
      </div>
      <IssueConversationSheet
        open={conversationSheetOpen}
        onOpenChange={setConversationSheetOpen}
        issue={issue}
        repoId={repoId!}
        login={login}
        online={online}
      />
    </div>
  );
}

function IssueActivityView({
  issue,
  repoId,
  login,
  online,
  conversationRailOpen,
  onOpenConversation
}: {
  issue: IssueDetail;
  repoId: string;
  login?: string;
  online: boolean;
  conversationRailOpen: boolean;
  onOpenConversation: () => void;
}) {
  const triage = triageIssue(issue, login);
  const cacheState: CacheStampState = online ? "cached" : "offline-cached";
  const repoUrl = githubRepoUrlFromEntityUrl(issue.htmlUrl);
  const commentCount = issue.commentsCount ?? issue.comments.length;

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
              <EntityStateDot state={issue.state} kind="issue" />
              <span>
                <span className="font-medium text-foreground">{issue.authorLogin ?? "unknown"}</span>
                {issue.createdAt ? ` opened ${formatRelative(issue.createdAt)}` : " opened this issue"}
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
              <CacheTimestamp cachedAt={issue.lastSyncedAt} state={cacheState} />
            </div>
            <h1 className="mt-4 max-w-5xl text-[32px] font-semibold leading-[1.12] tracking-tight text-foreground">
              {issue.title} <span className="font-light text-muted-foreground">#{issue.number}</span>
            </h1>
            <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
              {triage.attentionReason && <SignalBadge tone="warn">{triage.attentionReason}</SignalBadge>}
              {issue.assigneeLogins.length > 0 ? (
                <Badge variant="outline">{compactCount(issue.assigneeLogins.length)} assignee</Badge>
              ) : (
                <Badge variant="outline">Unassigned</Badge>
              )}
              <span className="text-muted-foreground">
                {issue.updatedAt ? `updated ${formatRelative(issue.updatedAt)}` : "update unknown"}
              </span>
              {issue.htmlUrl && (
                <button
                  type="button"
                  onClick={() => void window.fallback.shell.openExternal(issue.htmlUrl!)}
                  className="ml-auto rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  Open on GitHub
                </button>
              )}
            </div>
            <LabelChips labels={issue.labels} />
          </div>
          <Separator />
          <div className="px-6 py-6">
            <MarkdownBody value={issue.body} empty="No description cached." repoUrl={repoUrl} />
          </div>
        </Surface>
      </div>

      {conversationRailOpen && (
        <aside className="hidden min-w-0 lg:block">
          <IssueConversationPanel issue={issue} repoId={repoId} login={login} online={online} mode="rail" />
        </aside>
      )}
    </div>
  );
}

type IssueConversationFilter = "all" | "people" | "bots";

function filterIssueConversationComments(comments: TimelineComment[], filter: IssueConversationFilter): TimelineComment[] {
  if (filter === "people") return comments.filter((comment) => !isAutomatedComment(comment));
  if (filter === "bots") return comments.filter(isAutomatedComment);
  return comments.filter((comment) => !isAutomatedComment(comment));
}

function IssueConversationSheet({
  open,
  onOpenChange,
  issue,
  repoId,
  login,
  online
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issue: IssueDetail;
  repoId: string;
  login?: string;
  online: boolean;
}) {
  const commentCount = issue.commentsCount ?? issue.comments.length;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[min(92vw,540px)] gap-0 border-border bg-background-100 p-0 sm:max-w-none">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle>Conversation</SheetTitle>
          <SheetDescription>
            {compactCount(commentCount)} comments on #{issue.number}
          </SheetDescription>
        </SheetHeader>
        <IssueConversationPanel issue={issue} repoId={repoId} login={login} online={online} mode="sheet" />
      </SheetContent>
    </Sheet>
  );
}

function IssueConversationPanel({
  issue,
  repoId,
  login,
  online,
  mode = "rail"
}: {
  issue: IssueDetail;
  repoId: string;
  login?: string;
  online: boolean;
  mode?: "rail" | "sheet";
}) {
  const comments = useMemo(() => [...issue.comments].sort((a, b) => timestamp(a.createdAt) - timestamp(b.createdAt)), [issue.comments]);
  const [expandedCommentIds, setExpandedCommentIds] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState<IssueConversationFilter>("all");
  const [botUpdatesOpen, setBotUpdatesOpen] = useState(false);
  const cacheState: CacheStampState = online ? "cached" : "offline-cached";
  const repoUrl = githubRepoUrlFromEntityUrl(issue.htmlUrl);
  const commentCount = comments.length;
  const peopleCount = comments.filter((comment) => !isAutomatedComment(comment)).length;
  const botComments = comments.filter(isAutomatedComment);
  const visibleComments = filterIssueConversationComments(comments, filter);
  const showBotGroup = filter === "all" && botComments.length > 0;
  const feedEmpty = visibleComments.length === 0 && !showBotGroup;
  const frameClass =
    mode === "sheet"
      ? "flex h-full min-h-0 flex-col overflow-hidden border-0 bg-transparent shadow-none"
      : "sticky top-[82px] flex h-[calc(100vh-152px)] min-h-0 flex-col overflow-hidden rounded-none border-0 bg-transparent shadow-none";
  const toggleComment = (commentId: string) =>
    setExpandedCommentIds((current) => {
      const next = new Set(current);
      if (next.has(commentId)) next.delete(commentId);
      else next.add(commentId);
      return next;
    });

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
          <ConversationFilterItem value="bots" count={botComments.length} active={filter === "bots"} onSelect={setFilter}>
            Bots
          </ConversationFilterItem>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1 basis-0">
        <div className={mode === "sheet" ? "space-y-3 p-3" : "space-y-3 py-3 pr-3"}>
          <QueuedWritebackRows repoId={repoId} entityType="issue" number={issue.number} />
          {feedEmpty ? (
            <div className="rounded-lg border border-dashed border-border bg-background-200 px-4 py-8 text-center text-sm text-muted-foreground">
              {comments.length === 0 ? "No conversation yet. The issue brief is ready on the left." : "No comments match this filter."}
            </div>
          ) : (
            visibleComments.map((comment) => (
              <ConversationComment
                key={comment.id}
                kind="comment"
                comment={comment}
                cacheState={cacheState}
                cachedAt={issue.lastSyncedAt}
                repoUrl={repoUrl}
                compact={!expandedCommentIds.has(comment.id)}
                expanded={expandedCommentIds.has(comment.id)}
                onToggleExpanded={() => toggleComment(comment.id)}
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
                    {compactCount(botComments.length)} automated {botComments.length === 1 ? "comment" : "comments"}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">{botUpdatesOpen ? "Hide" : "Show"}</span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t border-border px-3 py-2">
                  <div className="space-y-2">
                    {botComments.map((comment) => (
                      <ConversationComment
                        key={comment.id}
                        kind="comment"
                        comment={comment}
                        cacheState={cacheState}
                        cachedAt={issue.lastSyncedAt}
                        repoUrl={repoUrl}
                        compact={!expandedCommentIds.has(comment.id)}
                        expanded={expandedCommentIds.has(comment.id)}
                        onToggleExpanded={() => toggleComment(comment.id)}
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
      <GitHubCommentComposer repoId={repoId} number={issue.number} login={login} kind="issue" variant="panel" />
    </Surface>
  );
}
