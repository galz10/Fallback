import type { AuthState } from "../../shared/domain/auth";

export const DISCONNECTED_AUTH_STATE: AuthState = { status: "disconnected" };
export const STORED_AUTH_STATE_KEY = "fallback.lastAuthState";

export function authScopedQueryKey(auth: AuthState): string {
  if (auth.status === "disconnected") return "disconnected";
  return auth.accountId ?? auth.login ?? auth.status;
}

export function readStoredAuthState(): AuthState | null {
  try {
    const raw = window.localStorage.getItem(STORED_AUTH_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthState;
    return typeof parsed === "object" && parsed !== null && "status" in parsed ? trimStoredAuthState(parsed) : null;
  } catch {
    return null;
  }
}

export function trimStoredAuthState(auth: AuthState): AuthState {
  if (auth.status === "disconnected") return auth;
  return { ...auth, avatarCachedUrl: null };
}

export function writeStoredAuthState(auth: AuthState): void {
  try {
    if (auth.status === "disconnected") {
      window.localStorage.removeItem(STORED_AUTH_STATE_KEY);
      return;
    }
    window.localStorage.setItem(STORED_AUTH_STATE_KEY, JSON.stringify(trimStoredAuthState(auth)));
  } catch {
    // localStorage can be unavailable in hardened shells; auth still hydrates from IPC.
  }
}
