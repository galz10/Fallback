import React from "react";
import { ShellIcon } from "../components/ShellIcon";
import fallbackMarkDark from "../assets/fallback-mark-dark.png";
import fallbackMarkLight from "../assets/fallback-mark-light.png";

type FallbackLogoVariant = "light" | "dark";

function FallbackLogo({ variant = "light" }: { variant?: FallbackLogoVariant }) {
  const src = variant === "dark" ? fallbackMarkDark : fallbackMarkLight;

  return (
    <div className="relative flex items-center justify-center w-8 h-8 shrink-0">
      <img src={src} alt="" aria-hidden="true" className="w-8 h-8 object-contain drop-shadow-md" />
    </div>
  );
}

export function WindowLogoControls({ onOpenNewWindow }: { onOpenNewWindow?: () => void }) {
  const controls = [
    { label: "Close", icon: <ShellIcon name="x" className="h-3 w-3" />, action: () => window.fallback.window.close() },
    { label: "Minimize", icon: <ShellIcon name="minus" className="h-3.5 w-3.5" />, action: () => window.fallback.window.minimize() },
    { label: "Expand", icon: <ShellIcon name="maximize" className="h-3 w-3" />, action: () => window.fallback.window.toggleMaximize() },
    ...(onOpenNewWindow
      ? [
          {
            label: "Open this view in a new window",
            icon: <ShellIcon name="plus" className="h-3.5 w-3.5" />,
            action: onOpenNewWindow
          }
        ]
      : [])
  ];
  const expandedWidth = onOpenNewWindow ? "hover:w-[124px] focus-within:w-[124px]" : "hover:w-[92px] focus-within:w-[92px]";

  return (
    <div
      className={`app-no-drag window-logo-controls group/window-chrome relative z-20 h-9 w-9 shrink-0 overflow-visible transition-[width] duration-200 ease-out ${expandedWidth}`}
      aria-label="Window controls"
    >
      <div className="absolute left-0 top-1/2 -translate-y-1/2 transition-[opacity,transform] duration-200 ease-out group-hover/window-chrome:rotate-[-8deg] group-hover/window-chrome:scale-75 group-hover/window-chrome:opacity-0 group-focus-within/window-chrome:rotate-[-8deg] group-focus-within/window-chrome:scale-75 group-focus-within/window-chrome:opacity-0">
        <FallbackLogo />
      </div>
      <div className="absolute left-0 top-1/2 flex -translate-y-1/2 scale-95 items-center gap-2.5 opacity-0 transition-[opacity,transform] duration-200 ease-out group-hover/window-chrome:scale-100 group-hover/window-chrome:opacity-100 group-focus-within/window-chrome:scale-100 group-focus-within/window-chrome:opacity-100">
        {controls.map((control) => (
          <button
            key={control.label}
            type="button"
            onClick={control.action}
            className="grid h-5 w-5 place-items-center rounded-full border border-border bg-secondary text-muted-foreground transition-[background-color,border-color,color] duration-150 hover:border-gray-alpha-600 hover:bg-foreground hover:text-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-500"
            aria-label={control.label}
            title={control.label}
          >
            {control.icon}
          </button>
        ))}
      </div>
    </div>
  );
}
