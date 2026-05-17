import type { AuthState } from "../../shared/domain/auth";
import { hasAuthAccountDetails } from "../../shared/auth-recovery";
import { endpointLabel } from "../lib/format";

export function AccountIdentityButton({ auth }: { auth: AuthState }) {
  if (!hasAuthAccountDetails(auth)) return null;
  return (
    <button
      type="button"
      className="inline-flex h-8 max-w-[220px] items-center gap-2 rounded-md px-2 text-[13px] text-neutral-500 transition-colors hover:bg-white/[0.04] hover:text-neutral-200"
      title={`${auth.login ?? "GitHub"} - ${endpointLabel(auth.endpoint)}`}
    >
      <span className="truncate">@{auth.login ?? "GitHub"}</span>
      <span className="text-neutral-700">-</span>
      <span className="hidden truncate lg:inline">{endpointLabel(auth.endpoint)}</span>
    </button>
  );
}
