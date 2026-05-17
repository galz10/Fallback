import { create } from "zustand";

interface RepoSelectionStore {
  selectedRepoId: string | null;
  recentRepoIds: string[];
  setSelectedRepoId: (repoId: string | null) => void;
}

const recentRepoIdsKey = "fallback.recentRepoIds";
const maxRecentRepoIds = 8;

export const useRepoSelectionStore = create<RepoSelectionStore>((set) => ({
  selectedRepoId: null,
  recentRepoIds: readRecentRepoIds(),
  setSelectedRepoId: (selectedRepoId) =>
    set((state) => {
      if (!selectedRepoId) return { selectedRepoId };
      const recentRepoIds = [selectedRepoId, ...state.recentRepoIds.filter((repoId) => repoId !== selectedRepoId)].slice(
        0,
        maxRecentRepoIds
      );
      writeRecentRepoIds(recentRepoIds);
      return { selectedRepoId, recentRepoIds };
    })
}));

function readRecentRepoIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(recentRepoIdsKey) ?? "[]");
    return Array.isArray(value) ? value.filter((repoId): repoId is string => typeof repoId === "string").slice(0, maxRecentRepoIds) : [];
  } catch {
    return [];
  }
}

function writeRecentRepoIds(repoIds: string[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(recentRepoIdsKey, JSON.stringify(repoIds.slice(0, maxRecentRepoIds)));
}
