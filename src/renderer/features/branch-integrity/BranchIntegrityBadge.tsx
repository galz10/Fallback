import React from "react";
import { ShieldAlert, ShieldCheck, ShieldQuestion, ShieldX } from "lucide-react";
import type { BranchIntegrityStatusSummary } from "../../../shared/domain/branch-integrity";
import { StatusBadge } from "../../components/ui";

export function BranchIntegrityBadge({
  summary,
  compact = false,
  auditing = false
}: {
  summary?: BranchIntegrityStatusSummary | null;
  compact?: boolean;
  auditing?: boolean;
}) {
  if (auditing) {
    return (
      <span title="Branch Watch audit is running.">
        <StatusBadge tone="accent" className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <ShieldQuestion className="h-3.5 w-3.5" />
          {compact ? "Audit" : "Auditing"}
        </StatusBadge>
      </span>
    );
  }
  const state = summary?.status ?? "monitoring";
  const config = statusConfig(state);
  const Icon = config.icon;
  return (
    <span title={summary?.message ?? config.label}>
      <StatusBadge tone={config.tone} className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <Icon className="h-3.5 w-3.5" />
        {compact ? config.shortLabel : config.label}
      </StatusBadge>
    </span>
  );
}

function statusConfig(status: BranchIntegrityStatusSummary["status"]): {
  label: string;
  shortLabel: string;
  tone: "neutral" | "good" | "bad" | "warn" | "accent";
  icon: typeof ShieldCheck;
} {
  if (status === "incident") return { label: "Branch Incident", shortLabel: "Incident", tone: "bad", icon: ShieldX };
  if (status === "at_risk") return { label: "At Risk", shortLabel: "Risk", tone: "bad", icon: ShieldAlert };
  if (status === "warning") return { label: "Warning", shortLabel: "Warn", tone: "warn", icon: ShieldAlert };
  if (status === "needs_audit") return { label: "Needs Audit", shortLabel: "Audit", tone: "warn", icon: ShieldAlert };
  if (status === "unavailable") return { label: "Unavailable", shortLabel: "N/A", tone: "neutral", icon: ShieldQuestion };
  if (status === "monitoring") return { label: "Monitoring", shortLabel: "Monitor", tone: "accent", icon: ShieldQuestion };
  return { label: "Clean", shortLabel: "Clean", tone: "good", icon: ShieldCheck };
}
