import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LocalChangesFilterBar } from "../src/renderer/components/LocalChangesFilterBar.js";

const flatHtml = renderToStaticMarkup(
  React.createElement(LocalChangesFilterBar, {
    displayMode: "flat",
    onDisplayModeChange: () => undefined,
    query: "src",
    onQueryChange: () => undefined,
    status: "modified",
    onStatusChange: () => undefined,
    stage: "unstaged",
    onStageChange: () => undefined,
    resultCount: 2,
    totalCount: 8
  })
);
assert.match(flatHtml, /Filter changed files/);
assert.match(flatHtml, /Flat/);
assert.match(flatHtml, /Tree/);
assert.match(flatHtml, /modified/);
assert.match(flatHtml, /unstaged/);
assert.match(flatHtml, /2\/8/);

const treeHtml = renderToStaticMarkup(
  React.createElement(LocalChangesFilterBar, {
    displayMode: "tree",
    onDisplayModeChange: () => undefined,
    query: "",
    onQueryChange: () => undefined,
    status: "all",
    onStatusChange: () => undefined,
    stage: "all",
    onStageChange: () => undefined,
    resultCount: 0,
    totalCount: 0
  })
);
assert.match(treeHtml, /bg-neutral-900 text-neutral-200/);
assert.match(treeHtml, /0\/0/);

console.log("Local changes filter bar tests ok");
