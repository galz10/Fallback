import type { SVGProps } from "react";

type ShellIconName =
  | "airplane"
  | "check"
  | "chevron-right"
  | "code"
  | "copy"
  | "edit"
  | "eye"
  | "external"
  | "fork"
  | "gear"
  | "issue"
  | "maximize"
  | "minus"
  | "plus"
  | "pr"
  | "pulse"
  | "queue"
  | "repo"
  | "rotate"
  | "search"
  | "shield-alert"
  | "star"
  | "trash"
  | "window-plus"
  | "workflow"
  | "x";

const paths: Record<ShellIconName, string[]> = {
  airplane: [
    "M17.8 19.2 16 11l3.5-3.5c1.7-1.7 2.3-4.1 1.3-5.1-1-1-3.4-.4-5.1 1.3L12 7.2 4.8 5.4 3.4 6.8l5.7 3.5-3.5 3.5-2.3-.5-.8.8 2.7 2.7 2.7 2.7.8-.8-.5-2.3 3.5-3.5 3.5 5.7 1.6-1.1Z"
  ],
  check: ["M4 12.5 9 17l11-12"],
  "chevron-right": ["M9 5l7 7-7 7"],
  code: ["M8 7l-5 5 5 5", "M16 7l5 5-5 5"],
  copy: ["M8 8h10v12H8z", "M6 16H4V4h12v2"],
  edit: ["M4 20h4l10.5-10.5a2.8 2.8 0 0 0-4-4L4 16v4Z", "M13.5 6.5l4 4"],
  eye: ["M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z", "M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z"],
  external: ["M14 4h6v6", "M10 14 20 4", "M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"],
  fork: [
    "M7 5a2 2 0 1 1-2-2 2 2 0 0 1 2 2Zm12 0a2 2 0 1 1-2-2 2 2 0 0 1 2 2ZM7 19a2 2 0 1 1-2-2 2 2 0 0 1 2 2Z",
    "M7 7v4a4 4 0 0 0 4 4h2a4 4 0 0 0 4-4V7",
    "M7 15v2"
  ],
  gear: [
    "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z",
    "M4 12h2m12 0h2M12 4v2m0 12v2M6.3 6.3l1.4 1.4m8.6 8.6 1.4 1.4m0-11.4-1.4 1.4m-8.6 8.6-1.4 1.4"
  ],
  issue: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "M12 8v5", "M12 17h.01"],
  maximize: ["M8 3H3v5", "M16 3h5v5", "M21 16v5h-5", "M3 16v5h5"],
  minus: ["M5 12h14"],
  plus: ["M12 5v14", "M5 12h14"],
  pr: [
    "M6 6a2 2 0 1 0-2-2 2 2 0 0 0 2 2Zm0 14a2 2 0 1 0-2-2 2 2 0 0 0 2 2Zm12-7a2 2 0 1 0-2-2 2 2 0 0 0 2 2Z",
    "M6 8v8",
    "M8 4h3a7 7 0 0 1 7 7"
  ],
  pulse: ["M3 12h4l2-6 4 12 2-6h6"],
  queue: ["M4 6h12", "M4 12h10", "M4 18h8", "M17 14l4 4-4 4", "M21 18h-8"],
  repo: ["M5 4h11a3 3 0 0 1 3 3v13H7a2 2 0 0 1-2-2V4Z", "M7 4v14", "M9 8h6"],
  rotate: ["M21 12a9 9 0 1 1-2.64-6.36", "M21 4v6h-6"],
  search: ["M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z", "m21 21-4.35-4.35"],
  "shield-alert": ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z", "M12 8v5", "M12 17h.01"],
  star: ["m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.8 6.4 21l1.1-6.2L3 10.4l6.2-.9L12 3Z"],
  trash: ["M4 7h16", "M10 11v6", "M14 11v6", "M6 7l1 14h10l1-14", "M9 7V4h6v3"],
  "window-plus": [
    "M4 6h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z",
    "M2 10h17",
    "M13 15h5",
    "M15.5 12.5v5",
    "M8 4h12a2 2 0 0 1 2 2v9"
  ],
  workflow: [
    "M6 6a2 2 0 1 0-2-2 2 2 0 0 0 2 2Zm12 0a2 2 0 1 0-2-2 2 2 0 0 0 2 2ZM6 20a2 2 0 1 0-2-2 2 2 0 0 0 2 2Zm12 0a2 2 0 1 0-2-2 2 2 0 0 0 2 2Z",
    "M8 4h8",
    "M6 8v8",
    "M18 8v8"
  ],
  x: ["M6 6l12 12", "M18 6 6 18"]
};

export function ShellIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: ShellIconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
