import React, { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MarkGithubIcon } from "@primer/octicons-react";
import {
  Activity,
  Check,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  Keyboard,
  Plus,
  RefreshCcw,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  X
} from "lucide-react";
import type { AuthState, GitHubAccountSession, GitHubBrowserOAuthFlow, GitHubOAuthDeviceFlow } from "../../../shared/domain/auth";
import {
  commandPaletteKeybindingActionIds,
  defaultCommandPaletteKeybindings,
  type AppSettings,
  type CommandPaletteKeybindingActionId
} from "../../../shared/domain/settings";
import type { WatchedRepo } from "../../../shared/domain/watched-repo";
import type { CredentialDiagnosticReport } from "../../../shared/domain/repo-identity";
import type { CacheSummary } from "../../../shared/domain/cache";
import type { AppUpdateState } from "../../../shared/domain/app-update";
import { authRecoveryCopy, hasAuthAccountDetails } from "../../../shared/auth-recovery";
import { useRepoSelectionStore } from "../../state/repo-selection-store";
import { Avatar } from "../../components/Avatar";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { CredentialDiagnosticsDialog } from "../../components/CredentialDiagnosticsDialog";
import { RepoPicker } from "../../components/RepoPicker";
import { StorageUsageBar } from "../../components/StorageUsageBar";
import { renderableAvatarUrl } from "../../lib/avatar-url";
import { endpointLabel, formatBytes, formatDate } from "../../lib/format";
import { closedIssueRetentionOptions, fallbackSettings, syncFrequencyOptions } from "../../app/default-settings";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { InputGroup, InputGroupButton, InputGroupInput } from "../../components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../components/ui/tooltip";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDeviceFlowWaiting(message: string): boolean {
  return message.includes("authorization is still pending") || message.includes("slow down");
}

function closedIssueRetentionLabel(days: number): string {
  if (days <= 0) return "Never";
  if (days === 365) return "1 year";
  if (days % 365 === 0) return `${days / 365} years`;
  if (days % 30 === 0) return `${days / 30} months`;
  return `${days} days`;
}

function syncFrequencyLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

const emptyProfiles: GitHubAccountSession[] = [];

const commandPaletteKeybindingCopy: Record<CommandPaletteKeybindingActionId, { label: string; description: string }> = {
  home: { label: "Go to Home", description: "Watched repositories and repo groups" },
  "my-work": { label: "Go to My Work", description: "Actionable pull requests and issues" },
  "open-notifications": { label: "Open notifications", description: "Toggle the attention inbox" },
  code: { label: "Go to Code", description: "Open the selected repo code view" },
  "local-changes": { label: "View Local Changes", description: "Open the selected repo workspace changes" },
  "pull-requests": { label: "View Pull Requests", description: "Review pull requests in the selected repo" },
  issues: { label: "View Issues", description: "Review issues in the selected repo" },
  actions: { label: "View Actions", description: "Open workflow runs for the selected repo" },
  "branch-integrity": { label: "Open Branch Watch", description: "Open branch safety monitoring for the selected repo" },
  settings: { label: "Open Settings", description: "Accounts, cache, and local preferences" }
};

const commandPaletteKeybindingRows = commandPaletteKeybindingActionIds.map((id) => ({
  id,
  ...commandPaletteKeybindingCopy[id]
}));

/* ---- Settings View ---- */

export function SettingsView() {
  const queryClient = useQueryClient();
  const auth = queryClient.getQueryData<AuthState>(["auth"]) ?? ({ status: "disconnected" } as AuthState);
  const cachedAccounts =
    queryClient.getQueryData<GitHubAccountSession[]>(["profiles"]) ??
    queryClient.getQueryData<GitHubAccountSession[]>(["accounts"]) ??
    emptyProfiles;
  const cachedSettings = queryClient.getQueryData<AppSettings>(["settings"]);
  const { data: settings = fallbackSettings, isPending: settingsLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: window.fallback.settings.get,
    initialData: cachedSettings,
    refetchOnWindowFocus: false
  });
  const cache = queryClient.getQueryData<CacheSummary>(["cache"]);
  const cachedAppUpdate = queryClient.getQueryData<AppUpdateState>(["appUpdate"]);
  const watchedRepos = queryClient.getQueryData<WatchedRepo[]>(["repos"]) ?? [];
  const [showRepoPicker, setShowRepoPicker] = useState(false);
  const { data: availableRepos = [], isFetching: reposLoading } = useQuery({
    queryKey: ["availableRepos"],
    queryFn: window.fallback.repos.listAvailable,
    enabled: auth.status === "connected" && showRepoPicker,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false
  });
  const { data: profileRows = cachedAccounts } = useQuery({
    queryKey: ["profiles"],
    queryFn: window.fallback.auth.listProfiles,
    enabled: hasAuthAccountDetails(auth),
    staleTime: 60_000,
    refetchOnWindowFocus: false
  });
  const { data: appUpdate = cachedAppUpdate } = useQuery({
    queryKey: ["appUpdate"],
    queryFn: window.fallback.appUpdate.getState,
    initialData: cachedAppUpdate,
    refetchOnWindowFocus: false
  });
  const accounts = profileRows;
  const [profileNameDrafts, setProfileNameDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [diagnosticsReport, setDiagnosticsReport] = useState<CredentialDiagnosticReport | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [browserOAuthFlow, setBrowserOAuthFlow] = useState<GitHubBrowserOAuthFlow | null>(null);
  const [oauthFlow, setOauthFlow] = useState<GitHubOAuthDeviceFlow | null>(null);
  const [oauthChecking, setOauthChecking] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [repoSearch, setRepoSearch] = useState("");
  const [manualRepo, setManualRepo] = useState("");
  const [confirmAction, setConfirmAction] = useState<"disconnect" | "remove-all-accounts" | "clear-all-data" | null>(null);
  const [profileRemovalTarget, setProfileRemovalTarget] = useState<GitHubAccountSession | null>(null);
  const tokenInput = useRef<HTMLInputElement>(null);
  const completionInFlightRef = useRef(false);
  const selectedRepoId = useRepoSelectionStore((s) => s.selectedRepoId);
  const onError = (error: unknown) => setNotice(errorMessage(error));
  const refreshAuth = useCallback(async () => {
    const nextAuth = await window.fallback.auth.getAuthState();
    queryClient.setQueryData(["auth"], nextAuth);
    queryClient.invalidateQueries({ queryKey: ["profiles"] });
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
    queryClient.invalidateQueries({ queryKey: ["repos"] });
    queryClient.removeQueries({ queryKey: ["availableRepos"] });
  }, [queryClient]);
  const refreshCache = async () => {
    const nextCache = await window.fallback.cache.summary();
    queryClient.setQueryData(["cache"], nextCache);
    queryClient.invalidateQueries({ queryKey: ["repos"] });
  };
  const refreshRepos = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["repos"] }),
      queryClient.invalidateQueries({ queryKey: ["cache"] }),
      queryClient.invalidateQueries({ queryKey: ["availableRepos"] })
    ]);
  };
  const connectGitHub = useMutation({
    mutationFn: () => window.fallback.auth.connectGitHub(tokenInput.current?.value),
    onSuccess: async () => {
      if (tokenInput.current) tokenInput.current.value = "";
      setHasToken(false);
      setNotice("GitHub connected.");
      await refreshAuth();
    },
    onError
  });
  const disconnectGitHub = useMutation({
    mutationFn: window.fallback.auth.disconnectGitHub,
    onMutate: () => {
      queryClient.setQueryData(["auth"], { status: "disconnected" });
    },
    onSuccess: () => {
      setConfirmAction(null);
      setNotice("GitHub disconnected. Cached data remains local.");
    },
    onError
  });
  const deleteAllAccounts = useMutation({
    mutationFn: window.fallback.auth.deleteAllAccounts,
    onSuccess: async () => {
      setConfirmAction(null);
      setNotice("All GitHub accounts were removed. Managed repository folders were deleted.");
      await refreshAuth();
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      queryClient.invalidateQueries({ queryKey: ["availableRepos"] });
    },
    onError
  });
  const renameProfile = useMutation({
    mutationFn: ({ profileId, name }: { profileId: string; name: string }) => window.fallback.auth.renameProfile(profileId, name),
    onSuccess: async () => {
      setNotice("GitHub profile renamed.");
      await refreshAuth();
    },
    onError
  });
  const updateProfileColor = useMutation({
    mutationFn: ({ profileId, color }: { profileId: string; color: string | null }) =>
      window.fallback.auth.updateProfileColor(profileId, color),
    onSuccess: async () => {
      setNotice("GitHub profile color updated.");
      await refreshAuth();
    },
    onError
  });
  const reconnectProfile = useMutation({
    mutationFn: window.fallback.auth.reconnectProfile,
    onSuccess: (flow) => {
      setOauthFlow(null);
      setBrowserOAuthFlow(flow);
      setNotice("Waiting for GitHub profile reconnect...");
    },
    onError
  });
  const removeProfile = useMutation({
    mutationFn: window.fallback.auth.removeProfile,
    onSuccess: async () => {
      setProfileRemovalTarget(null);
      setNotice("GitHub profile removed. Managed repository folders for that profile were deleted.");
      await refreshAuth();
    },
    onError
  });
  const startBrowserOAuth = useMutation({
    mutationFn: window.fallback.auth.startGitHubBrowserOAuth,
    onSuccess: (flow) => {
      setOauthFlow(null);
      setBrowserOAuthFlow(flow);
      setNotice("Waiting for GitHub browser sign-in...");
    },
    onError
  });
  const cancelBrowserOAuth = useMutation({
    mutationFn: window.fallback.auth.cancelGitHubBrowserOAuth,
    onSuccess: () => {
      setBrowserOAuthFlow(null);
      setNotice("GitHub browser sign-in canceled.");
    },
    onError
  });
  const startOAuth = useMutation({
    mutationFn: window.fallback.auth.startGitHubOAuth,
    onSuccess: (flow) => {
      setBrowserOAuthFlow(null);
      setOauthFlow(flow);
      setCodeCopied(false);
      setNotice("Enter this code in GitHub. Fallback will finish sign-in automatically.");
    },
    onError
  });
  const completeDeviceSignIn = useCallback(
    async (deviceCode: string) => {
      if (completionInFlightRef.current) return;
      completionInFlightRef.current = true;
      setOauthChecking(true);
      try {
        const result = await window.fallback.auth.completeGitHubOAuth(deviceCode);
        if (result.status !== "success") {
          setNotice(
            result.status === "slow_down" ? "GitHub asked Fallback to slow down. Waiting..." : "Waiting for GitHub authorization..."
          );
          return;
        }
        setOauthFlow(null);
        setCodeCopied(false);
        setNotice("GitHub connected.");
        await refreshAuth();
      } catch (signInError) {
        const copy = errorMessage(signInError);
        if (isDeviceFlowWaiting(copy)) {
          setNotice("Waiting for GitHub authorization...");
        } else {
          if (copy.includes("expired")) setOauthFlow(null);
          setNotice(copy);
        }
      } finally {
        setOauthChecking(false);
        completionInFlightRef.current = false;
      }
    },
    [refreshAuth]
  );
  const copyUserCode = useCallback(async () => {
    if (!oauthFlow) return;
    await navigator.clipboard?.writeText(oauthFlow.userCode);
    setCodeCopied(true);
    window.setTimeout(() => setCodeCopied(false), 1800);
  }, [oauthFlow]);
  const updateSettings = useMutation({
    mutationFn: (patch: Partial<AppSettings>) => window.fallback.settings.update(patch),
    onSuccess: (nextSettings) => {
      setNotice("Settings updated.");
      queryClient.setQueryData(["settings"], nextSettings);
    },
    onError
  });
  const loadLocalDetails = useMutation({
    mutationFn: window.fallback.settings.get,
    onSuccess: (nextSettings) => {
      queryClient.setQueryData(["settings"], nextSettings);
      setNotice("Local settings loaded.");
    },
    onError
  });
  const loadCacheDetails = useMutation({
    mutationFn: window.fallback.cache.summary,
    onSuccess: (nextCache) => {
      queryClient.setQueryData(["cache"], nextCache);
      setNotice("Cache summary loaded.");
    },
    onError
  });
  const refreshAppUpdateState = useCallback(async () => {
    const nextState = await window.fallback.appUpdate.getState();
    queryClient.setQueryData(["appUpdate"], nextState);
    return nextState;
  }, [queryClient]);
  const checkAppUpdate = useMutation({
    mutationFn: window.fallback.appUpdate.check,
    onSuccess: (result) => {
      queryClient.setQueryData(["appUpdate"], result.state);
      setNotice(result.checked ? appUpdateNotice(result.state) : (result.state.message ?? "App updates are not available."));
    },
    onError
  });
  const downloadAppUpdate = useMutation({
    mutationFn: window.fallback.appUpdate.download,
    onSuccess: (result) => {
      queryClient.setQueryData(["appUpdate"], result.state);
      setNotice(result.accepted ? "Update download started." : (result.state.message ?? "No update is ready to download."));
    },
    onError
  });
  const installAppUpdate = useMutation({
    mutationFn: window.fallback.appUpdate.install,
    onSuccess: (result) => {
      queryClient.setQueryData(["appUpdate"], result.state);
      if (!result.accepted) setNotice(result.state.message ?? "No downloaded update is ready to install.");
    },
    onError
  });
  const runAccountDiagnostics = useMutation({
    mutationFn: async () => {
      const repo = watchedRepos.find((item) => item.id === selectedRepoId) ?? watchedRepos[0];
      if (!repo) throw new Error("Watch a repository before running credential diagnostics.");
      return window.fallback.repos.checkCredentials(repo.id);
    },
    onSuccess: async (report) => {
      setDiagnosticsReport(report);
      setNotice(`Credential diagnostics completed for ${report.repoFullName}.`);
      await queryClient.invalidateQueries({ queryKey: ["repoIdentity", report.repoId] });
    },
    onError
  });
  const watchRepo = useMutation({
    mutationFn: async (fullName: string) => {
      const knownRepo = availableRepos.find((repo) => repo.fullName.toLowerCase() === fullName.toLowerCase());
      if (knownRepo?.isPrivate) {
        const confirmed = window.confirm(
          "Private repository metadata will be cached locally in the selected workspace. Fallback does not encrypt the SQLite cache; use OS disk encryption for private workspaces."
        );
        if (!confirmed) throw new Error("Private repository watch canceled.");
      }
      return window.fallback.repos.watch({ fullName });
    },
    onSuccess: async (repo) => {
      setManualRepo("");
      setNotice(`${repo.fullName} is watched. Initial sync queued.`);
      await refreshRepos();
    },
    onError
  });
  const deleteAll = useMutation({
    mutationFn: () => window.fallback.cache.deleteAll(),
    onSuccess: async () => {
      setConfirmAction(null);
      setNotice("All local Fallback cache data was cleared.");
      await refreshCache();
    },
    onError
  });
  const authRecovery = authRecoveryCopy(auth);
  const authTitle =
    auth.status === "connected"
      ? `Connected as ${auth.profileName ?? auth.login ?? "GitHub user"}`
      : authRecovery
        ? authRecovery.title
        : "Not connected";
  const authDescription =
    auth.status === "connected"
      ? "Used to sync repository context and write GitHub comments or reviews."
      : authRecovery
        ? authRecovery.body
        : "Connect your GitHub account to start syncing.";
  const settingsManualRepoName = manualRepo.trim();
  const settingsWatchBlockReason = watchRepo.isPending
    ? "Wait for the current repository watch request to finish."
    : auth.status !== "connected"
      ? "Connect GitHub before watching a repository."
      : !settingsManualRepoName
        ? "Enter a repository as owner/name before watching."
        : null;
  const commandPaletteKeybindings = settings.keybindings?.commandPalette ?? defaultCommandPaletteKeybindings;
  const updateCommandPaletteKeybinding = useCallback(
    (id: CommandPaletteKeybindingActionId, binding: string | null) => {
      updateSettings.mutate({
        keybindings: {
          ...(settings.keybindings ?? { commandPalette: defaultCommandPaletteKeybindings }),
          commandPalette: {
            ...commandPaletteKeybindings,
            [id]: binding
          }
        }
      });
    },
    [commandPaletteKeybindings, settings.keybindings, updateSettings]
  );

  useEffect(() => {
    setProfileNameDrafts((current) => {
      const next: Record<string, string> = {};
      for (const profile of accounts) {
        next[profile.id] = current[profile.id] ?? profile.profileName ?? profile.login ?? "";
      }
      if (Object.keys(current).length === Object.keys(next).length && Object.keys(next).every((key) => current[key] === next[key])) {
        return current;
      }
      return next;
    });
  }, [accounts]);

  useEffect(() => {
    return window.fallback.auth.onBrowserOAuthResult((result) => {
      setBrowserOAuthFlow(null);
      if (result.status === "success") {
        setNotice(result.message ?? "GitHub connected.");
        void window.fallback.auth.getAuthState().then((nextAuth) => {
          queryClient.setQueryData(["auth"], nextAuth);
          queryClient.removeQueries({ queryKey: ["availableRepos"] });
          queryClient.invalidateQueries({ queryKey: ["repos"] });
        });
        queryClient.invalidateQueries({ queryKey: ["accounts"] });
        queryClient.invalidateQueries({ queryKey: ["profiles"] });
        return;
      }
      setNotice(result.message ?? "GitHub browser sign-in failed.");
    });
  }, [queryClient]);

  useEffect(() => {
    if (!browserOAuthFlow) return;
    const timeoutMs = Math.max(0, new Date(browserOAuthFlow.expiresAt).getTime() - Date.now());
    const timer = window.setTimeout(() => {
      setBrowserOAuthFlow(null);
      setNotice("GitHub browser sign-in timed out. Try again or use the device code fallback.");
      void window.fallback.auth.cancelGitHubBrowserOAuth().catch(() => undefined);
    }, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [browserOAuthFlow]);

  useEffect(() => {
    if (!oauthFlow) return;
    let cancelled = false;
    let timer: number | undefined;
    const intervalMs = Math.max(5_000, oauthFlow.intervalSeconds * 1000);
    const poll = async () => {
      if (cancelled) return;
      await completeDeviceSignIn(oauthFlow.deviceCode);
      if (!cancelled) timer = window.setTimeout(poll, intervalMs);
    };
    timer = window.setTimeout(poll, intervalMs);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [completeDeviceSignIn, oauthFlow]);

  useEffect(() => {
    if (!oauthFlow) return;
    const timeoutMs = Math.max(0, new Date(oauthFlow.expiresAt).getTime() - Date.now());
    const timer = window.setTimeout(() => {
      setOauthFlow(null);
      setCodeCopied(false);
      setNotice("GitHub device sign-in timed out. Try again.");
    }, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [oauthFlow]);

  useEffect(() => {
    return window.fallback.events.onAppUpdateChanged(() => {
      void refreshAppUpdateState().catch(() => undefined);
    });
  }, [refreshAppUpdateState]);

  return (
    <div className="flex-1 overflow-y-auto w-full bg-black">
      <div className="mx-auto max-w-4xl space-y-5 px-6 py-8">
        <header className="space-y-1">
          <h1 className="text-[28px] font-semibold text-white tracking-tight">Settings</h1>
          <p className="max-w-2xl text-sm leading-6 text-neutral-500">
            Start with your GitHub account, repositories, and sync preferences. Technical details are tucked away until you need them.
          </p>
        </header>

        {notice && (
          <Alert className="flex items-center justify-between gap-3">
            <AlertDescription>{notice}</AlertDescription>
            <Button onClick={() => setNotice(null)} variant="ghost" size="xs">
              Dismiss
            </Button>
          </Alert>
        )}
        {diagnosticsReport && <CredentialDiagnosticsDialog report={diagnosticsReport} onClose={() => setDiagnosticsReport(null)} />}

        {/* GitHub Connection */}
        <section>
          <div className="mb-3 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-[13px] font-medium uppercase tracking-[0.16em] text-neutral-500">Account</h2>
              <p className="mt-1 text-sm text-neutral-500">Connect GitHub so Fallback can sync your work.</p>
            </div>
            {hasAuthAccountDetails(auth) && (
              <GitHubStatusPill tone={auth.status === "connected" ? "success" : "warning"}>
                {auth.status.replaceAll("_", " ")}
              </GitHubStatusPill>
            )}
          </div>
          <div className="overflow-hidden rounded-lg border border-neutral-800/90 bg-[#060606] shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]">
            <div className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-neutral-800 bg-black text-neutral-300">
                  {hasAuthAccountDetails(auth) ? (
                    <Avatar seed={auth.login ?? "GitHub user"} src={renderableAvatarUrl(auth.avatarCachedUrl, auth.avatarUrl)} size="md" />
                  ) : (
                    <MarkGithubIcon size={18} />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-medium text-neutral-100">{authTitle}</h3>
                    {auth.status === "connected" && (
                      <span className="inline-flex h-5 items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-950 px-1.5 text-[11px] font-medium text-neutral-500">
                        <ShieldCheck className="h-3 w-3 text-emerald-400" aria-hidden="true" />
                        Ready
                      </span>
                    )}
                  </div>
                  <p className={`mt-1 max-w-2xl text-[13px] leading-5 ${authRecovery ? "text-amber-300/80" : "text-neutral-500"}`}>
                    {authDescription}
                  </p>
                </div>
              </div>
              {auth.status === "connected" ? (
                <div className="flex flex-wrap items-center gap-1 lg:justify-end">
                  <GitHubActionButton
                    onClick={() => startOAuth.mutate()}
                    disabled={startOAuth.isPending}
                    title={startOAuth.isPending ? "Opening GitHub device sign-in..." : "Add another GitHub profile with a device code."}
                    icon={Plus}
                    intent="primary"
                    className="h-9 px-3"
                    aria-label={startOAuth.isPending ? "Opening GitHub profile sign-in" : "Add GitHub profile"}
                  >
                    {startOAuth.isPending ? "Opening..." : "Add profile"}
                  </GitHubActionButton>
                  <span className="mx-1 hidden h-4 w-px bg-neutral-800 lg:block" aria-hidden="true" />
                  <GitHubActionButton
                    onClick={() => setConfirmAction("disconnect")}
                    disabled={disconnectGitHub.isPending || deleteAllAccounts.isPending}
                    title={
                      disconnectGitHub.isPending || deleteAllAccounts.isPending
                        ? "Wait for the current account operation to finish."
                        : "Disconnect the active GitHub token while keeping cached data local."
                    }
                    icon={X}
                    className="h-9 px-3"
                    aria-label="Disconnect GitHub"
                  >
                    Disconnect
                  </GitHubActionButton>
                  <GitHubActionButton
                    onClick={() => runAccountDiagnostics.mutate()}
                    disabled={runAccountDiagnostics.isPending || watchedRepos.length === 0}
                    title={
                      runAccountDiagnostics.isPending
                        ? "Credential diagnostics are already running."
                        : watchedRepos.length === 0
                          ? "Watch a repository before running credential diagnostics."
                          : "Run credential diagnostics against the selected watched repository."
                    }
                    icon={Activity}
                    className="h-9 px-3"
                    aria-label={runAccountDiagnostics.isPending ? "Diagnosing GitHub credentials" : "Diagnose GitHub credentials"}
                  >
                    {runAccountDiagnostics.isPending ? "Diagnosing..." : "Diagnose"}
                  </GitHubActionButton>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
                  <GitHubActionButton
                    onClick={() => startOAuth.mutate()}
                    disabled={startOAuth.isPending}
                    title={startOAuth.isPending ? "Opening GitHub device sign-in..." : "Start GitHub device-code sign-in."}
                    icon={MarkGithubIcon}
                    intent="primary"
                  >
                    {startOAuth.isPending ? "Opening..." : "Connect with GitHub"}
                  </GitHubActionButton>
                  {!browserOAuthFlow && (
                    <GitHubActionButton
                      onClick={() => startBrowserOAuth.mutate()}
                      disabled={startBrowserOAuth.isPending}
                      title={startBrowserOAuth.isPending ? "Opening browser callback sign-in..." : "Start GitHub browser callback sign-in."}
                      icon={ExternalLink}
                    >
                      {startBrowserOAuth.isPending ? "Opening GitHub..." : "Use browser callback"}
                    </GitHubActionButton>
                  )}
                </div>
              )}
            </div>

            {(hasAuthAccountDetails(auth) || accounts.length > 1) && (
              <details className="border-t border-neutral-900">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-neutral-400 transition-colors hover:text-neutral-200">
                  Connection details and saved profiles
                </summary>
                {hasAuthAccountDetails(auth) && (
                  <dl className="grid gap-x-8 gap-y-3 border-t border-neutral-900 px-4 py-3 sm:grid-cols-2 lg:grid-cols-5">
                    <GitHubMetaItem label="Endpoint">{auth.endpoint ?? "https://api.github.com"}</GitHubMetaItem>
                    <GitHubMetaItem label="Status" tone={auth.status === "connected" ? "default" : "warning"}>
                      {auth.status.replaceAll("_", " ")}
                    </GitHubMetaItem>
                    <GitHubMetaItem label="Validated">
                      {auth.lastValidatedAt ? formatDate(auth.lastValidatedAt) : "Not recorded"}
                    </GitHubMetaItem>
                    <GitHubMetaItem label="Token source">
                      {auth.status === "connected" ? (auth.source === "environment" ? "Environment" : "Keychain") : "Unavailable"}
                    </GitHubMetaItem>
                    <GitHubMetaItem label="Scopes">
                      {auth.tokenScopes && auth.tokenScopes.length > 0 ? (
                        <span className="flex min-w-0 flex-wrap gap-1">
                          {auth.tokenScopes.map((scope) => (
                            <span
                              key={scope}
                              className="rounded-md border border-neutral-800 bg-black px-1.5 py-0.5 font-mono text-[11px] leading-none text-neutral-300"
                            >
                              {scope}
                            </span>
                          ))}
                        </span>
                      ) : (
                        "Unknown"
                      )}
                    </GitHubMetaItem>
                  </dl>
                )}

                {accounts.length > 1 && hasAuthAccountDetails(auth) && (
                  <div className="border-t border-neutral-900">
                    <div className="flex h-10 items-center justify-between gap-3 px-4">
                      <div className="text-sm font-medium text-neutral-200">Profiles</div>
                      <div className="text-xs text-neutral-600">{accounts.length} saved locally</div>
                    </div>
                    <div className="border-t border-neutral-900">
                      <div className="hidden h-7 grid-cols-[minmax(180px,1fr)_132px_112px_66px_112px] items-center gap-2 border-b border-neutral-900 px-4 text-[10px] font-medium uppercase tracking-[0.14em] text-neutral-700 xl:grid">
                        <span>Profile</span>
                        <span>Name</span>
                        <span>Color</span>
                        <span>Status</span>
                        <span className="text-right">Actions</span>
                      </div>
                      <div className="divide-y divide-neutral-900">
                        {accounts.map((account) => {
                          const active = account.id === auth.accountId;
                          const draftName = profileNameDrafts[account.id] ?? account.profileName ?? account.login ?? "";
                          const nameChanged = draftName.trim() !== (account.profileName ?? account.login ?? "");
                          return (
                            <div
                              key={account.id}
                              className={`grid gap-2 px-4 py-1.5 transition-colors hover:bg-neutral-950/70 xl:grid-cols-[minmax(180px,1fr)_132px_112px_66px_112px] xl:items-center ${
                                active ? "bg-neutral-950/60" : "bg-transparent"
                              }`}
                            >
                              <div className="flex min-w-0 items-center gap-2.5">
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full ring-2 ring-black"
                                  style={{ backgroundColor: profileColorValue(account.profileColor) }}
                                />
                                <Avatar
                                  seed={account.login ?? "GitHub"}
                                  src={renderableAvatarUrl(account.avatarCachedUrl, account.avatarUrl)}
                                  size="sm"
                                />
                                <div className="min-w-0">
                                  <div className="truncate text-[13px] font-medium text-neutral-200">
                                    {account.profileName ?? account.login ?? "GitHub profile"}
                                  </div>
                                  <div className="truncate text-xs text-neutral-600">
                                    {account.login ?? "unknown"} - {endpointLabel(account.endpoint)}
                                  </div>
                                </div>
                              </div>
                              <input
                                aria-label={`${account.login ?? "GitHub"} profile name`}
                                value={draftName}
                                onChange={(event) =>
                                  setProfileNameDrafts((current) => ({ ...current, [account.id]: event.currentTarget.value }))
                                }
                                className="h-7 min-w-0 rounded-md border border-neutral-900 bg-black px-2 text-xs text-neutral-300 outline-none transition-colors placeholder:text-neutral-700 focus:border-neutral-700 focus-visible:ring-1 focus-visible:ring-neutral-600/45"
                              />
                              <div className="relative">
                                <span
                                  className="pointer-events-none absolute left-2 top-1/2 z-10 h-2 w-2 -translate-y-1/2 rounded-full"
                                  style={{ backgroundColor: profileColorValue(account.profileColor) }}
                                />
                                <NativeSelect
                                  size="sm"
                                  value={account.profileColor ?? ""}
                                  disabled={updateProfileColor.isPending}
                                  className="h-7 w-[112px] border-neutral-900 bg-black px-2 py-0 pl-6 pr-7 text-xs text-neutral-300 shadow-none hover:bg-neutral-950"
                                  onChange={(event) =>
                                    updateProfileColor.mutate({
                                      profileId: account.id,
                                      color: event.currentTarget.value || null
                                    })
                                  }
                                >
                                  {profileColorOptions.map((option) => (
                                    <NativeSelectOption key={option.value} value={option.value}>
                                      {option.label}
                                    </NativeSelectOption>
                                  ))}
                                </NativeSelect>
                              </div>
                              <GitHubStatusPill
                                tone={active ? "success" : "neutral"}
                                className="h-5 px-1.5 text-[11px] before:h-1 before:w-1"
                              >
                                {active ? "Active" : "Idle"}
                              </GitHubStatusPill>
                              <div className="flex flex-nowrap items-center gap-2 xl:justify-end">
                                <GitHubActionButton
                                  type="button"
                                  onClick={() => renameProfile.mutate({ profileId: account.id, name: draftName })}
                                  disabled={!nameChanged || !draftName.trim() || renameProfile.isPending}
                                  icon={Save}
                                  iconClassName="h-6 w-6"
                                  iconStrokeWidth={2.5}
                                  intent="quiet"
                                  className="h-8 w-8 px-0"
                                  aria-label={`Save ${account.login ?? "GitHub profile"} profile name`}
                                  title={`Save ${account.login ?? "GitHub profile"} profile name`}
                                  hoverLabel="Save"
                                />
                                <GitHubActionButton
                                  type="button"
                                  onClick={() => reconnectProfile.mutate(account.id)}
                                  disabled={reconnectProfile.isPending}
                                  icon={RefreshCcw}
                                  iconClassName="h-6 w-6"
                                  iconStrokeWidth={2.5}
                                  intent="quiet"
                                  className="h-8 w-8 px-0"
                                  aria-label={`Reconnect ${account.login ?? "GitHub profile"}`}
                                  title={`Reconnect ${account.login ?? "GitHub profile"}`}
                                  hoverLabel="Reconnect"
                                />
                                <GitHubActionButton
                                  type="button"
                                  onClick={() => setProfileRemovalTarget(account)}
                                  disabled={removeProfile.isPending}
                                  icon={Trash2}
                                  iconClassName="h-6 w-6"
                                  iconStrokeWidth={2.5}
                                  intent="danger"
                                  className="h-8 w-8 px-0"
                                  aria-label={`Remove ${account.login ?? "GitHub profile"}`}
                                  title={`Remove ${account.login ?? "GitHub profile"}`}
                                  hoverLabel="Remove"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="border-t border-neutral-900 px-4 py-3">
                      <GitHubActionButton
                        onClick={() => setConfirmAction("remove-all-accounts")}
                        disabled={deleteAllAccounts.isPending || disconnectGitHub.isPending}
                        title={
                          deleteAllAccounts.isPending || disconnectGitHub.isPending
                            ? "Wait for the current account operation to finish."
                            : "Remove saved GitHub accounts, tokens, and managed repository folders."
                        }
                        icon={Trash2}
                        intent="danger"
                      >
                        {deleteAllAccounts.isPending ? "Removing..." : "Remove all saved accounts"}
                      </GitHubActionButton>
                    </div>
                  </div>
                )}
              </details>
            )}

            {browserOAuthFlow && (
              <div className="m-5 flex flex-wrap items-center gap-3 rounded-md border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-sm text-blue-100/80">
                <ExternalLink className="h-4 w-4 text-blue-200/70" />
                <span className="mr-auto">
                  Complete sign-in in your browser. If GitHub rejects the callback URL, use device code instead.
                </span>
                <GitHubActionButton
                  onClick={() => cancelBrowserOAuth.mutate()}
                  disabled={cancelBrowserOAuth.isPending}
                  title={cancelBrowserOAuth.isPending ? "Canceling browser sign-in..." : "Cancel the pending browser sign-in flow."}
                  intent="quiet"
                >
                  {cancelBrowserOAuth.isPending ? "Canceling..." : "Cancel"}
                </GitHubActionButton>
                <GitHubActionButton
                  onClick={() => startOAuth.mutate()}
                  disabled={startOAuth.isPending}
                  title={startOAuth.isPending ? "Opening GitHub device sign-in..." : "Use the device-code fallback instead."}
                  intent="primary"
                >
                  {startOAuth.isPending ? "Opening..." : "Use device code instead"}
                </GitHubActionButton>
              </div>
            )}
            {oauthFlow && (
              <div className="m-5 flex flex-wrap items-center gap-3 rounded-md border border-neutral-800 bg-black/40 px-3 py-3">
                <div className="inline-flex items-center gap-2 rounded-md border border-neutral-700 bg-[#111111] px-3 py-2 text-white">
                  <span className="font-mono text-sm font-semibold tracking-[0.18em]">{oauthFlow.userCode}</span>
                  <button
                    type="button"
                    onClick={() => void copyUserCode()}
                    className="inline-grid h-6 w-6 place-items-center rounded text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600"
                    aria-label={codeCopied ? "Code copied" : "Copy code"}
                    title={codeCopied ? "Copied" : "Copy code"}
                  >
                    {codeCopied ? (
                      <Check className="h-3.5 w-3.5" aria-hidden={true} />
                    ) : (
                      <Copy className="h-3.5 w-3.5" aria-hidden={true} />
                    )}
                  </button>
                </div>
                <span className="mr-auto text-sm text-neutral-500">Authorize in GitHub; Fallback will detect access automatically.</span>
                <GitHubActionButton
                  onClick={() => void completeDeviceSignIn(oauthFlow.deviceCode)}
                  disabled={oauthChecking}
                  title={oauthChecking ? "Checking the GitHub OAuth device code..." : "Check whether GitHub authorization is complete."}
                  intent="primary"
                >
                  {oauthChecking ? "Checking..." : "Check now"}
                </GitHubActionButton>
              </div>
            )}
            {auth.status !== "connected" && (
              <form
                className="border-t border-neutral-900 px-5 py-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  connectGitHub.mutate();
                }}
              >
                <InputGroup>
                  <InputGroupInput
                    ref={tokenInput}
                    aria-label="GitHub token"
                    onChange={(e) => setHasToken(Boolean(e.currentTarget.value.trim()))}
                    type="password"
                    placeholder="Or paste a GitHub token..."
                    className="max-w-md"
                  />
                  <InputGroupButton
                    type="submit"
                    disabled={connectGitHub.isPending || !hasToken}
                    title={
                      connectGitHub.isPending
                        ? "Connecting GitHub token..."
                        : !hasToken
                          ? "Paste a GitHub token before connecting."
                          : "Connect using the pasted GitHub token."
                    }
                  >
                    {connectGitHub.isPending ? "Connecting..." : "Connect token"}
                  </InputGroupButton>
                </InputGroup>
              </form>
            )}
          </div>
        </section>

        {/* Watch Repositories */}
        <section>
          <h2 className="text-sm font-medium text-neutral-400 mb-3 uppercase tracking-wider">Repositories</h2>
          <div className="border border-neutral-800 rounded-lg p-5 bg-[#0A0A0A] space-y-4">
            <div>
              <div className="text-neutral-200 font-medium">Choose what Fallback should follow</div>
              <div className="text-neutral-500 text-sm mt-1">
                Add repositories you want in My Work, Pull requests, Issues, Actions, and Code.
              </div>
            </div>
            <form
              className="flex items-center space-x-2"
              onSubmit={(e) => {
                e.preventDefault();
                const fullName = manualRepo.trim();
                if (fullName) watchRepo.mutate(fullName);
              }}
            >
              <input
                aria-label="Repository full name"
                value={manualRepo}
                onChange={(e) => setManualRepo(e.target.value)}
                placeholder="owner/name"
                spellCheck={false}
                disabled={auth.status !== "connected"}
                title={
                  auth.status !== "connected"
                    ? "Connect GitHub before watching a repository."
                    : "Repository full name, for example owner/name"
                }
                className="bg-[#050505] border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-300 w-full max-w-md focus:border-neutral-600 disabled:opacity-50"
              />
              <button
                disabled={Boolean(settingsWatchBlockReason)}
                title={settingsWatchBlockReason ?? `Watch ${settingsManualRepoName}`}
                className="h-9 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 px-4 rounded-md text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-50"
              >
                {watchRepo.isPending ? "Watching..." : "Watch"}
              </button>
            </form>
            {auth.status === "connected" && !showRepoPicker && (
              <button
                onClick={() => setShowRepoPicker(true)}
                className="h-9 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 px-3 rounded-md text-[13px] font-medium transition-colors cursor-pointer"
              >
                Browse GitHub repositories
              </button>
            )}
            {auth.status === "connected" && (
              <details className="max-w-2xl rounded-md border border-neutral-800 bg-black px-3 py-2 text-xs leading-5 text-neutral-500">
                <summary className="cursor-pointer text-neutral-400">Privacy note</summary>
                <p className="mt-2">
                  Private repository metadata is cached locally in the selected workspace. Fallback does not encrypt the SQLite cache; use
                  OS disk encryption for private workspaces.
                </p>
              </details>
            )}
            {auth.status === "connected" && showRepoPicker && (
              <RepoPicker
                repos={availableRepos}
                watchedRepos={watchedRepos}
                loading={reposLoading}
                query={repoSearch}
                watching={watchRepo.isPending}
                onQuery={setRepoSearch}
                onWatch={(fullName) => watchRepo.mutate(fullName)}
              />
            )}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-medium text-neutral-400 mb-3 uppercase tracking-wider">Preferences</h2>
          <div className="rounded-lg border border-neutral-800 bg-[#0A0A0A] p-5">
            <div className="space-y-3">
              <div className="flex flex-col gap-3 rounded-md border border-neutral-900 bg-black/40 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-neutral-300">Sync automatically</div>
                  <div className="mt-0.5 text-xs text-neutral-600">Check GitHub for new work on this cadence.</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-600">Every</span>
                  <NativeSelect
                    size="sm"
                    value={settings?.syncFrequencyMinutes ?? 15}
                    disabled={updateSettings.isPending}
                    onChange={(event) => updateSettings.mutate({ syncFrequencyMinutes: Number(event.currentTarget.value) })}
                    className="h-8 w-[104px] border-neutral-800 bg-neutral-950/80 px-2.5 pr-7 text-[13px] text-neutral-200 shadow-none hover:bg-neutral-900"
                  >
                    {syncFrequencyOptions.map((minutes) => (
                      <NativeSelectOption key={minutes} value={minutes}>
                        {syncFrequencyLabel(minutes)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              </div>
              <label className="flex cursor-pointer flex-col gap-3 rounded-md border border-neutral-900 bg-black/40 px-3 py-2.5 transition-colors hover:border-neutral-800 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-neutral-300">Restore Windows on Launch</div>
                  <div className="mt-0.5 text-xs text-neutral-600">Reopen repo and workspace windows from the last session.</div>
                </div>
                <input
                  type="checkbox"
                  checked={Boolean(settings?.restoreWindowsOnLaunch)}
                  disabled={!settings || updateSettings.isPending}
                  onChange={(event) => updateSettings.mutate({ restoreWindowsOnLaunch: event.currentTarget.checked })}
                  className="h-4 w-4 shrink-0 rounded border-neutral-700 bg-neutral-950 accent-neutral-200"
                />
              </label>
            </div>
          </div>
        </section>

        <section>
          <details className="overflow-hidden rounded-lg border border-neutral-800 bg-[#0A0A0A]">
            <summary className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4 text-sm font-medium uppercase tracking-wider text-neutral-400 transition-colors hover:text-neutral-200">
              <span>Keybindings</span>
              <Keyboard className="h-4 w-4 text-neutral-600" aria-hidden="true" />
            </summary>
            <div className="border-t border-neutral-800 px-5 py-3 text-sm text-neutral-500">
              Click a command, press a shortcut, or reset to the default.
            </div>
            <div className="hidden grid-cols-[minmax(180px,1fr)_160px_88px] items-center gap-3 border-b border-neutral-800 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-600 md:grid">
              <span>Command</span>
              <span>Shortcut</span>
              <span className="text-right">Reset</span>
            </div>
            <div className="divide-y divide-neutral-900">
              {commandPaletteKeybindingRows.map((row) => (
                <KeybindingCaptureRow
                  key={row.id}
                  id={row.id}
                  label={row.label}
                  description={row.description}
                  value={commandPaletteKeybindings[row.id]}
                  defaultValue={defaultCommandPaletteKeybindings[row.id]}
                  disabled={updateSettings.isPending}
                  onChange={updateCommandPaletteKeybinding}
                />
              ))}
            </div>
          </details>
        </section>

        <section>
          <h2 className="text-sm font-medium text-neutral-400 mb-3 uppercase tracking-wider">Storage</h2>
          <div className="border border-neutral-800 rounded-lg bg-[#0A0A0A] divide-y divide-neutral-800">
            <div className="p-5">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <div className="text-neutral-200 font-medium">Local storage</div>
                  <div className="text-neutral-500 text-sm mt-1">
                    {cache
                      ? `${cache.watchedRepos} repos · ${cache.pullRequests} PRs · ${cache.issues} issues · ${cache.comments} comments`
                      : "Calculate storage when you want to review local cache size."}
                  </div>
                </div>
                <span className="text-neutral-400 text-sm font-mono whitespace-nowrap">
                  {cache ? formatBytes(cache.totalBytes) : "Not loaded"}
                </span>
              </div>
              <div className="space-y-4">
                {cache ? (
                  <StorageUsageBar cache={cache} />
                ) : (
                  <button
                    onClick={() => loadCacheDetails.mutate()}
                    disabled={loadCacheDetails.isPending}
                    title={
                      loadCacheDetails.isPending
                        ? "Counting local cache data..."
                        : "Calculate local cache storage before destructive cleanup."
                    }
                    className="h-9 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 px-3 rounded-md text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {loadCacheDetails.isPending ? "Counting..." : "Calculate storage"}
                  </button>
                )}
                <div className="flex flex-col gap-3 rounded-md border border-neutral-900 bg-black/40 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-neutral-300">Closed issues</div>
                    <div className="mt-0.5 text-xs text-neutral-600">Clean up cached closed issues after this age.</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-neutral-600">Older than</span>
                    <NativeSelect
                      size="sm"
                      value={settings?.closedIssueRetentionDays ?? 365}
                      disabled={updateSettings.isPending}
                      onChange={(event) => updateSettings.mutate({ closedIssueRetentionDays: Number(event.currentTarget.value) })}
                      className="h-8 w-[112px] border-neutral-800 bg-neutral-950/80 px-2.5 pr-7 text-[13px] text-neutral-200 shadow-none hover:bg-neutral-900"
                    >
                      {closedIssueRetentionOptions.map((days) => (
                        <NativeSelectOption key={days} value={days}>
                          {closedIssueRetentionLabel(days)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </div>
                </div>
              </div>
            </div>
            <details className="p-5">
              <summary className="cursor-pointer text-sm font-medium text-neutral-300 transition-colors hover:text-neutral-100">
                Workspace location
              </summary>
              <div className="mt-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-neutral-500 text-sm font-mono text-xs">
                    {settingsLoading || settings.workspacePath === "Not loaded" ? "Loading..." : settings.workspacePath}
                  </div>
                  <div className="mt-1 max-w-2xl text-xs text-neutral-600">
                    Changing this path changes where Fallback stores clones, cache, logs, diagnostics, and config. Existing data is not
                    migrated or deleted automatically.
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (settings?.workspacePath && settings.workspacePath !== "Not loaded") {
                      void window.fallback.shell.revealPath(settings.workspacePath).catch((error) => setNotice(errorMessage(error)));
                    }
                  }}
                  disabled={!settings?.workspacePath || settings.workspacePath === "Not loaded"}
                  title="Reveal current workspace in Finder"
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900 px-3 text-[13px] font-medium text-neutral-300 transition-colors hover:bg-neutral-800 disabled:opacity-50"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  Reveal
                </button>
              </div>
            </details>
            <details className="p-5">
              <summary className="cursor-pointer text-sm font-medium text-neutral-300 transition-colors hover:text-neutral-100">
                Danger zone
              </summary>
              <div className="mt-4 flex items-center justify-between gap-4 rounded-md border border-neutral-900 bg-black px-3 py-3">
                <div>
                  <div className="font-medium text-neutral-200">Clear all local data</div>
                  <div className="mt-1 text-sm text-neutral-500">
                    Remove synced repositories, cached GitHub context, and Fallback-managed local clone folders.
                  </div>
                  <div className="text-neutral-500 text-xs mt-2 max-w-[560px]">
                    Private repo names, issues, pull requests, review drafts, and local bookkeeping stay in the selected workspace as an
                    unencrypted SQLite cache. GitHub tokens stay in OS secure storage.
                  </div>
                </div>
                <button
                  onClick={() => setConfirmAction("clear-all-data")}
                  disabled={deleteAll.isPending}
                  title={deleteAll.isPending ? "Clearing local data..." : "Open confirmation before clearing all local cache data."}
                  className="h-9 rounded-md border border-neutral-800 bg-neutral-900 px-4 text-[13px] font-medium text-neutral-400 transition-colors hover:border-red-700/30 hover:bg-red-200/35 hover:text-red-900 disabled:cursor-wait disabled:opacity-50"
                >
                  {deleteAll.isPending ? "Clearing..." : "Clear data"}
                </button>
              </div>
            </details>
          </div>
        </section>

        <details className="rounded-lg border border-neutral-800 bg-[#0A0A0A]">
          <summary className="cursor-pointer px-5 py-4 text-sm font-medium uppercase tracking-wider text-neutral-400 transition-colors hover:text-neutral-200">
            Advanced settings
          </summary>
          <div className="divide-y divide-neutral-800 border-t border-neutral-800">
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-neutral-200 font-medium">App updates</div>
                  <div className="text-neutral-500 text-sm mt-1">Stable releases from GitHub.</div>
                </div>
                {appUpdate && <UpdateStatusPill state={appUpdate} />}
              </div>
              {appUpdate ? (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-4">
                    <SettingsMeta label="Current">{appUpdate.currentVersion}</SettingsMeta>
                    <SettingsMeta label="Latest">{appUpdate.availableVersion ?? "Not checked"}</SettingsMeta>
                    <SettingsMeta label="Checked">{appUpdate.checkedAt ? formatDate(appUpdate.checkedAt) : "Never"}</SettingsMeta>
                    <SettingsMeta label="Release">{appUpdate.releaseName ?? "Stable"}</SettingsMeta>
                  </div>
                  {appUpdate.downloadPercent != null && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-neutral-500">
                        <span>Download</span>
                        <span>{Math.round(appUpdate.downloadPercent)}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-neutral-900">
                        <div
                          className="h-full rounded-full bg-neutral-200 transition-[width]"
                          style={{ width: `${Math.max(0, Math.min(100, appUpdate.downloadPercent))}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {appUpdate.message && (
                    <div className="rounded-md border border-neutral-800 bg-black px-3 py-2 text-sm text-neutral-500">
                      {appUpdate.message}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <GitHubActionButton
                      onClick={() => checkAppUpdate.mutate()}
                      disabled={
                        !appUpdate.enabled ||
                        checkAppUpdate.isPending ||
                        appUpdate.status === "checking" ||
                        appUpdate.status === "downloading"
                      }
                      title={
                        appUpdate.enabled
                          ? "Check GitHub Releases for the latest stable Fallback build."
                          : (appUpdate.message ?? "Updates disabled.")
                      }
                      icon={RefreshCcw}
                    >
                      {appUpdate.status === "checking" || checkAppUpdate.isPending ? "Checking..." : "Check for updates"}
                    </GitHubActionButton>
                    <GitHubActionButton
                      onClick={() => downloadAppUpdate.mutate()}
                      disabled={appUpdate.status !== "available" || downloadAppUpdate.isPending}
                      title={appUpdate.status === "available" ? "Download the available stable update." : "No update is ready to download."}
                      icon={Download}
                      intent="primary"
                    >
                      {appUpdate.status === "downloading" || downloadAppUpdate.isPending ? "Downloading..." : "Update"}
                    </GitHubActionButton>
                    <GitHubActionButton
                      onClick={() => installAppUpdate.mutate()}
                      disabled={appUpdate.status !== "downloaded" || installAppUpdate.isPending}
                      title={
                        appUpdate.status === "downloaded"
                          ? "Restart Fallback and install the downloaded update."
                          : "No downloaded update is ready."
                      }
                      icon={RotateCcw}
                      intent="primary"
                    >
                      Restart to install
                    </GitHubActionButton>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-neutral-500">Loading update state...</div>
              )}
            </div>
            <div className="p-5 space-y-4">
              <div>
                <div className="text-neutral-200 font-medium">Editor and terminal</div>
                <div className="text-neutral-500 text-sm mt-1">
                  Optional launcher commands used before Fallback tries platform defaults.
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1.5 text-xs text-neutral-500">
                  <span className="font-medium text-neutral-400">Preferred editor command</span>
                  <input
                    type="text"
                    value={settings.shell.preferredEditorCommand ?? ""}
                    placeholder="code --reuse-window"
                    onChange={(event) =>
                      updateSettings.mutate({
                        shell: {
                          ...settings.shell,
                          preferredEditorCommand: event.currentTarget.value.trim() || null
                        }
                      })
                    }
                    className="ui-input h-9 font-mono"
                  />
                </label>
                <label className="grid gap-1.5 text-xs text-neutral-500">
                  <span className="font-medium text-neutral-400">Preferred terminal command</span>
                  <input
                    type="text"
                    value={settings.shell.preferredTerminalCommand ?? ""}
                    placeholder="gnome-terminal --working-directory"
                    onChange={(event) =>
                      updateSettings.mutate({
                        shell: {
                          ...settings.shell,
                          preferredTerminalCommand: event.currentTarget.value.trim() || null
                        }
                      })
                    }
                    className="ui-input h-9 font-mono"
                  />
                </label>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <div className="text-neutral-200 font-medium">My Work inbox</div>
                <div className="text-neutral-500 text-sm mt-1">Choose what gets promoted from Notifications into My Work.</div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {[
                  ["collapseBotActivity", "Collapse bot activity"],
                  ["promoteFailingChecks", "Promote failing checks on my PRs"],
                  ["promoteDirectMentions", "Promote direct mentions"],
                  ["promoteReviewRequests", "Promote review requests"],
                  ["quietPassingCi", "Quiet passing CI"]
                ].map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center justify-between gap-3 rounded-md border border-neutral-800 bg-black px-3 py-2 text-sm text-neutral-300"
                  >
                    <span>{label}</span>
                    <input
                      type="checkbox"
                      checked={Boolean(settings.attention[key as keyof AppSettings["attention"]])}
                      onChange={(event) =>
                        updateSettings.mutate({
                          attention: {
                            ...settings.attention,
                            [key]: event.currentTarget.checked
                          }
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-xs text-neutral-500">
                  <span>Working hours start</span>
                  <input
                    type="time"
                    value={settings.attention.workingHoursStart}
                    onChange={(event) =>
                      updateSettings.mutate({ attention: { ...settings.attention, workingHoursStart: event.currentTarget.value } })
                    }
                    className="h-9 rounded-md border border-neutral-800 bg-black px-3 text-sm text-neutral-300"
                  />
                </label>
                <label className="grid gap-1 text-xs text-neutral-500">
                  <span>Working hours end</span>
                  <input
                    type="time"
                    value={settings.attention.workingHoursEnd}
                    onChange={(event) =>
                      updateSettings.mutate({ attention: { ...settings.attention, workingHoursEnd: event.currentTarget.value } })
                    }
                    className="h-9 rounded-md border border-neutral-800 bg-black px-3 text-sm text-neutral-300"
                  />
                </label>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <div className="text-neutral-200 font-medium">Branch Watch</div>
                <div className="text-neutral-500 text-sm mt-1">
                  Lightweight monitoring records branch snapshots during sync. Audits explain suspicious branch changes with evidence.
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex items-center justify-between gap-3 rounded-md border border-neutral-800 bg-black px-3 py-2 text-sm text-neutral-300">
                  <span>Enable monitoring</span>
                  <input
                    type="checkbox"
                    checked={settings.branchIntegrity.enabled}
                    onChange={(event) =>
                      updateSettings.mutate({ branchIntegrity: { ...settings.branchIntegrity, enabled: event.currentTarget.checked } })
                    }
                  />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-md border border-neutral-800 bg-black px-3 py-2 text-sm text-neutral-300">
                  <span>
                    <span className="block">Fetch safety refs</span>
                    <span className="mt-0.5 block text-xs text-neutral-600">Advanced evidence refs used during full audits.</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.branchIntegrity.fetchSafetyRefs}
                    onChange={(event) =>
                      updateSettings.mutate({
                        branchIntegrity: { ...settings.branchIntegrity, fetchSafetyRefs: event.currentTarget.checked }
                      })
                    }
                  />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-md border border-neutral-800 bg-black px-3 py-2 text-sm text-neutral-300">
                  <span>
                    <span className="block">Audit changed branches automatically</span>
                    <span className="mt-0.5 block text-xs text-neutral-600">
                      When the default branch changes during sync, run a bounded integrity audit.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.branchIntegrity.automaticAuditAfterSync}
                    onChange={(event) =>
                      updateSettings.mutate({
                        branchIntegrity: { ...settings.branchIntegrity, automaticAuditAfterSync: event.currentTarget.checked }
                      })
                    }
                  />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-md border border-neutral-800 bg-black px-3 py-2 text-sm text-neutral-300">
                  <span>Release gate requires exact tree</span>
                  <input
                    type="checkbox"
                    checked={settings.branchIntegrity.requireExactMergeGroupTreeForReleases}
                    onChange={(event) =>
                      updateSettings.mutate({
                        branchIntegrity: {
                          ...settings.branchIntegrity,
                          requireExactMergeGroupTreeForReleases: event.currentTarget.checked
                        }
                      })
                    }
                  />
                </label>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="grid gap-1 text-xs text-neutral-500">
                  <span>Alert threshold</span>
                  <NativeSelect
                    value={settings.branchIntegrity.alertThreshold}
                    onChange={(event) =>
                      updateSettings.mutate({
                        branchIntegrity: {
                          ...settings.branchIntegrity,
                          alertThreshold: event.currentTarget.value as AppSettings["branchIntegrity"]["alertThreshold"]
                        }
                      })
                    }
                  >
                    {(["critical", "high", "medium", "low"] as const).map((severity) => (
                      <NativeSelectOption key={severity} value={severity}>
                        {severity}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
                <label className="grid gap-1 text-xs text-neutral-500">
                  <span>Large-diff ratio</span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={settings.branchIntegrity.largeDiffRatioThreshold}
                    onChange={(event) =>
                      updateSettings.mutate({
                        branchIntegrity: {
                          ...settings.branchIntegrity,
                          largeDiffRatioThreshold: Number(event.currentTarget.value)
                        }
                      })
                    }
                    className="h-9 rounded-md border border-neutral-800 bg-black px-3 text-sm text-neutral-300"
                  />
                </label>
                <label className="grid gap-1 text-xs text-neutral-500">
                  <span>Large-diff lines</span>
                  <input
                    type="number"
                    min={50}
                    max={10000}
                    value={settings.branchIntegrity.largeDiffAbsoluteThreshold}
                    onChange={(event) =>
                      updateSettings.mutate({
                        branchIntegrity: {
                          ...settings.branchIntegrity,
                          largeDiffAbsoluteThreshold: Number(event.currentTarget.value)
                        }
                      })
                    }
                    className="h-9 rounded-md border border-neutral-800 bg-black px-3 text-sm text-neutral-300"
                  />
                </label>
              </div>
            </div>
            <div className="p-5">
              <div className="mb-3">
                <div className="text-neutral-200 font-medium">Local troubleshooting</div>
                <div className="text-neutral-500 text-sm mt-1">Load local paths or cache counts only when debugging settings.</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => loadLocalDetails.mutate()}
                  disabled={loadLocalDetails.isPending}
                  title={loadLocalDetails.isPending ? "Loading local settings..." : "Load local paths and settings from disk."}
                  className="h-9 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 px-4 rounded-md text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-50"
                >
                  {loadLocalDetails.isPending ? "Loading..." : "Load settings"}
                </button>
                <button
                  onClick={() => loadCacheDetails.mutate()}
                  disabled={loadCacheDetails.isPending}
                  title={
                    loadCacheDetails.isPending ? "Counting local cache data..." : "Load repository, issue, PR, and local storage counts."
                  }
                  className="h-9 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 px-4 rounded-md text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-50"
                >
                  {loadCacheDetails.isPending ? "Counting..." : "Load cache counts"}
                </button>
              </div>
            </div>
          </div>
        </details>
      </div>
      {confirmAction === "disconnect" && (
        <ConfirmDialog
          title="Disconnect GitHub?"
          objectName={hasAuthAccountDetails(auth) ? `${auth.login ?? "GitHub user"} · ${endpointLabel(auth.endpoint)}` : "GitHub account"}
          body={
            <div className="space-y-2">
              <p>This removes the active GitHub token from Fallback and stops authenticated sync and GitHub write actions.</p>
              <p>Cached repository data, local settings, and local clones remain on this computer.</p>
            </div>
          }
          confirmLabel="Disconnect GitHub"
          pendingLabel="Disconnecting..."
          pending={disconnectGitHub.isPending}
          error={disconnectGitHub.error ? errorMessage(disconnectGitHub.error) : null}
          onCancel={() => {
            if (!disconnectGitHub.isPending) setConfirmAction(null);
          }}
          onConfirm={() => disconnectGitHub.mutate()}
        />
      )}
      {confirmAction === "remove-all-accounts" && (
        <ConfirmDialog
          title="Remove all GitHub accounts?"
          objectName={
            accounts.length > 0 ? `${accounts.length} saved ${accounts.length === 1 ? "account" : "accounts"}` : "Saved GitHub accounts"
          }
          body={
            <div className="space-y-2">
              <p>Fallback will remove every saved GitHub account and token from local auth storage.</p>
              <p>Managed repository folders for those accounts will be deleted from the Fallback workspace.</p>
            </div>
          }
          confirmLabel="Remove all accounts"
          pendingLabel="Removing..."
          pending={deleteAllAccounts.isPending}
          error={deleteAllAccounts.error ? errorMessage(deleteAllAccounts.error) : null}
          onCancel={() => {
            if (!deleteAllAccounts.isPending) setConfirmAction(null);
          }}
          onConfirm={() => deleteAllAccounts.mutate()}
        />
      )}
      {confirmAction === "clear-all-data" && (
        <ConfirmDialog
          title="Clear all local data?"
          objectName="Fallback local cache"
          body={
            <div className="space-y-3">
              <p>This removes Fallback's local synced repository records, offline GitHub context, and managed local clone folders.</p>
              <div className="rounded-md border border-neutral-900 bg-black/30 px-3 py-2 font-mono text-xs text-neutral-500">
                {cache ? (
                  <>
                    <div>{formatBytes(cache.totalBytes)} total local data</div>
                    <div>
                      {cache.watchedRepos} repos · {cache.pullRequests} PRs · {cache.issues} issues · {cache.comments} comments
                    </div>
                  </>
                ) : (
                  <div>Cache counts are not loaded. Use Load cache counts to preview exact totals.</div>
                )}
              </div>
              <p>GitHub account tokens are managed separately and are not deleted by this action.</p>
            </div>
          }
          confirmLabel="Clear all local data"
          pendingLabel="Clearing..."
          typedConfirmation="DELETE"
          typedConfirmationLabel="Type DELETE to clear all local Fallback cache data."
          pending={deleteAll.isPending}
          error={deleteAll.error ? errorMessage(deleteAll.error) : null}
          onCancel={() => {
            if (!deleteAll.isPending) setConfirmAction(null);
          }}
          onConfirm={() => deleteAll.mutate()}
        />
      )}
      {profileRemovalTarget && (
        <ConfirmDialog
          title="Remove GitHub profile?"
          objectName={`${profileRemovalTarget.profileName ?? profileRemovalTarget.login ?? "GitHub profile"} · ${endpointLabel(profileRemovalTarget.endpoint)}`}
          body={
            <div className="space-y-2">
              <p>Fallback will remove this saved profile and its token from local auth storage.</p>
              <p>Managed repository folders watched only by this profile will be deleted from the Fallback workspace.</p>
            </div>
          }
          confirmLabel="Remove profile"
          pendingLabel="Removing..."
          pending={removeProfile.isPending}
          error={removeProfile.error ? errorMessage(removeProfile.error) : null}
          onCancel={() => {
            if (!removeProfile.isPending) setProfileRemovalTarget(null);
          }}
          onConfirm={() => removeProfile.mutate(profileRemovalTarget.id)}
        />
      )}
    </div>
  );
}

const profileColorOptions = [
  { value: "", label: "No color", color: "#525252" },
  { value: "blue", label: "Blue", color: "#3b82f6" },
  { value: "green", label: "Green", color: "#22c55e" },
  { value: "amber", label: "Amber", color: "#f59e0b" },
  { value: "rose", label: "Rose", color: "#f43f5e" },
  { value: "violet", label: "Violet", color: "#8b5cf6" }
] as const;

function profileColorValue(color: string | null | undefined): string {
  return profileColorOptions.find((option) => option.value === color)?.color ?? "#525252";
}

function appUpdateNotice(state: AppUpdateState): string {
  if (state.status === "available") return `Fallback ${state.availableVersion ?? "update"} is ready to download.`;
  if (state.status === "downloaded")
    return `Fallback ${state.downloadedVersion ?? state.availableVersion ?? "update"} is ready to install.`;
  if (state.status === "idle") return state.message ?? "Fallback is up to date.";
  if (state.status === "error") return state.message ?? "Update check failed.";
  return state.message ?? state.status;
}

function SettingsMeta({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="min-w-0 rounded-md border border-neutral-900 bg-black px-3 py-2">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-700">{label}</div>
      <div className="truncate font-mono text-xs leading-5 text-neutral-300">{children}</div>
    </div>
  );
}

function UpdateStatusPill({ state }: { state: AppUpdateState }) {
  const tone =
    state.status === "available" || state.status === "downloaded"
      ? "success"
      : state.status === "error" || state.status === "disabled"
        ? "warning"
        : "neutral";
  const label =
    state.status === "available"
      ? "Update available"
      : state.status === "downloaded"
        ? "Ready"
        : state.status === "downloading"
          ? "Downloading"
          : state.status === "checking"
            ? "Checking"
            : state.status;
  return <GitHubStatusPill tone={tone}>{label}</GitHubStatusPill>;
}

function KeybindingCaptureRow({
  id,
  label,
  description,
  value,
  defaultValue,
  disabled,
  onChange
}: {
  id: CommandPaletteKeybindingActionId;
  label: string;
  description: string;
  value: string | null;
  defaultValue: string | null;
  disabled: boolean;
  onChange: (id: CommandPaletteKeybindingActionId, binding: string | null) => void;
}) {
  const isDefault = value === defaultValue;
  return (
    <div className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(180px,1fr)_160px_88px] md:items-center">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-neutral-200">{label}</div>
        <div className="mt-0.5 truncate text-xs text-neutral-600">{description}</div>
      </div>
      <button
        type="button"
        disabled={disabled}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.currentTarget.blur();
            return;
          }
          if (event.key === "Tab") return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Backspace" || event.key === "Delete") {
            onChange(id, null);
            return;
          }
          const binding = keybindingFromKeyboardEvent(event);
          if (binding) onChange(id, binding);
        }}
        className="group inline-flex h-9 min-w-0 items-center justify-between gap-2 rounded-md border border-neutral-800 bg-black px-2.5 text-left outline-none transition-colors hover:border-neutral-700 hover:bg-neutral-950 focus-visible:border-neutral-600 focus-visible:ring-1 focus-visible:ring-neutral-600/45 disabled:cursor-wait disabled:opacity-50"
        title="Focus, then press a new shortcut. Backspace clears it."
        aria-label={`${label} keybinding`}
      >
        <span className="min-w-0 truncate font-mono text-xs text-neutral-300">{value ?? "Unassigned"}</span>
        <span className="shrink-0 text-[11px] text-neutral-700 group-focus-visible:text-neutral-500">Press</span>
      </button>
      <button
        type="button"
        disabled={disabled || isDefault}
        onClick={() => onChange(id, defaultValue)}
        className="inline-flex h-8 items-center justify-center rounded-md border border-neutral-800 bg-neutral-950 px-2 text-xs font-medium text-neutral-500 outline-none transition-colors hover:border-neutral-700 hover:text-neutral-200 focus-visible:ring-1 focus-visible:ring-neutral-600/45 disabled:cursor-not-allowed disabled:opacity-40 md:justify-self-end"
        title={isDefault ? "Already using the default shortcut." : `Reset ${label} to ${defaultValue ?? "unassigned"}.`}
      >
        Reset
      </button>
    </div>
  );
}

function keybindingFromKeyboardEvent(event: React.KeyboardEvent<HTMLElement>): string | null {
  if (event.key === "Control" || event.key === "Alt" || event.key === "Shift" || event.key === "Meta") return null;
  const key = keybindingBaseKey(event.key);
  if (!key) return null;
  const parts = [
    event.ctrlKey ? "Ctrl" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    event.metaKey ? "Cmd" : "",
    key
  ].filter(Boolean);
  return parts.join("+");
}

function keybindingBaseKey(key: string): string | null {
  if (key.length === 1) return /^[a-z0-9,.[\]\\/;'"`=-]$/i.test(key) ? key.toUpperCase() : null;
  const normalized = key.toLowerCase();
  if (normalized === "enter" || normalized === "return") return "Enter";
  if (normalized === " ") return "Space";
  if (normalized === "space") return "Space";
  if (normalized === "tab") return "Tab";
  if (normalized === "escape" || normalized === "esc") return "Esc";
  if (normalized === "backspace") return "Backspace";
  if (normalized === "delete" || normalized === "del") return "Delete";
  return null;
}

type GitHubActionIntent = "primary" | "secondary" | "danger" | "quiet";

function GitHubActionButton({
  children,
  className = "",
  icon: Icon,
  iconClassName = "h-3 w-3",
  iconStrokeWidth,
  intent = "secondary",
  type = "button",
  hoverLabel,
  ...props
}: React.ComponentProps<"button"> & {
  hoverLabel?: string;
  icon?: React.ElementType<{ className?: string }>;
  iconClassName?: string;
  iconStrokeWidth?: number;
  intent?: GitHubActionIntent;
}) {
  const intentClass: Record<GitHubActionIntent, string> = {
    primary: "border-neutral-700 bg-neutral-100 text-neutral-950 hover:bg-white",
    secondary: "border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-700 hover:bg-neutral-800 hover:text-neutral-100",
    quiet: "border-neutral-800 bg-black/30 text-neutral-400 hover:border-neutral-700 hover:bg-neutral-900 hover:text-neutral-200",
    danger: "border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-red-700/40 hover:bg-red-950/30 hover:text-red-300"
  };

  const button = (
    <button
      type={type}
      className={`inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md border px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-1 focus-visible:ring-neutral-600/45 disabled:cursor-not-allowed disabled:opacity-50 ${intentClass[intent]} ${className}`}
      {...props}
    >
      {Icon && <Icon className={iconClassName} strokeWidth={iconStrokeWidth} aria-hidden={true} />}
      {children}
    </button>
  );

  if (!hoverLabel) return button;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent sideOffset={6}>{hoverLabel}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function GitHubMetaItem({ children, label, tone = "default" }: { children: React.ReactNode; label: string; tone?: "default" | "warning" }) {
  return (
    <div className="min-w-0">
      <dt className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-700">{label}</dt>
      <dd className={`min-w-0 break-words font-mono text-xs leading-5 ${tone === "warning" ? "text-amber-300" : "text-neutral-300"}`}>
        {children}
      </dd>
    </div>
  );
}

function GitHubStatusPill({
  children,
  className = "",
  tone
}: {
  children: React.ReactNode;
  className?: string;
  tone: "success" | "warning" | "neutral";
}) {
  const toneClass = {
    success: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300 before:bg-emerald-400",
    warning: "border-amber-500/20 bg-amber-500/10 text-amber-300 before:bg-amber-300",
    neutral: "border-neutral-800 bg-neutral-950 text-neutral-500 before:bg-neutral-600"
  }[tone];

  return (
    <span
      className={`inline-flex h-6 w-fit items-center gap-1.5 rounded-md border px-2 text-xs font-medium before:h-1.5 before:w-1.5 before:rounded-full ${toneClass} ${className}`}
    >
      {children}
    </span>
  );
}

/* ---- Status View ---- */
