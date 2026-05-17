import React from "react";
import type { IdentityRisk } from "../../shared/identity-risk.js";

interface IdentityRiskWarningProps {
  risk: IdentityRisk;
  className?: string;
}

export function IdentityRiskWarning({ risk, className = "" }: IdentityRiskWarningProps) {
  if (risk.level === "ok" || !risk.message) return null;

  return React.createElement(
    "div",
    {
      "data-testid": "identity-risk-warning",
      className: `rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 ${className}`
    },
    risk.message
  );
}
