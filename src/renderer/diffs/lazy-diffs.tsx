import React from "react";

export const DiffsFile = React.lazy(() => import("@pierre/diffs/react").then((mod) => ({ default: mod.File })));
export const PatchDiff = React.lazy(() => import("@pierre/diffs/react").then((mod) => ({ default: mod.PatchDiff })));
export const DiffsFileDiff = React.lazy(() => import("@pierre/diffs/react").then((mod) => ({ default: mod.FileDiff })));
export const UnresolvedFile = React.lazy(() => import("@pierre/diffs/react").then((mod) => ({ default: mod.UnresolvedFile })));
