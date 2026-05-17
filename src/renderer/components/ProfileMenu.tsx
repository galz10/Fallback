import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MarkGithubIcon } from "@primer/octicons-react";
import type { AuthState, GitHubAccountSession } from "../../shared/domain/auth";
import { hasAuthAccountDetails, isAuthRecoveryState } from "../../shared/auth-recovery";
import { endpointLabel } from "../lib/format";
import { renderableAvatarUrl } from "../lib/avatar-url";
import { IconButton } from "./ui";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { GitHubAvatar } from "./ProviderAvatar";
import { ConfirmDialog } from "./ConfirmDialog";
import { ShellIcon } from "./ShellIcon";
import { useEffect, useState } from "react";

export function ProfileMenu({ auth, onOpenSettings }: { auth: AuthState; onOpenSettings: () => void }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [optimisticAccountId, setOptimisticAccountId] = useState<string | null>(null);
  const [accountRemovalTarget, setAccountRemovalTarget] = useState<GitHubAccountSession | null>(null);
  const { data: accounts = [] } = useQuery({
    queryKey: ["profiles"],
    queryFn: window.fallback.auth.listProfiles,
    enabled: open && hasAuthAccountDetails(auth),
    staleTime: 60_000,
    refetchOnWindowFocus: false
  });
  const refreshAuthAccountQueries = async () => {
    const [nextAuth, nextProfiles, nextRepos] = await Promise.all([
      window.fallback.auth.getAuthState(),
      window.fallback.auth.listProfiles(),
      window.fallback.repos.listWatched()
    ]);
    queryClient.setQueryData(["auth"], nextAuth);
    queryClient.setQueryData(["accounts"], nextProfiles);
    queryClient.setQueryData(["profiles"], nextProfiles);
    queryClient.setQueryData(["repos"], nextRepos);
    queryClient.removeQueries({ queryKey: ["availableRepos"] });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["auth"] }),
      queryClient.invalidateQueries({ queryKey: ["accounts"] }),
      queryClient.invalidateQueries({ queryKey: ["profiles"] }),
      queryClient.invalidateQueries({ queryKey: ["myWorkAttention"] }),
      queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      queryClient.invalidateQueries({ queryKey: ["notificationsSummary"] }),
      queryClient.invalidateQueries({ queryKey: ["myPrs"] }),
      queryClient.invalidateQueries({ queryKey: ["myIssues"] })
    ]);
  };
  const menuAccounts = (accounts.length > 0 ? accounts : [authStateToAccount(auth)]).filter((account): account is GitHubAccountSession =>
    Boolean(account)
  );
  const selectAccount = useMutation({
    mutationFn: window.fallback.auth.selectProfile,
    onMutate: async (accountId) => {
      setOptimisticAccountId(accountId);
      setOpen(false);
      await queryClient.cancelQueries({ queryKey: ["auth"] });
      await queryClient.cancelQueries({ queryKey: ["profiles"] });
      const account = menuAccounts.find((candidate) => candidate.id === accountId);
      if (account) queryClient.setQueryData(["auth"], accountToAuthState(account, auth));
    },
    onSuccess: refreshAuthAccountQueries,
    onError: () => setOptimisticAccountId(null)
  });
  const deleteAccount = useMutation({
    mutationFn: window.fallback.auth.removeProfile,
    onSuccess: async () => {
      setAccountRemovalTarget(null);
      setOpen(false);
      await refreshAuthAccountQueries();
    }
  });
  useEffect(() => {
    if (optimisticAccountId && hasAuthAccountDetails(auth) && auth.accountId === optimisticAccountId) setOptimisticAccountId(null);
  }, [auth, optimisticAccountId]);
  const authAccountId = hasAuthAccountDetails(auth) ? auth.accountId : undefined;
  const activeAccountId = optimisticAccountId ?? authAccountId;
  const optimisticAccount = activeAccountId ? menuAccounts.find((account) => account.id === activeAccountId) : null;
  const displayAuth = optimisticAccount && optimisticAccount.id !== authAccountId ? accountToAuthState(optimisticAccount, auth) : auth;

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuContent side="top" align="start" className="mb-2 w-[280px] overflow-hidden p-1">
          {auth.status === "connected" && (
            <div className="border-b border-border pb-1">
              {menuAccounts.map((account) => (
                <div key={account.id} className="group/account flex items-center gap-1 rounded-md hover:bg-accent">
                  <button
                    type="button"
                    onClick={() => {
                      if (account.id !== activeAccountId) selectAccount.mutate(account.id);
                    }}
                    disabled={selectAccount.isPending || account.id === activeAccountId}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left disabled:cursor-default"
                  >
                    <GitHubAvatar
                      size={20}
                      username={account.login}
                      src={renderableAvatarUrl(account.avatarCachedUrl, account.avatarUrl)}
                      title={account.login ?? "GitHub"}
                      showProviderBadge={false}
                    />
                    <span
                      className="h-2 w-2 shrink-0 rounded-full ring-1 ring-border"
                      style={{ backgroundColor: profileColorValue(account.profileColor) }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-foreground">
                        {account.profileName ?? account.login ?? "GitHub"}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">{endpointLabel(account.endpoint)}</span>
                    </span>
                    {account.id === activeAccountId && <ShellIcon name="check" className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  </button>
                  <IconButton
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setAccountRemovalTarget(account);
                    }}
                    disabled={deleteAccount.isPending}
                    variant="ghost"
                    className="mr-1 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:bg-red-200/35 hover:text-red-900 group-hover/account:opacity-100 group-focus-within/account:opacity-100 disabled:opacity-50"
                    label={`Remove ${account.login ?? "GitHub account"}`}
                    icon={<ShellIcon name="trash" className="h-3.5 w-3.5" />}
                  />
                </div>
              ))}
            </div>
          )}
          <DropdownMenuItem
            onSelect={() => {
              onOpenSettings();
              setOpen(false);
            }}
          >
            <ShellIcon name="plus" className="h-[16px] w-[16px] text-muted-foreground" />
            <span>Add GitHub profile</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              onOpenSettings();
              setOpen(false);
            }}
          >
            <ShellIcon name="gear" className="h-[16px] w-[16px] text-muted-foreground" />
            <span>Settings</span>
          </DropdownMenuItem>
          {isAuthRecoveryState(auth) && (
            <DropdownMenuItem
              onSelect={() => {
                onOpenSettings();
                setOpen(false);
              }}
              className="text-amber-900 focus:text-amber-900"
            >
              <ShellIcon name="rotate" className="h-[16px] w-[16px] text-amber-900" />
              <span>Reconnect GitHub</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
        <div className="relative flex w-full items-center gap-3 px-2 py-2 text-left">
          <ProfileAvatarGroup
            auth={displayAuth}
            accounts={menuAccounts}
            selecting={selectAccount.isPending}
            onSelectAccount={(accountId) => selectAccount.mutate(accountId)}
          />
          <ProfileCopy auth={displayAuth} />
        </div>
      </DropdownMenu>
      {accountRemovalTarget && (
        <ConfirmDialog
          title="Remove GitHub account?"
          objectName={`${accountRemovalTarget.login ?? "GitHub account"} - ${endpointLabel(accountRemovalTarget.endpoint)}`}
          body={
            <div className="space-y-2">
              <p>
                Fallback will remove this saved GitHub account and its token from local auth storage. Sync and write actions that use this
                account will stop until you reconnect or select another account.
              </p>
              <p>Cached repository data and local clones remain on this computer.</p>
            </div>
          }
          confirmLabel="Remove account"
          pendingLabel="Removing..."
          pending={deleteAccount.isPending}
          error={deleteAccount.error ? errorMessage(deleteAccount.error) : null}
          onCancel={() => {
            if (!deleteAccount.isPending) setAccountRemovalTarget(null);
          }}
          onConfirm={() => deleteAccount.mutate(accountRemovalTarget.id)}
        />
      )}
    </>
  );
}

function ProfileAvatarGroup({
  auth,
  accounts,
  selecting,
  onSelectAccount
}: {
  auth: AuthState;
  accounts: GitHubAccountSession[];
  selecting: boolean;
  onSelectAccount: (accountId: string) => void;
}) {
  const activeAccount = authStateToAccount(auth);
  const secondaryAccounts = accounts.filter((account) => account.id !== activeAccount?.id);
  const visibleSecondaryAccounts = secondaryAccounts.slice(0, 2);
  const groupWidthClass = visibleSecondaryAccounts.length === 0 ? "w-10" : visibleSecondaryAccounts.length > 1 ? "w-20" : "w-16";

  if (!activeAccount) {
    return (
      <span className="relative block h-10 w-16">
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-lg"
            className="account-avatar-trigger group/account-avatar absolute right-0 top-0 z-10 h-10 w-10 rounded-full border border-transparent bg-transparent p-0 shadow-none hover:border-transparent hover:bg-transparent focus-visible:border-transparent focus-visible:ring-0"
            aria-label="Open account menu"
          >
            <Avatar
              size="lg"
              className="account-active-avatar bg-background-100 ring-2 ring-background transition-[box-shadow,filter,transform] group-hover/account-avatar:ring-amber-700/70 group-hover/account-avatar:brightness-110"
            >
              <AvatarFallback>{hasAuthAccountDetails(auth) ? initials(auth.login ?? "GH") : "GH"}</AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <GitHubProfileBadge />
      </span>
    );
  }

  return (
    <span className={`relative block h-10 ${groupWidthClass}`}>
      {visibleSecondaryAccounts.map((account, index) => (
        <button
          key={account.id}
          type="button"
          title={`Switch to ${account.profileName ?? account.login ?? "GitHub profile"}`}
          aria-label={`Switch to ${account.profileName ?? account.login ?? "GitHub profile"}`}
          disabled={selecting}
          onClick={(event) => {
            event.stopPropagation();
            onSelectAccount(account.id);
          }}
          className="absolute top-1.5 h-7 w-7 rounded-full border border-transparent bg-transparent p-0 transition-[filter,opacity,transform] hover:opacity-80 hover:brightness-95 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
          style={{ left: index * 18, zIndex: index }}
        >
          <Avatar size="default" className="size-7 bg-background-100 opacity-65 grayscale brightness-75 contrast-90 ring-2 ring-background">
            <AvatarImage
              src={renderableAvatarUrl(account.avatarCachedUrl, account.avatarUrl)}
              alt={account.login ? `@${account.login}` : "GitHub"}
            />
            <AvatarFallback>{initials(account.profileName ?? account.login ?? "GH")}</AvatarFallback>
          </Avatar>
        </button>
      ))}
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-lg"
          className="account-avatar-trigger group/account-avatar absolute right-0 top-0 z-10 h-10 w-10 rounded-full border border-transparent bg-transparent p-0 shadow-none hover:border-transparent hover:bg-transparent focus-visible:border-transparent focus-visible:ring-0"
          aria-label={`Open account menu with ${accounts.length || 1} ${accounts.length === 1 ? "profile" : "profiles"}`}
        >
          <Avatar
            key={`active:${activeAccount.id}`}
            size="lg"
            title={activeAccount.profileName ?? activeAccount.login ?? "GitHub profile"}
            className="active-profile-avatar-forward account-active-avatar bg-background-100 ring-2 ring-background transition-[box-shadow,filter,transform] group-hover/account-avatar:ring-amber-700/70 group-hover/account-avatar:brightness-110"
          >
            <AvatarImage
              src={renderableAvatarUrl(activeAccount.avatarCachedUrl, activeAccount.avatarUrl)}
              alt={activeAccount.login ? `@${activeAccount.login}` : "GitHub"}
            />
            <AvatarFallback>{initials(activeAccount.profileName ?? activeAccount.login ?? "GH")}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      {accounts.length > 1 && (
        <span
          className="pointer-events-none absolute right-[1px] top-[1px] z-20 h-2.5 w-2.5 rounded-full border border-background bg-muted"
          style={{ backgroundColor: profileColorValue(activeAccount.profileColor) }}
        />
      )}
      <GitHubProfileBadge />
    </span>
  );
}

function GitHubProfileBadge() {
  return (
    <span className="absolute -right-1 bottom-0 z-20 grid h-[18px] w-[18px] place-items-center rounded-full border border-neutral-800 bg-black text-white shadow-[0_0_0_2px_rgba(0,0,0,0.9)] [&>svg]:h-3.5 [&>svg]:w-3.5">
      <MarkGithubIcon aria-hidden="true" />
    </span>
  );
}

export function ProfileMenuFallback({ auth }: { auth: AuthState }) {
  return (
    <div className="flex w-full items-center gap-3 px-2 py-2 text-left">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-background-100 text-[12px] font-semibold text-muted-foreground shadow-border-small">
        {hasAuthAccountDetails(auth) ? initials(auth.login ?? "GH") : "GH"}
      </div>
      <ProfileCopy auth={auth} />
    </div>
  );
}

function ProfileCopy({ auth }: { auth: AuthState }) {
  return (
    <div className="sidebar-profile-copy flex min-w-0 flex-1 flex-col">
      <span className="truncate text-[13px] font-medium text-foreground">
        {hasAuthAccountDetails(auth) ? (auth.profileName ?? auth.login ?? "GitHub") : "Disconnected"}
      </span>
      {auth.status !== "connected" && (
        <span className={`truncate text-[11px] ${isAuthRecoveryState(auth) ? "text-amber-900" : "text-muted-foreground"}`}>
          {isAuthRecoveryState(auth) ? auth.status.replaceAll("_", " ") : "Connect GitHub"}
        </span>
      )}
      {hasAuthAccountDetails(auth) && endpointLabel(auth.endpoint) !== "GitHub.com" && (
        <span className="max-w-[150px] truncate text-[11px] text-muted-foreground">{endpointLabel(auth.endpoint)}</span>
      )}
    </div>
  );
}

function authStateToAccount(auth: AuthState): GitHubAccountSession | null {
  if (!hasAuthAccountDetails(auth) || !auth.accountId) return null;
  const now = new Date().toISOString();
  return {
    id: auth.accountId,
    githubUserId: null,
    login: auth.login ?? null,
    endpoint: auth.endpoint ?? "https://api.github.com",
    htmlUrl: auth.htmlUrl ?? null,
    avatarUrl: auth.avatarUrl ?? null,
    avatarCachedUrl: auth.avatarCachedUrl ?? null,
    name: auth.name ?? null,
    profileName: auth.profileName ?? auth.login ?? null,
    profileColor: auth.profileColor ?? null,
    accountType: auth.accountType ?? null,
    tokenSource: auth.status === "connected" ? auth.source : null,
    tokenScopes: auth.tokenScopes ?? [],
    authStatus: auth.status,
    lastValidatedAt: auth.lastValidatedAt ?? null,
    lastSelectedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

function accountToAuthState(account: GitHubAccountSession, fallback: AuthState): AuthState {
  return {
    status: "connected",
    source: account.tokenSource ?? (fallback.status === "connected" ? fallback.source : "keychain"),
    accountId: account.id,
    endpoint: account.endpoint,
    htmlUrl: account.htmlUrl,
    login: account.login ?? undefined,
    avatarUrl: account.avatarUrl,
    avatarCachedUrl: account.avatarCachedUrl,
    name: account.name,
    profileName: account.profileName,
    profileColor: account.profileColor,
    accountType: account.accountType,
    tokenScopes: account.tokenScopes,
    lastValidatedAt: account.lastValidatedAt
  };
}

function initials(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function profileColorValue(color: string | null | undefined): string {
  switch (color) {
    case "blue":
      return "#3b82f6";
    case "green":
      return "#22c55e";
    case "amber":
      return "#f59e0b";
    case "rose":
      return "#f43f5e";
    case "violet":
      return "#8b5cf6";
    default:
      return "#737373";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
