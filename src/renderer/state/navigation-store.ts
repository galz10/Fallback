import { create } from "zustand";

export type AppView =
  | "home"
  | "My Work"
  | "Code"
  | "Local Changes"
  | "Issues"
  | "Pull requests"
  | "Actions"
  | "Branch Integrity"
  | "Settings"
  | "Status";

interface NavigationStore {
  view: AppView;
  setView: (view: AppView) => void;
}

export const useNavigationStore = create<NavigationStore>((set) => ({
  view: "home",
  setView: (view) => set({ view })
}));
