import type { WatchedRepo } from "../../shared/domain/watched-repo";
import { SyncLoader } from "./SyncLoader";

function isActiveSyncStatus(status: WatchedRepo["syncStatus"]): boolean {
  return status === "queued" || status === "syncing";
}

function syncStatusLabel(status: WatchedRepo["syncStatus"]): string {
  return status.replaceAll("_", " ");
}

export function SyncBadge({ status }: { status: WatchedRepo["syncStatus"] }) {
  const isSynced = status === "fresh";
  const isActive = isActiveSyncStatus(status);
  if (isActive) {
    return (
      <div className="flex min-w-[58px] items-center justify-end" title={syncStatusLabel(status)}>
        <SyncLoader size={17} dotSize={2.5} label={syncStatusLabel(status)} />
      </div>
    );
  }

  return (
    <div
      className={`flex min-w-[58px] items-center justify-end gap-1.5 text-[11.5px] font-medium ${
        isSynced ? "text-green-900" : status === "failed" || status === "auth_error" ? "text-red-900" : "text-gray-900"
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          isSynced ? "bg-green-900" : status === "failed" || status === "auth_error" ? "bg-red-900" : "bg-gray-900"
        }`}
      ></span>
      <span className="capitalize">{syncStatusLabel(status)}</span>
    </div>
  );
}
