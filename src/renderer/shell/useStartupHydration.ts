import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { AuthState } from "../../shared/domain/auth";
import type { FallbackWindowRoute } from "../../shared/domain/window-context";
import type { AppView } from "../state/navigation-store";
import { isRepoScopedView } from "../sync-active-context";
import { DISCONNECTED_AUTH_STATE, readStoredAuthState, writeStoredAuthState } from "./auth-storage";
import { applyRestoredEntity, type WindowEntitySetters } from "./useWindowContext";

const STARTUP_HYDRATION_DELAY_MS = 2_500;

export function useStartupHydration({
  entitySetters,
  navigationStackRef,
  onRendererReady,
  selectedRepoId,
  setSelectedRepoId,
  setView,
  setWindowContextNotice,
  queryClient,
  view,
  visible
}: {
  entitySetters: WindowEntitySetters;
  navigationStackRef: MutableRefObject<FallbackWindowRoute[]>;
  onRendererReady: () => void;
  selectedRepoId: string | null;
  setSelectedRepoId: (repoId: string | null) => void;
  setView: (view: AppView) => void;
  setWindowContextNotice: (notice: string | null) => void;
  queryClient: QueryClient;
  view: AppView;
  visible: boolean;
}): {
  auth: AuthState;
  richChromeEnabled: boolean;
  startupHydrationEnabled: boolean;
} {
  const startupSnapshotAppliedRef = useRef(false);
  const windowContextAppliedRef = useRef(false);
  const [startupSnapshotEnabled, setStartupSnapshotEnabled] = useState(false);
  const [startupHydrationEnabled, setStartupHydrationEnabled] = useState(false);
  const [richChromeEnabled, setRichChromeEnabled] = useState(false);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      onRendererReady();
      setStartupSnapshotEnabled(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [onRendererReady]);

  const { data: startupSnapshot } = useQuery({
    queryKey: ["startupSnapshot"],
    queryFn: window.fallback.startup.snapshot,
    enabled: startupSnapshotEnabled,
    staleTime: 30_000,
    gcTime: 60_000,
    refetchOnWindowFocus: false
  });

  useEffect(() => {
    if (!startupSnapshot) return;
    if (startupSnapshotAppliedRef.current) return;
    startupSnapshotAppliedRef.current = true;
    queryClient.setQueryData(["auth"], startupSnapshot.auth, { updatedAt: authQueryUpdatedAt(startupSnapshot.auth) });
    queryClient.setQueryData(["accounts"], startupSnapshot.profiles);
    queryClient.setQueryData(["profiles"], startupSnapshot.profiles);
    writeStoredAuthState(startupSnapshot.auth);
    queryClient.setQueryData(["repos"], startupSnapshot.repos);
    if (startupSnapshot.cacheSummary) queryClient.setQueryData(["cache"], startupSnapshot.cacheSummary);
    const restoredContext = startupSnapshot.windowContext;
    if (restoredContext && !windowContextAppliedRef.current) {
      windowContextAppliedRef.current = true;
      navigationStackRef.current = restoredContext.navigationStack ?? [];
      const restoredRepo = restoredContext.repoId ? startupSnapshot.repos.find((repo) => repo.id === restoredContext.repoId) : null;
      if (restoredRepo) setSelectedRepoId(restoredRepo.id);
      if (!restoredRepo && isRepoScopedView(restoredContext.view)) {
        setWindowContextNotice("That saved window pointed at a repo that is no longer watched. Opened Home instead.");
        setView("home");
      } else {
        if (restoredContext.restored)
          setWindowContextNotice(`Restored ${restoredContext.navigationStack.at(-1)?.label ?? restoredContext.view}.`);
        setView(restoredContext.view);
        applyRestoredEntity(restoredContext.selectedEntityId, restoredContext.repoId, entitySetters);
      }
      return;
    }
    if (!selectedRepoId && startupSnapshot.repos.length > 0) {
      setSelectedRepoId(startupSnapshot.selectedRepoId ?? startupSnapshot.repos[0].id);
    }
  }, [entitySetters, navigationStackRef, queryClient, selectedRepoId, setSelectedRepoId, setView, setWindowContextNotice, startupSnapshot]);

  useEffect(() => {
    if (view === "Settings" || !visible) {
      setStartupHydrationEnabled(false);
      return;
    }
    const id = window.setTimeout(() => setStartupHydrationEnabled(true), STARTUP_HYDRATION_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [view, visible]);

  useEffect(() => {
    if (!visible) return;
    const id = window.setTimeout(() => setRichChromeEnabled(true), 2_500);
    return () => window.clearTimeout(id);
  }, [visible]);

  const initialAuth = queryClient.getQueryData<AuthState>(["auth"]) ?? readStoredAuthState() ?? DISCONNECTED_AUTH_STATE;
  const { data: auth = DISCONNECTED_AUTH_STATE } = useQuery({
    queryKey: ["auth"],
    queryFn: window.fallback.auth.getAuthState,
    enabled: view !== "Settings" && startupHydrationEnabled,
    initialData: () => initialAuth,
    initialDataUpdatedAt: () => authQueryUpdatedAt(initialAuth),
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false
  });

  useEffect(() => {
    writeStoredAuthState(auth);
  }, [auth]);

  return {
    auth,
    richChromeEnabled,
    startupHydrationEnabled
  };
}

function authQueryUpdatedAt(auth: AuthState): number {
  return auth.status === "connected" || auth.status === "disconnected" ? Date.now() : 0;
}
