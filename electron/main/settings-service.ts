import fs from "node:fs";
import path from "node:path";
import {
  commandPaletteKeybindingActionIds,
  defaultCommandPaletteKeybindings,
  type AppSettings,
  type CommandPaletteKeybindingActionId
} from "../../src/shared/domain/settings.js";
import { normalizeCommitTemplates } from "../../src/shared/commit-templates.js";
import { defaultWorkspacePath } from "./path-utils.js";
import { validateHandoffCommand } from "./shell/handoff.js";

const fallbackDirName = ".fallback";
const configFileName = "config.json";
const workspacePointerVersion = 1;

interface SettingsServiceOptions {
  workspacePointerPath?: string | null;
}

export interface SettingsDiagnostics {
  workspacePath: string;
  configPath: string;
  workspacePointerPath: string | null;
  configStatus: "ok" | "missing" | "corrupt";
  pointerStatus: "ok" | "missing" | "corrupt" | "disabled";
}

export class SettingsService {
  private settings: AppSettings;
  private loaded = false;
  private readonly workspacePointerPath: string | null;
  private configStatus: SettingsDiagnostics["configStatus"] = "missing";
  private pointerStatus: SettingsDiagnostics["pointerStatus"] = "disabled";

  constructor(options: SettingsServiceOptions = {}) {
    this.workspacePointerPath = options.workspacePointerPath ?? null;
    this.settings = {
      workspacePath: defaultWorkspacePath(),
      defaultWatchMode: "cloned",
      cloneReposByDefault: true,
      createRepoFoldersOnWatch: true,
      openRepoFolderAfterWatch: false,
      restoreWindowsOnLaunch: false,
      syncFrequencyMinutes: 30,
      closedIssueRetentionDays: 365,
      shell: defaultShellHandoffSettings(),
      branchIntegrity: defaultBranchIntegritySettings(),
      attention: defaultAttentionSettings(),
      keybindings: defaultKeybindingSettings(),
      commitTemplates: []
    };
  }

  get(): AppSettings {
    this.ensureWorkspace();
    return { ...this.settings };
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const validatedPatch = validateSettingsPatch(patch);
    if (!this.loaded) {
      if (validatedPatch.workspacePath) {
        this.settings = normalizeSettings({ ...this.settings, workspacePath: validatedPatch.workspacePath });
        this.readIfExists();
        this.loaded = true;
      } else {
        this.ensureWorkspace();
      }
    }
    this.settings = normalizeSettings({ ...this.settings, ...validatedPatch });
    this.ensureWorkspace();
    return this.get();
  }

  ensureWorkspace(): void {
    if (!this.loaded) {
      this.readWorkspacePointer();
      this.readIfExists();
      this.loaded = true;
    }
    const fallbackPath = path.join(this.settings.workspacePath, fallbackDirName);
    fs.mkdirSync(path.join(fallbackPath, "logs"), { recursive: true });
    fs.mkdirSync(path.join(fallbackPath, "tmp"), { recursive: true });
    if (this.configStatus !== "corrupt") this.write();
    this.writeWorkspacePointer();
  }

  configPath(): string {
    return path.join(this.settings.workspacePath, fallbackDirName, configFileName);
  }

  databasePath(): string {
    return path.join(this.settings.workspacePath, fallbackDirName, "fallback.sqlite");
  }

  diagnostics(): SettingsDiagnostics {
    this.ensureWorkspace();
    return {
      workspacePath: this.settings.workspacePath,
      configPath: this.configPath(),
      workspacePointerPath: this.workspacePointerPath,
      configStatus: this.configStatus,
      pointerStatus: this.pointerStatus
    };
  }

  private readIfExists(): void {
    const configPath = this.configPath();
    if (!fs.existsSync(configPath)) {
      this.configStatus = "missing";
      return;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as Partial<AppSettings>;
      this.settings = normalizeSettings({ ...this.settings, ...coercePersistedSettings(parsed) });
      this.configStatus = "ok";
    } catch {
      this.configStatus = "corrupt";
    }
  }

  private write(): void {
    writeFileIfChanged(this.configPath(), `${JSON.stringify(this.settings, null, 2)}\n`);
    this.configStatus = "ok";
  }

  private readWorkspacePointer(): void {
    if (!this.workspacePointerPath) {
      this.pointerStatus = "disabled";
      return;
    }
    if (!fs.existsSync(this.workspacePointerPath)) {
      this.pointerStatus = "missing";
      return;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.workspacePointerPath, "utf8")) as { workspacePath?: unknown };
      if (typeof parsed.workspacePath === "string" && parsed.workspacePath.trim()) {
        this.settings = normalizeSettings({ ...this.settings, workspacePath: parsed.workspacePath });
        this.pointerStatus = "ok";
      } else {
        this.pointerStatus = "corrupt";
      }
    } catch {
      this.pointerStatus = "corrupt";
      // A corrupt pointer should not block startup; the workspace config can be recovered manually.
    }
  }

  private writeWorkspacePointer(): void {
    if (!this.workspacePointerPath) return;
    fs.mkdirSync(path.dirname(this.workspacePointerPath), { recursive: true });
    const payload = {
      version: workspacePointerVersion,
      workspacePath: this.settings.workspacePath
    };
    const next = `${JSON.stringify(payload, null, 2)}\n`;
    if (fileMatches(this.workspacePointerPath, next)) {
      this.pointerStatus = "ok";
      return;
    }
    const tempPath = `${this.workspacePointerPath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, next);
    fs.renameSync(tempPath, this.workspacePointerPath);
    this.pointerStatus = "ok";
  }
}

function writeFileIfChanged(filePath: string, contents: string): void {
  if (fileMatches(filePath, contents)) return;
  fs.writeFileSync(filePath, contents);
}

function fileMatches(filePath: string, contents: string): boolean {
  try {
    return fs.readFileSync(filePath, "utf8") === contents;
  } catch {
    return false;
  }
}

export function validateSettingsPatch(value: unknown): Partial<AppSettings> {
  if (!isPlainObject(value)) throw new Error("Settings patch must be an object.");
  const allowed = new Set<keyof AppSettings>([
    "workspacePath",
    "defaultWatchMode",
    "cloneReposByDefault",
    "createRepoFoldersOnWatch",
    "openRepoFolderAfterWatch",
    "restoreWindowsOnLaunch",
    "syncFrequencyMinutes",
    "closedIssueRetentionDays",
    "shell",
    "branchIntegrity",
    "attention",
    "keybindings",
    "commitTemplates"
  ]);
  const patch = value as Record<string, unknown>;
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key as keyof AppSettings)) throw new Error(`Unknown settings key: ${key}`);
  }
  return coerceSettingsPatch(patch, { strict: true });
}

function coercePersistedSettings(value: unknown): Partial<AppSettings> {
  return isPlainObject(value) ? coerceSettingsPatch(value, { strict: false }) : {};
}

function coerceSettingsPatch(value: Record<string, unknown>, options: { strict: boolean }): Partial<AppSettings> {
  const patch: Partial<AppSettings> = {};
  const has = (key: keyof AppSettings) => Object.prototype.hasOwnProperty.call(value, key);
  if (has("workspacePath")) patch.workspacePath = assertStringValue(value.workspacePath, "workspacePath", options);
  if (has("defaultWatchMode")) {
    if (value.defaultWatchMode !== "metadata-only" && value.defaultWatchMode !== "cloned") {
      if (options.strict) throw new Error("defaultWatchMode must be metadata-only or cloned.");
    } else {
      patch.defaultWatchMode = value.defaultWatchMode;
    }
  }
  for (const key of ["cloneReposByDefault", "createRepoFoldersOnWatch", "openRepoFolderAfterWatch", "restoreWindowsOnLaunch"] as const) {
    if (has(key)) patch[key] = assertBooleanValue(value[key], key, options);
  }
  if (has("syncFrequencyMinutes"))
    patch.syncFrequencyMinutes = assertNumberValue(value.syncFrequencyMinutes, "syncFrequencyMinutes", options);
  if (has("closedIssueRetentionDays"))
    patch.closedIssueRetentionDays = assertNumberValue(value.closedIssueRetentionDays, "closedIssueRetentionDays", options);
  if (has("shell")) patch.shell = validateShellSettings(value.shell, options);
  if (has("branchIntegrity")) patch.branchIntegrity = validateBranchIntegritySettings(value.branchIntegrity, options);
  if (has("attention")) patch.attention = validateAttentionSettings(value.attention, options);
  if (has("keybindings")) patch.keybindings = validateKeybindingSettings(value.keybindings, options);
  if (has("commitTemplates")) {
    if (!Array.isArray(value.commitTemplates)) {
      if (options.strict) throw new Error("commitTemplates must be an array.");
    } else {
      patch.commitTemplates = normalizeCommitTemplates(value.commitTemplates);
    }
  }
  return patch;
}

function normalizeSettings(settings: AppSettings): AppSettings {
  return {
    workspacePath: settings.workspacePath || defaultWorkspacePath(),
    defaultWatchMode: settings.defaultWatchMode === "metadata-only" ? "metadata-only" : "cloned",
    cloneReposByDefault: settings.cloneReposByDefault ?? true,
    createRepoFoldersOnWatch: settings.createRepoFoldersOnWatch ?? true,
    openRepoFolderAfterWatch: settings.openRepoFolderAfterWatch ?? false,
    restoreWindowsOnLaunch: settings.restoreWindowsOnLaunch ?? false,
    syncFrequencyMinutes: Math.max(5, Math.min(240, Math.round(Number(settings.syncFrequencyMinutes) || 30))),
    closedIssueRetentionDays: normalizeClosedIssueRetentionDays(settings.closedIssueRetentionDays),
    shell: normalizeShellHandoffSettings(settings.shell),
    branchIntegrity: normalizeBranchIntegritySettings(settings.branchIntegrity),
    attention: normalizeAttentionSettings(settings.attention),
    keybindings: normalizeKeybindingSettings(settings.keybindings),
    commitTemplates: normalizeCommitTemplates(settings.commitTemplates)
  };
}

function normalizeClosedIssueRetentionDays(value: unknown): number {
  const days = Math.round(Number(value));
  if (!Number.isFinite(days)) return 365;
  if (days <= 0) return 0;
  return Math.max(30, Math.min(3650, days));
}

function defaultShellHandoffSettings(): AppSettings["shell"] {
  return {
    preferredEditorCommand: null,
    preferredTerminalCommand: null
  };
}

function normalizeShellHandoffSettings(value: Partial<AppSettings["shell"]> | undefined): AppSettings["shell"] {
  const defaults = defaultShellHandoffSettings();
  return {
    preferredEditorCommand:
      nullableHandoffCommand(value?.preferredEditorCommand, "Preferred editor command") ?? defaults.preferredEditorCommand,
    preferredTerminalCommand:
      nullableHandoffCommand(value?.preferredTerminalCommand, "Preferred terminal command") ?? defaults.preferredTerminalCommand
  };
}

function defaultAttentionSettings(): AppSettings["attention"] {
  return {
    collapseBotActivity: true,
    promoteFailingChecks: true,
    promoteDirectMentions: true,
    promoteReviewRequests: true,
    quietPassingCi: true,
    workingHoursStart: "09:00",
    workingHoursEnd: "17:00"
  };
}

function normalizeAttentionSettings(value: Partial<AppSettings["attention"]> | undefined): AppSettings["attention"] {
  const defaults = defaultAttentionSettings();
  return {
    collapseBotActivity: value?.collapseBotActivity ?? defaults.collapseBotActivity,
    promoteFailingChecks: value?.promoteFailingChecks ?? defaults.promoteFailingChecks,
    promoteDirectMentions: value?.promoteDirectMentions ?? defaults.promoteDirectMentions,
    promoteReviewRequests: value?.promoteReviewRequests ?? defaults.promoteReviewRequests,
    quietPassingCi: value?.quietPassingCi ?? defaults.quietPassingCi,
    workingHoursStart: validClock(value?.workingHoursStart) ? value.workingHoursStart : defaults.workingHoursStart,
    workingHoursEnd: validClock(value?.workingHoursEnd) ? value.workingHoursEnd : defaults.workingHoursEnd
  };
}

function defaultKeybindingSettings(): AppSettings["keybindings"] {
  return {
    commandPalette: { ...defaultCommandPaletteKeybindings }
  };
}

function normalizeKeybindingSettings(value: Partial<AppSettings["keybindings"]> | undefined): AppSettings["keybindings"] {
  const defaults = defaultKeybindingSettings();
  return {
    commandPalette: normalizeCommandPaletteKeybindings(value?.commandPalette, defaults.commandPalette)
  };
}

function normalizeCommandPaletteKeybindings(
  value: Partial<AppSettings["keybindings"]["commandPalette"]> | undefined,
  defaults: AppSettings["keybindings"]["commandPalette"]
): AppSettings["keybindings"]["commandPalette"] {
  const next = { ...defaults };
  if (!isPlainObject(value)) return next;
  for (const id of commandPaletteKeybindingActionIds) {
    const binding = normalizeKeybinding(value[id]);
    if (binding !== undefined) next[id] = binding;
  }
  return next;
}

function defaultBranchIntegritySettings(): AppSettings["branchIntegrity"] {
  return {
    enabled: true,
    fetchSafetyRefs: true,
    automaticAuditAfterSync: true,
    alertThreshold: "high",
    largeDiffRatioThreshold: 5,
    largeDiffAbsoluteThreshold: 500,
    requireExactMergeGroupTreeForReleases: true
  };
}

function normalizeBranchIntegritySettings(value: Partial<AppSettings["branchIntegrity"]> | undefined): AppSettings["branchIntegrity"] {
  const defaults = defaultBranchIntegritySettings();
  return {
    enabled: value?.enabled ?? defaults.enabled,
    fetchSafetyRefs: value?.fetchSafetyRefs ?? defaults.fetchSafetyRefs,
    automaticAuditAfterSync: value?.automaticAuditAfterSync ?? defaults.automaticAuditAfterSync,
    alertThreshold: isSeverity(value?.alertThreshold) ? value.alertThreshold : defaults.alertThreshold,
    largeDiffRatioThreshold: Math.max(1, Math.min(20, Number(value?.largeDiffRatioThreshold ?? defaults.largeDiffRatioThreshold) || 5)),
    largeDiffAbsoluteThreshold: Math.max(
      50,
      Math.min(10_000, Math.round(Number(value?.largeDiffAbsoluteThreshold ?? defaults.largeDiffAbsoluteThreshold) || 500))
    ),
    requireExactMergeGroupTreeForReleases: value?.requireExactMergeGroupTreeForReleases ?? defaults.requireExactMergeGroupTreeForReleases
  };
}

function isSeverity(value: unknown): value is AppSettings["branchIntegrity"]["alertThreshold"] {
  return value === "critical" || value === "high" || value === "medium" || value === "low";
}

function validClock(value: unknown): value is string {
  return typeof value === "string" && /^\d{2}:\d{2}$/.test(value);
}

function nullableNonEmptyString(value: unknown): string | null | undefined {
  if (value == null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function nullableHandoffCommand(value: unknown, label: string): string | null | undefined {
  const trimmed = nullableNonEmptyString(value);
  if (!trimmed) return trimmed;
  return validateHandoffCommand(trimmed, label);
}

function normalizeKeybinding(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  if (!value.trim()) return null;
  const normalized = value
    .split(/\s+/)
    .map((part) => normalizeKeybindingSegment(part))
    .filter((part): part is string => Boolean(part))
    .join(" ");
  return normalized || undefined;
}

function normalizeKeybindingSegment(value: string): string | null {
  const rawParts = value
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (rawParts.length === 0) return null;

  const modifiers: Array<"Ctrl" | "Alt" | "Shift" | "Cmd"> = [];
  let key: string | null = null;
  for (const rawPart of rawParts) {
    const part = rawPart.toLowerCase();
    const modifier =
      part === "control" || part === "ctrl"
        ? "Ctrl"
        : part === "option" || part === "alt"
          ? "Alt"
          : part === "shift"
            ? "Shift"
            : part === "cmd" || part === "command" || part === "meta"
              ? "Cmd"
              : null;
    if (modifier) {
      if (!modifiers.includes(modifier)) modifiers.push(modifier);
      continue;
    }
    key = normalizeKeybindingKey(rawPart);
  }
  if (!key) return null;
  const orderedModifiers = (["Ctrl", "Alt", "Shift", "Cmd"] as const).filter((modifier) => modifiers.includes(modifier));
  return [...orderedModifiers, key].join("+");
}

function normalizeKeybindingKey(value: string): string | null {
  if (value.length === 1) return /^[a-z0-9,.[\]\\/;'"`=-]$/i.test(value) ? value.toUpperCase() : null;
  const lower = value.toLowerCase();
  if (lower === "enter" || lower === "return") return "Enter";
  if (lower === "space") return "Space";
  if (lower === "tab") return "Tab";
  if (lower === "escape" || lower === "esc") return "Esc";
  if (lower === "backspace") return "Backspace";
  if (lower === "delete" || lower === "del") return "Delete";
  return null;
}

function validateShellSettings(value: unknown, options: { strict: boolean }): AppSettings["shell"] | undefined {
  if (!isPlainObject(value)) {
    if (options.strict) throw new Error("shell settings must be an object.");
    return undefined;
  }
  const allowed = new Set(["preferredEditorCommand", "preferredTerminalCommand"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key) && options.strict) throw new Error(`Unknown shell settings key: ${key}`);
  }
  return {
    preferredEditorCommand: nullableHandoffCommand(value.preferredEditorCommand, "Preferred editor command") ?? null,
    preferredTerminalCommand: nullableHandoffCommand(value.preferredTerminalCommand, "Preferred terminal command") ?? null
  };
}

function validateAttentionSettings(value: unknown, options: { strict: boolean }): AppSettings["attention"] | undefined {
  if (!isPlainObject(value)) {
    if (options.strict) throw new Error("attention settings must be an object.");
    return undefined;
  }
  const allowed = new Set([
    "collapseBotActivity",
    "promoteFailingChecks",
    "promoteDirectMentions",
    "promoteReviewRequests",
    "quietPassingCi",
    "workingHoursStart",
    "workingHoursEnd"
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key) && options.strict) throw new Error(`Unknown attention settings key: ${key}`);
  }
  const defaults = defaultAttentionSettings();
  return {
    collapseBotActivity: coerceBoolean(value.collapseBotActivity, defaults.collapseBotActivity, "collapseBotActivity", options),
    promoteFailingChecks: coerceBoolean(value.promoteFailingChecks, defaults.promoteFailingChecks, "promoteFailingChecks", options),
    promoteDirectMentions: coerceBoolean(value.promoteDirectMentions, defaults.promoteDirectMentions, "promoteDirectMentions", options),
    promoteReviewRequests: coerceBoolean(value.promoteReviewRequests, defaults.promoteReviewRequests, "promoteReviewRequests", options),
    quietPassingCi: coerceBoolean(value.quietPassingCi, defaults.quietPassingCi, "quietPassingCi", options),
    workingHoursStart: validClock(value.workingHoursStart) ? value.workingHoursStart : defaults.workingHoursStart,
    workingHoursEnd: validClock(value.workingHoursEnd) ? value.workingHoursEnd : defaults.workingHoursEnd
  };
}

function validateKeybindingSettings(value: unknown, options: { strict: boolean }): AppSettings["keybindings"] | undefined {
  if (!isPlainObject(value)) {
    if (options.strict) throw new Error("keybindings settings must be an object.");
    return undefined;
  }
  const allowed = new Set(["commandPalette"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key) && options.strict) throw new Error(`Unknown keybindings settings key: ${key}`);
  }
  return {
    commandPalette: validateCommandPaletteKeybindings(value.commandPalette, options)
  };
}

function validateCommandPaletteKeybindings(value: unknown, options: { strict: boolean }): AppSettings["keybindings"]["commandPalette"] {
  if (!isPlainObject(value)) {
    if (options.strict) throw new Error("commandPalette keybindings must be an object.");
    return { ...defaultCommandPaletteKeybindings };
  }
  const allowed = new Set<string>(commandPaletteKeybindingActionIds);
  const next = { ...defaultCommandPaletteKeybindings };
  for (const [key, rawBinding] of Object.entries(value)) {
    if (!allowed.has(key)) {
      if (options.strict) throw new Error(`Unknown commandPalette keybinding: ${key}`);
      continue;
    }
    const binding = normalizeKeybinding(rawBinding);
    if (binding === undefined) {
      if (options.strict) throw new Error(`${key} keybinding must be a shortcut string or null.`);
      continue;
    }
    next[key as CommandPaletteKeybindingActionId] = binding;
  }
  return next;
}

function validateBranchIntegritySettings(value: unknown, options: { strict: boolean }): AppSettings["branchIntegrity"] | undefined {
  if (!isPlainObject(value)) {
    if (options.strict) throw new Error("branchIntegrity settings must be an object.");
    return undefined;
  }
  const allowed = new Set([
    "enabled",
    "fetchSafetyRefs",
    "automaticAuditAfterSync",
    "alertThreshold",
    "largeDiffRatioThreshold",
    "largeDiffAbsoluteThreshold",
    "requireExactMergeGroupTreeForReleases"
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key) && options.strict) throw new Error(`Unknown branchIntegrity settings key: ${key}`);
  }
  const defaults = defaultBranchIntegritySettings();
  return {
    enabled: coerceBoolean(value.enabled, defaults.enabled, "enabled", options),
    fetchSafetyRefs: coerceBoolean(value.fetchSafetyRefs, defaults.fetchSafetyRefs, "fetchSafetyRefs", options),
    automaticAuditAfterSync: coerceBoolean(
      value.automaticAuditAfterSync,
      defaults.automaticAuditAfterSync,
      "automaticAuditAfterSync",
      options
    ),
    alertThreshold: isSeverity(value.alertThreshold) ? value.alertThreshold : defaults.alertThreshold,
    largeDiffRatioThreshold: coerceNumber(value.largeDiffRatioThreshold, defaults.largeDiffRatioThreshold),
    largeDiffAbsoluteThreshold: coerceNumber(value.largeDiffAbsoluteThreshold, defaults.largeDiffAbsoluteThreshold),
    requireExactMergeGroupTreeForReleases: coerceBoolean(
      value.requireExactMergeGroupTreeForReleases,
      defaults.requireExactMergeGroupTreeForReleases,
      "requireExactMergeGroupTreeForReleases",
      options
    )
  };
}

function assertStringValue(value: unknown, label: string, options: { strict: boolean }): string | undefined {
  if (typeof value === "string" && value.trim()) {
    if (label === "workspacePath" && !path.isAbsolute(value)) {
      if (options.strict) throw new Error("workspacePath must be an absolute path.");
      return undefined;
    }
    return value;
  }
  if (options.strict) throw new Error(`${label} must be a non-empty string.`);
  return undefined;
}

function assertBooleanValue(value: unknown, label: string, options: { strict: boolean }): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (options.strict) throw new Error(`${label} must be a boolean.`);
  return undefined;
}

function assertNumberValue(value: unknown, label: string, options: { strict: boolean }): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (options.strict) throw new Error(`${label} must be a finite number.`);
  return undefined;
}

function coerceBoolean(value: unknown, fallback: boolean, label: string, options: { strict: boolean }): boolean {
  if (value === undefined) return fallback;
  const coerced = assertBooleanValue(value, label, options);
  return coerced ?? fallback;
}

function coerceNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
