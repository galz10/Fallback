import type { WatchedRepo } from "../../../shared/domain/watched-repo";
import type { RepoCodeSummary } from "../../../shared/domain/repo-code";
import { BranchesView, ContributorsView, ReleasesView, TagsView } from "./RepoReferences";
import { RepoOverview } from "./RepoOverview";
import { FilesWorkflow } from "./FilesWorkflow";
import { CommitHistoryWorkflow } from "./CommitHistoryWorkflow";

export type RepoFileOpenTarget = { repoId: string; path: string; token: string };
export type CommitOpenTarget = { repoId: string; sha: string; token: string };

export function RepoCodeView({
  repo,
  activeTab,
  onTabChange,
  codeSummary,
  fileOpenTarget,
  commitOpenTarget,
  onLocalChangesCreated
}: {
  repo: WatchedRepo | null;
  activeTab: string;
  onTabChange: (tab: string) => void;
  codeSummary?: RepoCodeSummary;
  fileOpenTarget: RepoFileOpenTarget | null;
  commitOpenTarget: CommitOpenTarget | null;
  onLocalChangesCreated: (summary?: string) => void;
}) {
  if (!repo) {
    return (
      <div className="border border-neutral-800 rounded-lg p-12 bg-[#0A0A0A] text-center">
        <p className="text-neutral-400 text-lg font-medium mb-2">No repository selected</p>
        <p className="text-neutral-500 text-sm">Watch a repo to browse cached data.</p>
      </div>
    );
  }

  if (activeTab === "Files") {
    return (
      <FilesWorkflow repo={repo} codeSummary={codeSummary} fileOpenTarget={fileOpenTarget} onViewHistory={() => onTabChange("Commits")} />
    );
  }

  if (activeTab === "Overview") {
    return <RepoOverview repo={repo} codeSummary={codeSummary} />;
  }

  if (activeTab === "Commits") {
    return (
      <CommitHistoryWorkflow
        repo={repo}
        commits={codeSummary?.commits ?? []}
        commitOpenTarget={commitOpenTarget}
        onLocalChangesCreated={onLocalChangesCreated}
      />
    );
  }

  if (activeTab === "Branches") {
    return <BranchesView repo={repo} />;
  }

  if (activeTab === "Tags") {
    return <TagsView repo={repo} />;
  }

  if (activeTab === "Releases") {
    return <ReleasesView repo={repo} />;
  }

  if (activeTab === "Contributors") {
    return <ContributorsView repo={repo} />;
  }

  return (
    <div className="border border-neutral-800 rounded-lg p-12 bg-[#0A0A0A] text-center">
      <p className="text-neutral-400 text-lg font-medium mb-2">{activeTab}</p>
      <p className="text-neutral-500 text-sm">This view shows cached data when available.</p>
    </div>
  );
}
