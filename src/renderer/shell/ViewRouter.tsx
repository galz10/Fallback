import type { AuthState } from "../../shared/domain/auth";
import type { WatchedRepo } from "../../shared/domain/watched-repo";
import type { RepoCodeSummary } from "../../shared/domain/repo-code";
import type { LocalChangesState } from "../../shared/domain/local-git";
import type { CommitOpenTarget, RepoFileOpenTarget } from "../features/repo-code/RepoCodeView";
import { countLabel } from "../lib/format";
import type { AppView } from "../state/navigation-store";
import { useShellComponents } from "./shell-components";

type WorkTarget = { repoId: string; number: number };
type CommitPrefill = { repoId: string; summary: string; token: string };

export function ViewRouter({
  activeTab,
  auth,
  codeSummary,
  commitOpenTarget,
  issueQuery,
  localChanges,
  localChangesCommitPrefill,
  localChangesError,
  localChangesFetching,
  onOpenRepoCode,
  pullRequestQuery,
  repoFileOpenTarget,
  repos,
  reposPending,
  selectedIssueNumber,
  selectedMyIssue,
  selectedMyPr,
  selectedPrNumber,
  selectedRepo,
  selectedRepoId,
  setActiveTab,
  setIssueQuery,
  setLocalChangesCommitPrefill,
  setPullRequestQuery,
  setSelectedIssueNumber,
  setSelectedMyIssue,
  setSelectedMyPr,
  setSelectedPrNumber,
  setView,
  view
}: {
  activeTab: string;
  auth: AuthState;
  codeSummary?: RepoCodeSummary;
  commitOpenTarget: CommitOpenTarget | null;
  issueQuery: string;
  localChanges?: LocalChangesState;
  localChangesCommitPrefill: CommitPrefill | null;
  localChangesError: unknown;
  localChangesFetching: boolean;
  onOpenRepoCode: (repoId: string) => void;
  pullRequestQuery: string;
  repoFileOpenTarget: RepoFileOpenTarget | null;
  repos: WatchedRepo[];
  reposPending: boolean;
  selectedIssueNumber: number | null;
  selectedMyIssue: WorkTarget | null;
  selectedMyPr: WorkTarget | null;
  selectedPrNumber: number | null;
  selectedRepo: WatchedRepo | null;
  selectedRepoId: string | null;
  setActiveTab: (tab: string) => void;
  setIssueQuery: (query: string) => void;
  setLocalChangesCommitPrefill: (prefill: CommitPrefill | null) => void;
  setPullRequestQuery: (query: string) => void;
  setSelectedIssueNumber: (number: number | null) => void;
  setSelectedMyIssue: (target: WorkTarget | null) => void;
  setSelectedMyPr: (target: WorkTarget | null) => void;
  setSelectedPrNumber: (number: number | null) => void;
  setView: (view: AppView) => void;
  view: AppView;
}) {
  const {
    ActionsView,
    BranchIntegrityView,
    HomeView,
    IssueDetailView,
    IssueListView,
    LocalChangesView,
    MyWorkView,
    PRDetailView,
    PullRequestListView,
    RepoCodeView,
    SettingsView,
    StatusView
  } = useShellComponents();

  if (view === "home") {
    return <HomeView repos={repos} reposPending={reposPending} onRepoClick={onOpenRepoCode} />;
  }

  if (view === "Pull requests" && selectedPrNumber) {
    return (
      <PRDetailView
        repoId={selectedRepoId}
        prNumber={selectedPrNumber}
        auth={auth}
        repo={selectedRepo}
        onBack={() => setSelectedPrNumber(null)}
      />
    );
  }

  if (view === "My Work") {
    if (selectedMyPr) {
      return (
        <PRDetailView
          repoId={selectedMyPr.repoId}
          prNumber={selectedMyPr.number}
          auth={auth}
          repo={repos.find((repo) => repo.id === selectedMyPr.repoId) ?? null}
          onBack={() => setSelectedMyPr(null)}
          backLabel="My Work"
        />
      );
    }
    if (selectedMyIssue) {
      return (
        <IssueDetailView
          repoId={selectedMyIssue.repoId}
          issueNumber={selectedMyIssue.number}
          auth={auth}
          onBack={() => setSelectedMyIssue(null)}
          backLabel="My Work"
        />
      );
    }
    return <MyWorkView auth={auth} onIssueClick={setSelectedMyIssue} onPrClick={setSelectedMyPr} />;
  }

  if (view === "Issues" && selectedIssueNumber) {
    return (
      <IssueDetailView repoId={selectedRepoId} issueNumber={selectedIssueNumber} auth={auth} onBack={() => setSelectedIssueNumber(null)} />
    );
  }

  if (view === "Settings") return <SettingsView />;
  if (view === "Status") return <StatusView />;

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      {view === "Code" && (
        <div className="shrink-0 border-b border-neutral-800/80 bg-black">
          <div role="tablist" aria-label="Repository sections" className="flex h-12 gap-6 overflow-x-auto px-6 py-0 text-muted-foreground">
            {["Files", "Commits", "Branches", "Tags", "Releases", "Contributors"].map((tab) => {
              const counts: Record<string, string> = {
                Commits: countLabel(codeSummary?.commits.length, codeSummary?.commits.length === 100),
                Branches: countLabel(codeSummary?.branchCount),
                Tags: countLabel(codeSummary?.tagCount, codeSummary?.tagCount === 100),
                Releases: countLabel(codeSummary?.releaseCount, codeSummary?.releaseCount === 100),
                Contributors: countLabel(codeSummary?.contributorCount, codeSummary?.contributorCount === 100)
              };
              const active = activeTab === tab;
              const count = counts[tab];
              return (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab)}
                  className={`relative inline-flex h-full shrink-0 items-center justify-center gap-2 rounded-none px-0 text-sm font-medium transition-colors after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-foreground after:transition-opacity ${
                    active ? "text-foreground after:opacity-100" : "text-muted-foreground after:opacity-0 hover:text-foreground"
                  }`}
                >
                  <span>{tab}</span>
                  {count ? (
                    <span className="rounded-full border border-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-500">{count}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex-1 space-y-6 overflow-y-auto p-6">
        {selectedRepo && view !== "Local Changes" && (
          <div className="flex items-start justify-between">
            <div>
              <nav aria-label="breadcrumb" className="mb-3">
                <ol className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <li>
                    <button
                      type="button"
                      onClick={() => setView("home")}
                      className="cursor-pointer transition-colors hover:text-foreground"
                    >
                      Repository
                    </button>
                  </li>
                  <li className="text-muted-foreground" aria-hidden="true">
                    /
                  </li>
                  <li aria-current="page" className="font-medium text-foreground">
                    {view === "Code" ? activeTab : view}
                  </li>
                </ol>
              </nav>
              <h1 className="mb-1 text-[28px] font-semibold tracking-tight text-white">{selectedRepo.name}</h1>
              <div className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-neutral-600">{selectedRepo.owner}</div>
              <p className="max-w-2xl text-sm text-neutral-400">{selectedRepo.description ?? "No description cached."}</p>
            </div>
          </div>
        )}

        {view === "Code" && (
          <RepoCodeView
            repo={selectedRepo}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            codeSummary={codeSummary}
            fileOpenTarget={selectedRepo && repoFileOpenTarget?.repoId === selectedRepo.id ? repoFileOpenTarget : null}
            commitOpenTarget={selectedRepo && commitOpenTarget?.repoId === selectedRepo.id ? commitOpenTarget : null}
            onLocalChangesCreated={(summary: string | null) => {
              if (summary && selectedRepo) {
                setLocalChangesCommitPrefill({
                  repoId: selectedRepo.id,
                  summary,
                  token: `${selectedRepo.id}:${Date.now()}`
                });
              }
              setView("Local Changes");
            }}
          />
        )}
        {view === "Local Changes" && selectedRepo && (
          <LocalChangesView
            repo={selectedRepo}
            changes={localChanges}
            error={localChangesError}
            loading={localChangesFetching && !localChanges}
            commitPrefill={localChangesCommitPrefill?.repoId === selectedRepo.id ? localChangesCommitPrefill : null}
            onCommitPrefillApplied={() => setLocalChangesCommitPrefill(null)}
          />
        )}
        {view === "Pull requests" && !selectedPrNumber && (
          <PullRequestListView
            repoId={selectedRepoId}
            onPrClick={setSelectedPrNumber}
            auth={auth}
            query={pullRequestQuery}
            onQueryChange={setPullRequestQuery}
          />
        )}
        {view === "Issues" && (
          <IssueListView
            repoId={selectedRepoId}
            auth={auth}
            onIssueClick={setSelectedIssueNumber}
            query={issueQuery}
            onQueryChange={setIssueQuery}
          />
        )}
        {view === "Actions" && <ActionsView repoId={selectedRepoId} onPrClick={setSelectedPrNumber} />}
        {view === "Branch Integrity" && <BranchIntegrityView repo={selectedRepo} />}
      </div>
    </div>
  );
}
