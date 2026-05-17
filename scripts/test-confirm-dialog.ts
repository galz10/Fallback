import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfirmDialog } from "../src/renderer/components/ConfirmDialog.js";

const typedHtml = renderToStaticMarkup(
  React.createElement(ConfirmDialog, {
    title: "Clear all local data?",
    objectName: "Fallback local cache",
    body: React.createElement("p", null, "This removes local cache data."),
    confirmLabel: "Clear all local data",
    typedConfirmation: "DELETE",
    typedConfirmationLabel: "Type DELETE to clear all local Fallback cache data.",
    onCancel: () => undefined,
    onConfirm: () => undefined
  })
);

assert.match(typedHtml, /role="dialog"/);
assert.match(typedHtml, /aria-modal="true"/);
assert.match(typedHtml, /Clear all local data\\?/);
assert.match(typedHtml, /Fallback local cache/);
assert.match(typedHtml, /Type DELETE to clear all local Fallback cache data/);
assert.match(typedHtml, /disabled=""/);
assert.match(typedHtml, /Clear all local data/);

const pendingHtml = renderToStaticMarkup(
  React.createElement(ConfirmDialog, {
    title: "Remove GitHub account?",
    body: React.createElement("p", null, "Cached repository data remains local."),
    confirmLabel: "Remove account",
    pendingLabel: "Removing...",
    pending: true,
    error: "Keychain refused the request.",
    onCancel: () => undefined,
    onConfirm: () => undefined
  })
);

assert.match(pendingHtml, /Removing/);
assert.match(pendingHtml, /Keychain refused the request/);
assert.match(pendingHtml, /Cached repository data remains local/);

console.log("Confirm dialog component tests ok");
