import { useEffect, useMemo } from "react";
import type { AppView } from "../state/navigation-store";

export function useGlobalShortcuts({
  closePalette,
  openPalette,
  paletteOpen,
  setView
}: {
  closePalette: () => void;
  openPalette: () => void;
  paletteOpen: boolean;
  setView: (view: AppView) => void;
}): string {
  const commandShortcutLabel = useMemo(() => (isMacPlatform() ? "⌘K" : "Ctrl K"), []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (paletteOpen) closePalette();
        else openPalette();
      }
      if (
        e.key === "f" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        openPalette();
      }
      if (
        e.key.toLowerCase() === "h" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        setView("home");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closePalette, openPalette, paletteOpen, setView]);

  return commandShortcutLabel;
}

function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}
