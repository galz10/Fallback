import type { WorkerInitializationRenderOptions, WorkerPoolOptions } from "@pierre/diffs/react";

export const diffsUnsafeCSS = `
  :host {
    --diffs-font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
    --diffs-header-font-family: Inter, Geist, ui-sans-serif, system-ui, sans-serif;
    --diffs-font-size: 13px;
    --diffs-line-height: 21px;
    --diffs-dark-bg: hsl(var(--ds-background-200));
    --diffs-dark: hsl(var(--ds-gray-1000));
    --diffs-bg-buffer-override: hsl(var(--ds-background-200));
    --diffs-bg-context-override: hsl(var(--ds-background-200));
    --diffs-bg-separator-override: hsl(var(--ds-background-100));
    --diffs-bg-hover-override: hsl(var(--ds-gray-200));
    --diffs-fg-number-override: hsl(var(--ds-gray-600));
    --diffs-modified-color-override: hsl(var(--ds-gray-800));
    --diffs-selection-color-override: hsl(var(--ds-gray-900));
    --diffs-bg-selection-override: hsl(var(--ds-gray-300) / 0.42);
    --diffs-bg-selection-number-override: hsl(var(--ds-gray-400) / 0.5);
    --diffs-addition-color-override: hsl(var(--ds-green-900));
    --diffs-deletion-color-override: hsl(var(--ds-red-900));
    --diffs-bg-addition-override: hsl(var(--ds-green-300) / 0.2);
    --diffs-bg-deletion-override: hsl(var(--ds-red-300) / 0.22);
    --diffs-bg-addition-emphasis-override: hsl(var(--ds-green-500) / 0.24);
    --diffs-bg-deletion-emphasis-override: hsl(var(--ds-red-500) / 0.26);
    --diffs-bg-conflict-marker-override: hsl(var(--ds-gray-300) / 0.82);
    --diffs-bg-conflict-marker-number-override: hsl(var(--ds-gray-400) / 0.78);
    --diffs-bg-conflict-current-override: hsl(var(--ds-green-300) / 0.26);
    --diffs-bg-conflict-current-number-override: hsl(var(--ds-green-400) / 0.24);
    --diffs-bg-conflict-incoming-override: hsl(var(--ds-blue-300) / 0.3);
    --diffs-bg-conflict-incoming-number-override: hsl(var(--ds-blue-400) / 0.28);
    --diffs-fg-conflict-marker-override: hsl(var(--ds-gray-900));
    --diffs-gap-block: 0px;
    --diffs-gap-inline: 0px;
    background: hsl(var(--ds-background-200));
    color: hsl(var(--ds-gray-1000));
  }

  [data-diff],
  [data-file] {
    background: hsl(var(--ds-background-200));
  }

  [data-diffs-header="default"] {
    min-height: 46px;
    padding-inline: 14px;
    background: hsl(var(--ds-background-100));
    border-bottom: 1px solid var(--ds-gray-alpha-300);
    color: hsl(var(--ds-gray-1000));
    font-size: 13px;
    font-weight: 500;
  }

  [data-header-content] {
    gap: 8px;
  }

  [data-header-content] [data-title],
  [data-header-content] [data-prev-name] {
    color: hsl(var(--ds-gray-1000));
  }

  [data-diffs-header="default"] [data-metadata] {
    color: hsl(var(--ds-gray-600));
    font-size: 12px;
    font-weight: 500;
  }

  [data-code] {
    padding-block: 6px;
    background: hsl(var(--ds-background-200));
  }

  [data-line],
  [data-column-number],
  [data-gutter-buffer],
  [data-no-newline] {
    border: 0;
  }

  [data-column-number] {
    color: hsl(var(--ds-gray-600));
    background: hsl(var(--ds-background-200));
    padding-left: 14px;
    padding-right: 12px;
    border-right: 1px solid var(--ds-gray-alpha-200);
  }

  [data-line] {
    padding-left: 14px;
    padding-right: 18px;
    min-height: var(--diffs-line-height);
  }

  [data-line-type="context"],
  [data-line-type="context-expanded"] {
    background: hsl(var(--ds-background-200));
  }

  [data-separator-wrapper],
  [data-separator] {
    background: hsl(var(--ds-background-100)) !important;
    color: hsl(var(--ds-gray-600));
    border-block: 1px solid var(--ds-gray-alpha-200);
    border-radius: 0 !important;
    font-family: Inter, Geist, ui-sans-serif, system-ui, sans-serif;
    font-size: 12px;
  }

  [data-expand-button] {
    color: hsl(var(--ds-gray-600));
    background: hsl(var(--ds-background-100));
  }

  [data-expand-button]:hover {
    color: hsl(var(--ds-gray-1000));
    background: hsl(var(--ds-gray-100));
  }

  [data-utility-button] {
    background-color: hsl(var(--ds-gray-1000));
    color: hsl(var(--ds-background-200));
    border: 1px solid var(--ds-gray-alpha-300);
    border-radius: 4px;
    box-shadow: none;
  }

  [data-utility-button]:hover {
    background-color: hsl(var(--ds-gray-900));
  }

  [data-line-type="change-addition"]:is([data-line], [data-column-number], [data-gutter-buffer], [data-no-newline]) {
    background: hsl(var(--ds-green-300) / 0.2);
  }

  [data-line-type="change-deletion"]:is([data-line], [data-column-number], [data-gutter-buffer], [data-no-newline]) {
    background: hsl(var(--ds-red-300) / 0.22);
  }

  [data-line-type="change-addition"][data-column-number],
  [data-line-type="change-addition"][data-gutter-buffer] {
    color: hsl(var(--ds-green-900));
  }

  [data-line-type="change-deletion"][data-column-number],
  [data-line-type="change-deletion"][data-gutter-buffer] {
    color: hsl(var(--ds-red-900));
  }

  [data-merge-conflict-actions] {
    padding: 8px 14px;
    border-block: 1px solid var(--ds-gray-alpha-200);
    background: hsl(var(--ds-background-100));
  }

  [data-merge-conflict-actions] button {
    border: 0;
    background: transparent;
    color: hsl(var(--ds-gray-700));
    font-family: Inter, Geist, ui-sans-serif, system-ui, sans-serif;
    font-size: 12px;
    font-weight: 400;
  }

  [data-merge-conflict-actions] button:hover {
    color: hsl(var(--ds-gray-1000));
  }
`;

export const diffsBaseOptions = {
  theme: "pierre-dark",
  themeType: "dark",
  overflow: "scroll",
  maxLineDiffLength: 1000,
  tokenizeMaxLineLength: 2000,
  lineHoverHighlight: "both",
  unsafeCSS: diffsUnsafeCSS
} as const;

export const diffsFileOptions = {
  ...diffsBaseOptions,
  enableLineSelection: true
} as const;

export const diffsDiffOptions = {
  ...diffsBaseOptions,
  diffStyle: "unified",
  diffIndicators: "bars",
  collapsedContextThreshold: 2,
  expansionLineCount: 80,
  hunkSeparators: "line-info-basic",
  lineDiffType: "word-alt",
  enableLineSelection: true,
  enableGutterUtility: true
} as const;

export const diffsConflictOptions = {
  ...diffsBaseOptions,
  collapsedContextThreshold: 2,
  expansionLineCount: 80,
  hunkSeparators: "line-info-basic",
  lineDiffType: "word-alt",
  enableLineSelection: true,
  enableGutterUtility: true,
  mergeConflictActionsType: "default",
  maxContextLines: 3
} as const;

export const diffsSplitOptions = {
  ...diffsDiffOptions,
  diffStyle: "split"
} as const;

export const workerPoolOptions = {
  totalASTLRUCacheSize: 200
} satisfies Omit<WorkerPoolOptions, "workerFactory">;

export const workerHighlighterOptions = {
  theme: "pierre-dark",
  lineDiffType: "word-alt",
  maxLineDiffLength: 1000,
  tokenizeMaxLineLength: 2000,
  langs: ["typescript", "javascript", "tsx", "jsx", "json", "css", "html", "markdown", "shellscript", "yaml", "python", "go", "rust"]
} satisfies WorkerInitializationRenderOptions;
