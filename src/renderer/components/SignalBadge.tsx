import React from "react";
import { StatusBadge } from "./ui";

export type SignalBadgeTone = "good" | "bad" | "warn" | "neutral";

export function SignalBadge({ children, tone }: { children: React.ReactNode; tone: SignalBadgeTone }) {
  return <StatusBadge tone={tone}>{children}</StatusBadge>;
}
