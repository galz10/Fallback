import React from "react";
import { ChevronRight, Clock, Loader2 } from "lucide-react";
import { CommandGroup, CommandItem, CommandList } from "../../components/ui/command";
import { Kbd } from "../../components/ui/kbd";
import { formatRelative } from "../../lib/format";
import type { CommandPaletteGroup, CommandPaletteItem } from "./CommandPalette.types";

export function CommandPaletteResults({
  groups,
  emptyMessage,
  runningValue,
  onRun
}: {
  groups: CommandPaletteGroup[];
  emptyMessage: string;
  runningValue: string | null;
  onRun: (item: CommandPaletteItem) => void;
}) {
  return (
    <CommandList className="palette-results max-h-[392px] px-3 py-3">
      {groups.length === 0 && <div className="px-3 py-10 text-center text-[13px] text-muted-foreground">{emptyMessage}</div>}
      {groups.map((group) => (
        <CommandGroup key={group.value} heading={group.label} className="palette-group">
          {group.items.map((item) => (
            <PaletteResultRow key={item.value} item={item} running={runningValue === item.value} onRun={() => onRun(item)} />
          ))}
        </CommandGroup>
      ))}
    </CommandList>
  );
}

function PaletteResultRow({ item, running, onRun }: { item: CommandPaletteItem; running: boolean; onRun: () => void }) {
  const disabledReason = typeof item.disabled === "string" ? item.disabled : null;
  const disabled = Boolean(item.disabled || running);

  return (
    <CommandItem
      value={item.value}
      disabled={disabled}
      onSelect={onRun}
      title={disabledReason ?? item.description ?? item.title}
      className="palette-row min-h-9 cursor-pointer gap-2.5 rounded-[7px] px-2 py-1.5 data-[disabled=true]:pointer-events-auto data-[disabled=true]:cursor-not-allowed"
    >
      <span className="palette-row-icon flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
        {item.leadingContent}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium leading-5 text-foreground">{item.title}</span>
          {disabledReason && <span className="hidden shrink-0 truncate text-[11px] text-muted-foreground sm:inline">{disabledReason}</span>}
        </span>
        {item.description && <span className="block truncate text-[11px] leading-4 text-muted-foreground">{item.description}</span>}
      </span>
      <span className="ml-2 flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
        {running && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {item.trailingContent}
        {item.timestamp && (
          <span className="hidden items-center gap-1 tabular-nums md:inline-flex">
            <Clock className="h-3 w-3" />
            {formatRelative(item.timestamp)}
          </span>
        )}
        {item.shortcut && item.shortcut.length > 0 && (
          <span className="hidden items-center gap-1 md:flex">
            {item.shortcut.map((key) => (
              <KeyCap key={key}>{key}</KeyCap>
            ))}
          </span>
        )}
        {item.kind === "submenu" && <ChevronRight className="h-4 w-4" />}
      </span>
    </CommandItem>
  );
}

export function KeyCap({ children }: { children: React.ReactNode }) {
  return (
    <Kbd className="inline-flex min-w-5 items-center justify-center rounded-[5px] border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] leading-3 text-muted-foreground">
      {children}
    </Kbd>
  );
}
