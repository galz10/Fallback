export type FallbackWindowView =
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

export interface FallbackWindowRoute {
  repoId: string | null;
  workspaceId: string | null;
  view: FallbackWindowView;
  selectedEntityId: string | null;
  label: string | null;
  at: string;
}

export interface FallbackWindowContext {
  id: string;
  repoId: string | null;
  workspaceId: string | null;
  view: FallbackWindowView;
  selectedEntityId: string | null;
  navigationStack: FallbackWindowRoute[];
  accountId: string | null;
  lastActiveAt: string;
  restored: boolean;
}

export interface FallbackWindowContextInput {
  repoId?: string | null;
  workspaceId?: string | null;
  view?: FallbackWindowView;
  selectedEntityId?: string | null;
  navigationStack?: FallbackWindowRoute[];
  accountId?: string | null;
}
