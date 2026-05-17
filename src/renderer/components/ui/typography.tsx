import * as React from "react";

import { cn } from "@/renderer/lib/utils";

export function TypographyH1({ className, ...props }: React.ComponentProps<"h1">) {
  return <h1 className={cn("scroll-m-20 text-3xl font-semibold tracking-tight text-foreground", className)} {...props} />;
}

export function TypographyH2({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 className={cn("scroll-m-20 text-lg font-semibold tracking-tight text-foreground", className)} {...props} />;
}

export function TypographyP({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-sm leading-6 text-muted-foreground", className)} {...props} />;
}

export function TypographyMuted({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-xs text-muted-foreground", className)} {...props} />;
}
