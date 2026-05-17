import { create } from "zustand";
import type { AttentionLane } from "../../shared/attention.js";
import type { RepoDisplayMode } from "../../shared/repo-display.js";
import { type AppView, useNavigationStore } from "./navigation-store";
import { useRepoSelectionStore } from "./repo-selection-store";

export type { AppView } from "./navigation-store";

export type LocalChangesDisplayMode = "flat" | "tree";

interface AppPreferencesStore {
  localChangesDisplayMode: LocalChangesDisplayMode;
  repoDisplayMode: RepoDisplayMode;
  myWorkLane: AttentionLane;
  setLocalChangesDisplayMode: (mode: LocalChangesDisplayMode) => void;
  setRepoDisplayMode: (mode: RepoDisplayMode) => void;
  setMyWorkLane: (lane: AttentionLane) => void;
}

export interface AppStoreSnapshot {
  view: AppView;
  selectedRepoId: string | null;
  recentRepoIds: string[];
  localChangesDisplayMode: LocalChangesDisplayMode;
  repoDisplayMode: RepoDisplayMode;
  myWorkLane: AttentionLane;
  setView: (view: AppView) => void;
  setSelectedRepoId: (repoId: string | null) => void;
  setLocalChangesDisplayMode: (mode: LocalChangesDisplayMode) => void;
  setRepoDisplayMode: (mode: RepoDisplayMode) => void;
  setMyWorkLane: (lane: AttentionLane) => void;
}

const localChangesDisplayModeKey = "fallback.localChangesDisplayMode";
const repoDisplayModeKey = "fallback.repoDisplayMode";

export const useAppPreferencesStore = create<AppPreferencesStore>((set) => ({
  localChangesDisplayMode: readLocalChangesDisplayMode(),
  repoDisplayMode: readRepoDisplayMode(),
  myWorkLane: "needs_me",
  setLocalChangesDisplayMode: (localChangesDisplayMode) => {
    writeLocalChangesDisplayMode(localChangesDisplayMode);
    set({ localChangesDisplayMode });
  },
  setRepoDisplayMode: (repoDisplayMode) => {
    writeRepoDisplayMode(repoDisplayMode);
    set({ repoDisplayMode });
  },
  setMyWorkLane: (myWorkLane) => set({ myWorkLane })
}));

export function useAppStore<T>(selector: (state: AppStoreSnapshot) => T): T {
  const navigation = useNavigationStore();
  const repoSelection = useRepoSelectionStore();
  const preferences = useAppPreferencesStore();
  return selector({
    ...navigation,
    ...repoSelection,
    ...preferences
  });
}

function readLocalChangesDisplayMode(): LocalChangesDisplayMode {
  if (typeof window === "undefined") return "flat";
  const value = window.localStorage.getItem(localChangesDisplayModeKey);
  return value === "tree" || value === "flat" ? value : "flat";
}

function writeLocalChangesDisplayMode(mode: LocalChangesDisplayMode): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(localChangesDisplayModeKey, mode);
}

function readRepoDisplayMode(): RepoDisplayMode {
  if (typeof window === "undefined") return "cards";
  const value = window.localStorage.getItem(repoDisplayModeKey);
  return value === "list" || value === "cards" ? value : "cards";
}

function writeRepoDisplayMode(mode: RepoDisplayMode): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(repoDisplayModeKey, mode);
}
