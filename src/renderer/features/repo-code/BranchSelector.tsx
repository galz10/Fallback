import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon as GitHubCheckIcon, RepoForkedIcon as GitHubRepoForkedIcon } from "@primer/octicons-react";
import { ChevronDown } from "lucide-react";
import type { WatchedRepo } from "../../../shared/domain/watched-repo";
import type { RepoCodeSummary } from "../../../shared/domain/repo-code";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../../components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";

function matchesText(value: string | null | undefined, term: string): boolean {
  return value?.toLowerCase().includes(term.trim().toLowerCase()) ?? false;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function BranchSelector({ repo, codeSummary }: { repo: WatchedRepo; codeSummary?: RepoCodeSummary }) {
  const queryClient = useQueryClient();
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [branchFilter, setBranchFilter] = useState("");
  const [currentBranch, setCurrentBranch] = useState(codeSummary?.defaultBranch ?? repo.defaultBranch ?? "main");
  const { data: branches = [], isFetching: branchesLoading } = useQuery({
    queryKey: ["repoBranches", repo.id],
    queryFn: () => window.fallback.repos.listBranches(repo.id),
    enabled: branchMenuOpen,
    staleTime: 60_000
  });
  const switchBranch = useMutation({
    mutationFn: async (branch: string) => {
      if (repo.localPath) {
        const risk = await window.fallback.repos.conflictPreflight(repo.id, { operation: "branch_switch", targetRef: `origin/${branch}` });
        if (
          (risk.riskLevel === "high" || risk.riskLevel === "medium") &&
          !window.confirm(
            `${risk.summary}\n\nRepo: ${risk.repoFullName}\nWorkspace: ${risk.workspacePath}\nBranch: ${risk.branch ?? "detached"}\nOverlapping files: ${risk.overlappingFileCount}\n\nSwitch branches anyway?`
          )
        ) {
          throw new Error("Branch switch cancelled after conflict-risk preflight.");
        }
      }
      return window.fallback.repos.switchBranch(repo.id, branch);
    },
    onSuccess: async (result) => {
      setCurrentBranch(result.branch);
      setBranchFilter("");
      setBranchMenuOpen(false);
      queryClient.setQueryData<RepoCodeSummary>(["repoCodeSummary", repo.id], (summary) =>
        summary ? { ...summary, defaultBranch: result.branch } : summary
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["repoCodeSummary", repo.id] }),
        queryClient.invalidateQueries({ queryKey: ["repoFiles", repo.id] }),
        queryClient.invalidateQueries({ queryKey: ["repoBranches", repo.id] })
      ]);
    }
  });

  useEffect(() => {
    setCurrentBranch(codeSummary?.defaultBranch ?? repo.defaultBranch ?? "main");
  }, [codeSummary?.defaultBranch, repo.defaultBranch, repo.id]);

  useEffect(() => {
    if (!branchMenuOpen) setBranchFilter("");
  }, [branchMenuOpen]);

  const filteredBranches = branches.filter((branch) => matchesText(branch.name, branchFilter));
  const firstSwitchableBranch = filteredBranches.find((branch) => branch.name !== currentBranch);

  return (
    <Popover open={branchMenuOpen} onOpenChange={setBranchMenuOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex cursor-pointer items-center space-x-1.5 text-neutral-300 transition-colors hover:text-white"
          aria-expanded={branchMenuOpen}
        >
          <GitHubRepoForkedIcon className="h-4 w-4" />
          <span>{currentBranch}</span>
          <ChevronDown className="ml-1 h-3 w-3 text-neutral-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 overflow-hidden p-0">
        <Command shouldFilter={false}>
          <div className="border-b border-neutral-800 px-3 py-2 text-xs font-medium uppercase tracking-[0.14em] text-neutral-500">
            Switch branch
          </div>
          <CommandInput
            autoFocus
            className="focus:!shadow-none focus-visible:!shadow-none"
            value={branchFilter}
            onValueChange={setBranchFilter}
            onKeyDown={(event) => {
              if (event.key === "Enter" && firstSwitchableBranch) {
                event.preventDefault();
                switchBranch.mutate(firstSwitchableBranch.name);
              }
            }}
            placeholder="Filter branches"
          />
          <CommandList>
            {branchesLoading && <CommandEmpty>Loading branches...</CommandEmpty>}
            {!branchesLoading && branches.length === 0 && <CommandEmpty>No branches cached.</CommandEmpty>}
            {!branchesLoading && branches.length > 0 && filteredBranches.length === 0 && <CommandEmpty>No matching branches.</CommandEmpty>}
            <CommandGroup>
              {filteredBranches.map((branch) => (
                <CommandItem
                  key={branch.name}
                  value={branch.name}
                  disabled={switchBranch.isPending || branch.name === currentBranch}
                  onSelect={() => switchBranch.mutate(branch.name)}
                >
                  <span className="min-w-0 flex-1 truncate">{branch.name}</span>
                  {branch.name === currentBranch && <GitHubCheckIcon className="h-4 w-4 shrink-0 text-neutral-500" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {switchBranch.error && (
            <div className="border-t border-red-700/30 bg-red-200/35 px-3 py-2 text-xs text-red-900">
              {errorMessage(switchBranch.error)}
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
