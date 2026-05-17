import React from "react";
import type { AuthState } from "../../shared/domain/auth.js";
import { authRecoveryCopy } from "../../shared/auth-recovery.js";

interface AuthRecoveryBannerProps {
  auth: AuthState;
  repoAuthError?: string | null;
  actionLabel?: string;
  onAction?: () => void;
}

export function AuthRecoveryBanner({ auth, repoAuthError, actionLabel, onAction }: AuthRecoveryBannerProps) {
  const authRecovery = authRecoveryCopy(auth);
  const recovery = authRecovery
    ? { ...authRecovery, state: auth.status }
    : repoAuthError
      ? {
          title: "GitHub sync needs attention",
          body: repoAuthError,
          action: "Reconnect",
          state: "repo_auth_error"
        }
      : null;

  if (!recovery) return null;

  return React.createElement(
    "div",
    {
      "data-testid": "auth-recovery-banner",
      "data-auth-state": recovery.state,
      className:
        "mx-6 mb-2 flex items-center justify-between gap-3 rounded-lg border border-amber-700/30 bg-amber-200/35 p-3 text-sm text-amber-900"
    },
    React.createElement(
      "div",
      { className: "min-w-0" },
      React.createElement("div", { className: "font-medium" }, recovery.title),
      React.createElement("div", { className: "mt-0.5 truncate text-amber-900/70" }, recovery.body)
    ),
    React.createElement(
      "button",
      {
        type: "button",
        onClick: onAction,
        className:
          "h-8 shrink-0 rounded-md border border-amber-700/30 bg-amber-300/35 px-3 text-[13px] font-medium text-amber-900 transition-colors hover:bg-amber-300/55"
      },
      actionLabel ?? recovery.action
    )
  );
}
