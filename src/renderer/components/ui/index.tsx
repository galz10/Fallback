import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type PropsWithChildren,
  type ReactNode
} from "react";
import { SearchIcon } from "@primer/octicons-react";
import { Badge } from "@/renderer/components/ui/badge";
import { Button as ShadcnButton } from "@/renderer/components/ui/button";
import { Input as ShadcnInput } from "@/renderer/components/ui/input";
import { Kbd } from "@/renderer/components/ui/kbd";
import { ToggleGroup, ToggleGroupItem } from "@/renderer/components/ui/toggle-group";
import { cn } from "@/renderer/lib/utils";

type Tone = "neutral" | "good" | "bad" | "warn" | "accent";
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "xs" | "sm" | "md";
type SurfaceTone = "base" | "subtle" | "elevated";
type Density = "compact" | "normal";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ className = "", variant = "secondary", size = "sm", type = "button", ...props }: ButtonProps) {
  const shadcnVariant = variant === "primary" ? "default" : variant === "danger" ? "destructive" : variant;
  const shadcnSize = size === "md" ? "default" : size;
  return (
    <ShadcnButton
      type={type}
      variant={shadcnVariant}
      size={shadcnSize}
      className={cn("ui-button", `ui-button-${variant}`, `ui-button-${size}`, className)}
      {...props}
    />
  );
}

export interface IconButtonProps extends Omit<ButtonProps, "children"> {
  label: string;
  icon: ReactNode;
}

export function IconButton({ label, icon, className = "", title, ...props }: IconButtonProps) {
  return (
    <Button aria-label={label} title={title ?? label} size="xs" className={cn("ui-icon-button", className)} {...props}>
      {icon}
    </Button>
  );
}

export interface SearchFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  shortcut?: string;
  density?: Density;
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { className = "", shortcut, density = "normal", type = "text", spellCheck = false, ...props },
  ref
) {
  return (
    <div className={cn("ui-search-field", density === "compact" && "ui-search-field-compact", className)}>
      <SearchIcon className="ui-search-field-icon" />
      <ShadcnInput ref={ref} type={type} spellCheck={spellCheck} className="ui-search-field-input" {...props} />
      {shortcut && <Kbd className="ui-search-field-shortcut">{shortcut}</Kbd>}
    </div>
  );
});

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  className = ""
}: {
  value: T;
  options: Array<SegmentedControlOption<T>>;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as T);
      }}
      className={cn("ui-segmented-control", className)}
      aria-label={label}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={cn("ui-segmented-control-item", value === option.value && "ui-segmented-control-item-active")}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function StatusBadge({ tone = "neutral", className = "", children }: PropsWithChildren<{ tone?: Tone; className?: string }>) {
  const variant = tone === "bad" ? "destructive" : tone === "neutral" ? "secondary" : "outline";
  return (
    <Badge variant={variant} className={cn("ui-status-badge", `ui-status-badge-${tone}`, className)}>
      {children}
    </Badge>
  );
}

export function DataRow({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("ui-data-row", className)} {...props}>
      {children}
    </div>
  );
}

export function Surface({
  tone = "base",
  className = "",
  children,
  ...props
}: PropsWithChildren<HTMLAttributes<HTMLDivElement> & { tone?: SurfaceTone }>) {
  return (
    <div className={cn("ui-surface", `ui-surface-${tone}`, className)} {...props}>
      {children}
    </div>
  );
}

export function Toolbar({ className = "", children, ...props }: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return (
    <div className={cn("ui-toolbar", className)} {...props}>
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  detail,
  action,
  className = ""
}: {
  title: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("ui-empty-state", className)}>
      <div className="ui-empty-state-title">{title}</div>
      {detail && <div className="ui-empty-state-detail">{detail}</div>}
      {action && <div className="ui-empty-state-action">{action}</div>}
    </div>
  );
}

export function CacheStamp({
  state,
  timestamp,
  title,
  className = ""
}: {
  state: "live" | "cached" | "offline-cached";
  timestamp?: string | null;
  title?: string;
  className?: string;
}) {
  const label = state === "offline-cached" ? "Offline cached" : state === "cached" ? "Cached" : "Live";
  return (
    <span className={cn("ui-cache-stamp", className)} title={title}>
      {label}
      {timestamp ? ` ${timestamp}` : ""}
    </span>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className = "", ...props }, ref) {
  return <ShadcnInput className={cn("ui-input", className)} ref={ref} {...props} />;
});

export function Panel({ children, className = "" }: PropsWithChildren<{ className?: string }>) {
  return <Surface className={className}>{children}</Surface>;
}
