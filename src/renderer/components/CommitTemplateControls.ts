import React from "react";
import { Save, WandSparkles } from "lucide-react";
import type { CommitTemplate } from "../../shared/domain/local-git.js";

interface CommitTemplateControlsProps {
  templates: CommitTemplate[];
  selectedTemplateId: string;
  templateName: string;
  canApply: boolean;
  canSave: boolean;
  busy?: boolean;
  onSelectedTemplateIdChange: (id: string) => void;
  onTemplateNameChange: (name: string) => void;
  onApply: () => void;
  onSave: () => void;
}

export function CommitTemplateControls({
  templates,
  selectedTemplateId,
  templateName,
  canApply,
  canSave,
  busy = false,
  onSelectedTemplateIdChange,
  onTemplateNameChange,
  onApply,
  onSave
}: CommitTemplateControlsProps) {
  return React.createElement(
    "details",
    { className: "group rounded-md border border-neutral-900/80 bg-black/10 text-[11px] text-neutral-500" },
    React.createElement(
      "summary",
      {
        className:
          "flex h-9 cursor-pointer list-none items-center justify-between gap-2 px-2.5 outline-none transition-colors hover:bg-neutral-900/50 hover:text-neutral-300 focus-visible:ring-1 focus-visible:ring-neutral-600 [&::-webkit-details-marker]:hidden"
      },
      React.createElement("span", null, "Commit template"),
      React.createElement(
        "span",
        { className: "min-w-0 truncate font-mono text-neutral-600" },
        selectedTemplateLabel(templates, selectedTemplateId)
      )
    ),
    React.createElement(
      "div",
      { className: "grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-t border-neutral-900 px-2.5 py-2" },
      React.createElement(
        "label",
        { className: "grid min-w-0 gap-1 text-[11px] text-neutral-600" },
        React.createElement("span", null, "Use template"),
        React.createElement(
          "select",
          {
            value: selectedTemplateId,
            disabled: busy || templates.length === 0,
            onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onSelectedTemplateIdChange(event.currentTarget.value),
            className:
              "h-8 min-w-0 rounded-md border border-neutral-800 bg-black px-2 text-[12px] text-neutral-300 focus:border-neutral-600"
          },
          templates.length === 0
            ? React.createElement("option", { value: "" }, "No templates")
            : templates.map((template) => React.createElement("option", { key: template.id, value: template.id }, templateLabel(template)))
        )
      ),
      React.createElement(
        "button",
        {
          type: "button",
          "aria-label": "Apply template",
          title: canApply ? "Apply template" : "Select a template to apply",
          onClick: onApply,
          disabled: busy || !canApply,
          className: "ui-button ui-button-secondary ui-button-sm ui-icon-button self-end"
        },
        React.createElement(WandSparkles, { className: "h-3.5 w-3.5" })
      )
    ),
    React.createElement(
      "div",
      { className: "grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-2.5 pb-2" },
      React.createElement(
        "label",
        { className: "grid min-w-0 gap-1 text-[11px] text-neutral-600" },
        React.createElement("span", null, "Save current draft"),
        React.createElement("input", {
          value: templateName,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => onTemplateNameChange(event.currentTarget.value),
          placeholder: "Template name",
          className: "ui-input text-[12px]"
        })
      ),
      React.createElement(
        "div",
        { className: "self-end" },
        React.createElement(
          "button",
          {
            type: "button",
            "aria-label": "Save repo template",
            title: canSave ? "Save repo template" : "Enter a template name before saving",
            onClick: onSave,
            disabled: busy || !canSave,
            className: "ui-button ui-button-secondary ui-button-sm ui-icon-button"
          },
          React.createElement(Save, { className: "h-3.5 w-3.5" })
        )
      )
    )
  );
}

function selectedTemplateLabel(templates: CommitTemplate[], selectedTemplateId: string): string {
  const template = templates.find((item) => item.id === selectedTemplateId);
  return template ? templateLabel(template) : "none";
}

function templateLabel(template: CommitTemplate): string {
  if (template.source === "git") return "Git template";
  if (template.source === "builtin") return template.name;
  return template.scope === "repo" ? `${template.name} · repo` : `${template.name} · global`;
}
