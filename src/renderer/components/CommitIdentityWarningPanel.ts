import React from "react";
import type { CommitIdentityPolicyState } from "../../shared/commit-identity-policy.js";

interface CommitIdentityWarningPanelProps {
  state: CommitIdentityPolicyState;
  bypassed: boolean;
  applyPending?: boolean;
  onBypassChange: (bypassed: boolean) => void;
  onApplyIdentity: () => void;
}

export function CommitIdentityWarningPanel({
  state,
  bypassed,
  applyPending = false,
  onBypassChange,
  onApplyIdentity
}: CommitIdentityWarningPanelProps) {
  if (state.status === "ok" || !state.message) return null;

  return React.createElement(
    "div",
    {
      "data-testid": "commit-identity-warning",
      className: `border-l px-2 py-1.5 text-[11px] ${
        state.status === "blocked" ? "border-l-red-400/70 text-red-200" : "border-l-amber-400/50 text-neutral-500"
      }`
    },
    React.createElement(
      "div",
      { className: `font-medium ${state.status === "blocked" ? "text-red-200" : "text-neutral-300"}` },
      state.status === "blocked" ? "Commit blocked" : "Email verification"
    ),
    React.createElement("div", { className: "mt-1 leading-4" }, state.message),
    state.action ? React.createElement("div", { className: "mt-1 leading-4 opacity-75" }, state.action) : null,
    React.createElement(
      "div",
      { className: "mt-2 flex flex-wrap items-center gap-2" },
      state.quickFix === "apply_repo_identity"
        ? React.createElement(
            "button",
            {
              type: "button",
              onClick: onApplyIdentity,
              disabled: applyPending,
              className:
                "h-7 rounded-md border border-neutral-700 px-2 text-[11px] font-medium text-neutral-100 transition-colors hover:bg-neutral-900 disabled:opacity-50"
            },
            applyPending ? "Applying..." : "Apply repo identity"
          )
        : null,
      state.canBypass
        ? React.createElement(
            "label",
            { className: "flex items-center gap-2 text-[11px] text-neutral-300" },
            React.createElement("input", {
              type: "checkbox",
              checked: bypassed,
              onChange: (event) => onBypassChange(event.currentTarget.checked),
              className: "h-3.5 w-3.5 accent-white"
            }),
            "Commit anyway"
          )
        : null
    )
  );
}
