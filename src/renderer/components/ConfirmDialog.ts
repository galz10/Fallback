import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

export interface ConfirmDialogProps {
  title: string;
  body: React.ReactNode;
  objectName?: string;
  confirmLabel: string;
  pendingLabel?: string;
  cancelLabel?: string;
  typedConfirmation?: string;
  typedConfirmationLabel?: string;
  typedConfirmationPlaceholder?: string;
  pending?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  title,
  body,
  objectName,
  confirmLabel,
  pendingLabel,
  cancelLabel = "Cancel",
  typedConfirmation,
  typedConfirmationLabel,
  typedConfirmationPlaceholder,
  pending = false,
  error,
  onCancel,
  onConfirm
}: ConfirmDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [typedValue, setTypedValue] = useState("");
  const requiredText = typedConfirmation?.trim();
  const typedMatches = !requiredText || typedValue.trim() === requiredText;
  const actionDisabled = pending || !typedMatches;
  const confirmationHint = useMemo(() => {
    if (!requiredText) return null;
    return typedConfirmationLabel ?? `Type ${requiredText} to confirm.`;
  }, [requiredText, typedConfirmationLabel]);

  useEffect(() => {
    setTypedValue("");
  }, [title, objectName, requiredText]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, [title, objectName]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, pending]);

  return React.createElement(
    "div",
    { className: "fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm" },
    React.createElement(
      "div",
      {
        ref: dialogRef,
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": titleId,
        "aria-describedby": bodyId,
        tabIndex: -1,
        className: "w-full max-w-md overflow-hidden rounded-lg border border-neutral-800 bg-[#0A0A0A] shadow-2xl"
      },
      React.createElement(
        "div",
        { className: "flex items-start justify-between gap-4 border-b border-neutral-900 px-4 py-3" },
        React.createElement(
          "div",
          { className: "min-w-0" },
          React.createElement("div", { id: titleId, className: "text-sm font-semibold text-white" }, title),
          objectName && React.createElement("div", { className: "mt-1 truncate font-mono text-xs text-neutral-500" }, objectName)
        ),
        React.createElement(
          "button",
          {
            type: "button",
            onClick: onCancel,
            disabled: pending,
            className:
              "grid h-7 w-7 shrink-0 place-items-center rounded-md text-neutral-500 transition-colors hover:bg-[#111111] hover:text-neutral-200 disabled:cursor-wait disabled:opacity-50",
            "aria-label": `Close ${title}`
          },
          React.createElement(X, { className: "h-4 w-4" })
        )
      ),
      React.createElement(
        "div",
        { id: bodyId, className: "space-y-3 px-4 py-4 text-sm leading-5 text-neutral-400" },
        body,
        confirmationHint &&
          React.createElement(
            "label",
            { className: "block space-y-2" },
            React.createElement("span", { className: "text-xs font-medium text-neutral-500" }, confirmationHint),
            React.createElement("input", {
              value: typedValue,
              onChange: (event: React.ChangeEvent<HTMLInputElement>) => setTypedValue(event.currentTarget.value),
              disabled: pending,
              autoFocus: true,
              spellCheck: false,
              placeholder: typedConfirmationPlaceholder ?? requiredText,
              className:
                "h-9 w-full rounded-md border border-neutral-800 bg-black px-3 font-mono text-sm text-neutral-200 placeholder:text-neutral-700 focus:border-neutral-600 disabled:cursor-wait disabled:opacity-50"
            })
          ),
        error &&
          React.createElement(
            "div",
            { className: "rounded-md border border-red-700/30 bg-red-200/35 px-3 py-2 text-xs text-red-900" },
            error
          )
      ),
      React.createElement(
        "div",
        { className: "flex items-center justify-end gap-2 border-t border-neutral-900 px-4 py-3" },
        React.createElement(
          "button",
          {
            type: "button",
            onClick: onCancel,
            disabled: pending,
            className:
              "h-8 rounded-md px-3 text-sm font-medium text-neutral-500 transition-colors hover:bg-[#111111] hover:text-neutral-200 disabled:cursor-wait disabled:opacity-50"
          },
          cancelLabel
        ),
        React.createElement(
          "button",
          {
            type: "button",
            onClick: onConfirm,
            disabled: actionDisabled,
            className:
              "h-8 rounded-md bg-red-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-red-950/40 disabled:text-red-300/50"
          },
          pending ? (pendingLabel ?? confirmLabel) : confirmLabel
        )
      )
    )
  );
}
