import { ipcAuditCategories, ipcChannelMetadata, ipcChannels, ipcInvokeChannelKeys, type IpcChannelKey } from "../src/shared/ipc.js";
import fs from "node:fs";
import path from "node:path";

const channelKeys = Object.keys(ipcChannels) as IpcChannelKey[];
const metadataKeys = Object.keys(ipcChannelMetadata) as IpcChannelKey[];
const metadataKeySet = new Set(metadataKeys);
const channelKeySet = new Set(channelKeys);

const missingMetadata = channelKeys.filter((key) => !metadataKeySet.has(key));
const extraMetadata = metadataKeys.filter((key) => !channelKeySet.has(key));
const mismatchedMetadata = channelKeys.filter((key) => ipcChannelMetadata[key]?.channel !== ipcChannels[key]);
const duplicateChannels = duplicated(Object.values(ipcChannels));
const missingRiskMetadata = channelKeys.filter((key) => !ipcChannelMetadata[key]?.risk);
const implicitPolicy = channelKeys.filter((key) => {
  const metadata = ipcChannelMetadata[key];
  return (
    !metadata.group ||
    !metadata.kind ||
    !metadata.validation ||
    !metadata.repoVisibility ||
    !metadata.operationRecord ||
    !metadata.confirmationPolicy ||
    !metadata.handlerCoverage
  );
});

const privilegedInputChannels: IpcChannelKey[] = [
  "settingsUpdate",
  "shellOpenExternal",
  "shellOpenPath",
  "shellOpenEditor",
  "shellOpenEditorAtLine",
  "shellOpenTerminal",
  "shellRevealPath"
];
const missingPrivilegedValidation = privilegedInputChannels.filter(
  (key) => ipcChannelMetadata[key]?.validation !== "explicit" || !ipcChannelMetadata[key]?.privilegedInputValidated
);
const destructiveWithoutConfirmation = channelKeys.filter(
  (key) =>
    ipcChannelMetadata[key].risk === "destructive_local_git_mutation" && ipcChannelMetadata[key].confirmationPolicy === "not_required"
);
const localGitMutationWithoutOperationPolicy = channelKeys.filter(
  (key) =>
    (ipcChannelMetadata[key].risk === "local_git_mutation" || ipcChannelMetadata[key].risk === "destructive_local_git_mutation") &&
    ipcChannelMetadata[key].operationRecord === "not_required"
);
const operationExemptionWithoutReason = channelKeys.filter(
  (key) => ipcChannelMetadata[key].operationRecord === "exempt" && !ipcChannelMetadata[key].operationRecordExemption
);
const riskyRepoChannelsWithoutVisibilityPolicy = channelKeys.filter((key) => {
  const metadata = ipcChannelMetadata[key];
  const repoScoped = key.startsWith("repos") || key.startsWith("branchIntegrity");
  const risky =
    metadata.risk === "local_filesystem_read" ||
    metadata.risk === "local_git_mutation" ||
    metadata.risk === "destructive_local_git_mutation" ||
    metadata.risk === "external_app_launch" ||
    metadata.risk === "network_write";
  return repoScoped && risky && metadata.repoVisibility === "not_required";
});

failIfAny({
  missingMetadata,
  extraMetadata,
  mismatchedMetadata,
  duplicateChannels,
  missingRiskMetadata,
  implicitPolicy,
  missingPrivilegedValidation,
  destructiveWithoutConfirmation,
  localGitMutationWithoutOperationPolicy,
  operationExemptionWithoutReason,
  riskyRepoChannelsWithoutVisibilityPolicy
});

const sourceRoot = process.cwd();
const ipcDirectory = path.join(sourceRoot, "electron/main/ipc");
const ipcSources = fs
  .readdirSync(ipcDirectory)
  .filter((file) => file.endsWith(".ts"))
  .map((file) => fs.readFileSync(path.join(ipcDirectory, file), "utf8"))
  .join("\n");
const preloadSource = fs.readFileSync(path.join(sourceRoot, "electron/preload/index.ts"), "utf8");

const handlerRegistrationCounts = Object.fromEntries(
  ipcInvokeChannelKeys.map((key) => [key, countPattern(ipcSources, `\\b(?:ipc\\.handle|handleIpc)\\(\\s*["']${key}["']`)])
) as Record<IpcChannelKey, number>;
const missingMainHandlers = ipcInvokeChannelKeys.filter((key) => handlerRegistrationCounts[key] === 0);
const duplicateMainHandlers = ipcInvokeChannelKeys.filter((key) => handlerRegistrationCounts[key] > 1);
const preloadUsageCounts = Object.fromEntries(
  channelKeys.map((key) => [key, countPattern(preloadSource, `\\b(?:invoke|send|onAppEvent|channel)\\(\\s*["']${key}["']`)])
) as Record<IpcChannelKey, number>;
const missingPreloadUsage = channelKeys.filter((key) => preloadUsageCounts[key] === 0);
const directChannelConstants = /ipcChannels\./.test(preloadSource);
const missingValidationSources = [
  ipcSources.includes("validateSettingsPatch") ? null : "validateSettingsPatch",
  ipcSources.includes("assertTrustedLocalPath") ? null : "assertTrustedLocalPath",
  ipcSources.includes("assertHttpsUrl") ? null : "assertHttpsUrl"
].filter((value): value is string => Boolean(value));
const explicitValidationWithoutLocalValidator = channelKeys.filter((key) => {
  const metadata = ipcChannelMetadata[key];
  if (metadata.kind !== "invoke" || metadata.validation !== "explicit") return false;
  const handlerSource = handlerSourceForKey(ipcSources, key);
  return !/\b(assert[A-Z][A-Za-z0-9_]*|validate[A-Z][A-Za-z0-9_]*)\b/.test(handlerSource);
});
const requiredVisibilityHandlersWithoutRegistrar = channelKeys.filter((key) => {
  const metadata = ipcChannelMetadata[key];
  if (metadata.kind !== "invoke" || metadata.repoVisibility !== "required") return false;
  return !countPattern(ipcSources, `\\bipc\\.handle\\(\\s*["']${key}["']`);
});

failIfAny({
  missingMainHandlers,
  duplicateMainHandlers,
  missingPreloadUsage,
  directChannelConstants: directChannelConstants ? ["electron/preload/index.ts"] : [],
  missingValidationSources,
  explicitValidationWithoutLocalValidator,
  requiredVisibilityHandlersWithoutRegistrar
});

console.log(`IPC contract ok: ${channelKeys.length} channels`);
console.log(
  `IPC audit categories: local fs ${ipcAuditCategories.localFilesystemReads.length}, local git ${ipcAuditCategories.localGitMutations.length}, destructive ${ipcAuditCategories.destructiveMutations.length}, network writes ${ipcAuditCategories.networkWrites.length}, external app launches ${ipcAuditCategories.externalAppLaunches.length}`
);

function failIfAny(groups: Record<string, unknown[]>): void {
  if (Object.values(groups).some((items) => items.length > 0)) {
    console.error(JSON.stringify(groups, null, 2));
    process.exit(1);
  }
}

function countPattern(source: string, pattern: string): number {
  return [...source.matchAll(new RegExp(pattern, "g"))].length;
}

function handlerSourceForKey(source: string, key: IpcChannelKey): string {
  const match = new RegExp(`\\b(?:ipc\\.handle|handleIpc)\\(\\s*["']${key}["']`).exec(source);
  if (!match) return "";
  const rest = source.slice(match.index);
  const nextHandler = rest.slice(1).search(/\b(?:ipc\.handle|handleIpc)\(\s*["'][A-Za-z0-9_]+["']/);
  return nextHandler < 0 ? rest : rest.slice(0, nextHandler + 1);
}

function duplicated(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    else seen.add(value);
  }
  return [...duplicates];
}
