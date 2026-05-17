import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, CircleDot } from "lucide-react";
import type { GitHubAccountSession } from "../../../shared/domain/auth";
import type {
  CredentialDiagnosticReport,
  RepoIdentity,
  RepoSigningReadiness,
  RepoSigningVerification,
  UpdateRepoIdentityInput
} from "../../../shared/domain/repo-identity";
import { identityRisk, type IdentityRiskAction } from "../../../shared/identity-risk";
import { useNavigationStore } from "../../state/navigation-store";
import { IdentityRiskWarning } from "../../components/IdentityRiskWarning";
import { CredentialDiagnosticsDialog } from "../../components/CredentialDiagnosticsDialog";
import { endpointLabel, formatRelative } from "../../lib/format";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function IdentityChip({
  identity,
  compact = false,
  labelMode = "account",
  busy,
  onApply,
  onDiagnose,
  onEdit,
  onIntent,
  onOpenSettings,
  allowApply = true
}: {
  identity?: RepoIdentity;
  compact?: boolean;
  labelMode?: IdentityChipLabelMode;
  busy: boolean;
  onApply: () => void;
  onDiagnose: () => void;
  onEdit: () => void;
  onIntent: () => void;
  onOpenSettings: () => void;
  allowApply?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const chipRisk = identityRisk(identity, "github");
  const tone =
    chipRisk.level === "warning"
      ? "border-amber-700/30 bg-amber-200/35 text-amber-900 hover:border-amber-700/50"
      : "border-border bg-background-100 text-gray-900 hover:border-gray-alpha-500 hover:text-gray-1000";
  const accountLabel = identity?.accountLogin ? `@${identity.accountLogin}` : "Repo unbound";
  const fullLabel = identity
    ? `${accountLabel} on ${endpointLabel(identity.accountEndpoint)} | ${identityAuthorLabel(identity)} | ${identity.branch ?? "branch unknown"}`
    : "Identity unknown";
  const label = identity
    ? labelMode === "author"
      ? identityAuthorName(identity)
      : compact
        ? `${accountLabel} · ${endpointLabel(identity.accountEndpoint)}`
        : fullLabel
    : "Identity unknown";
  const labelWidthClass = compact ? "max-w-[280px]" : "max-w-[420px]";
  const chipClassName =
    labelMode === "author"
      ? `flex h-8 w-full items-center justify-between rounded-md border border-neutral-800/80 bg-black/20 px-2.5 text-left text-[12px] text-neutral-300 transition-colors hover:border-neutral-700 hover:bg-neutral-900/50 ${chipRisk.level === "warning" ? "border-amber-500/25 text-neutral-200" : ""}`
      : `h-8 max-w-full rounded-md border px-2.5 text-left text-[12px] transition-colors shadow-border-small ${tone}`;
  return (
    <div className="relative">
      <button
        type="button"
        onMouseEnter={onIntent}
        onFocus={onIntent}
        onClick={() => {
          onIntent();
          setOpen((value) => !value);
        }}
        title={fullLabel}
        className={chipClassName}
      >
        {labelMode === "author" && <span className="text-neutral-600">Author</span>}
        <span className={`block ${labelWidthClass} truncate`}>{label}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[340px] rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-menu">
          <div className="space-y-2 text-[12px] text-muted-foreground">
            <IdentityDetail label="Account" value={identity?.accountLogin ? `@${identity.accountLogin}` : "Not bound"} />
            <IdentityDetail label="Host" value={endpointLabel(identity?.accountEndpoint)} />
            <IdentityDetail
              label="Author"
              value={`${identity?.gitName ?? identity?.currentGitName ?? "Unknown"} <${identity?.gitEmail ?? identity?.currentGitEmail ?? "no email"}>`}
            />
            <IdentityDetail label="Signing" value={identity ? identitySigningLabel(identity) : "unknown"} />
            {identity?.currentSigningKeyHint && <IdentityDetail label="Signing key" value={identity.currentSigningKeyHint} />}
            {identity?.currentGpgProgram && <IdentityDetail label="Signing program" value={identity.currentGpgProgram} />}
            {identity?.currentAllowedSignersFile && <IdentityDetail label="Allowed signers" value={identity.currentAllowedSignersFile} />}
            <IdentityDetail label="Remote" value={identity?.remoteUrl ?? "unknown"} />
            <IdentityDetail label="Workspace" value={identity?.localPath ?? "metadata-only"} />
            <IdentityDetail label="Credential health" value={identity ? identityHealthLabel(identity) : "unknown"} />
            {identity?.mismatchReason && (
              <div className="rounded-md border border-amber-700/30 bg-amber-200/35 p-2 text-amber-900">{identity.mismatchReason}</div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button
              onClick={() => {
                onIntent();
                onEdit();
              }}
              disabled={busy}
              className="h-8 rounded-md border border-border px-2.5 text-[12px] font-medium text-gray-900 transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            >
              Edit identity
            </button>
            <button
              onClick={() => {
                onIntent();
                onDiagnose();
              }}
              disabled={busy}
              className="h-8 rounded-md border border-border px-2.5 text-[12px] font-medium text-gray-900 transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            >
              Diagnose
            </button>
            <button
              onClick={onOpenSettings}
              disabled={busy}
              className="h-8 rounded-md border border-border px-2.5 text-[12px] font-medium text-gray-900 transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            >
              Settings
            </button>
            {allowApply && (
              <button
                onClick={() => {
                  onIntent();
                  onApply();
                }}
                disabled={busy || !identity?.gitEmail}
                className="h-8 rounded-md bg-primary px-2.5 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-accents-7 disabled:bg-muted disabled:text-muted-foreground"
              >
                Apply identity
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function identityHealthLabel(identity: RepoIdentity): string {
  const checked = identity.lastCheckedAt ? `checked ${formatRelative(identity.lastCheckedAt)}` : "not checked";
  return `${identity.lastCheckStatus} / email ${identity.verifiedEmailStatus} / ${checked}`;
}

function identitySigningLabel(identity: RepoIdentity): string {
  const state = commitSigningState(identity);
  if (identity.signingMode === "pixel") return "pixel stamp";
  const mode = identity.currentSigningMode ?? identity.signingMode ?? "unknown";
  return `${state.label}${mode !== state.label ? ` / ${mode}` : ""}`;
}

export function CommitSigningStatePanel({
  identity,
  repoId,
  compact = false
}: {
  identity?: RepoIdentity | null;
  repoId?: string;
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const [setupOpen, setSetupOpen] = useState(false);
  const state = commitSigningState(identity);
  const actionLabel =
    state.label === "unsigned" ? "Add signature" : state.label === "signed" || state.label === "pixel" ? "Edit signature" : "Fix signature";
  const updateSigning = useMutation({
    mutationFn: (input: Pick<UpdateRepoIdentityInput, "signingMode" | "signingKeyHint">) => {
      if (!repoId) throw new Error("Repository identity is not available.");
      return window.fallback.repos.updateIdentity(repoId, input);
    },
    onSuccess: async () => {
      setSetupOpen(false);
      if (repoId) await queryClient.invalidateQueries({ queryKey: ["repoIdentity", repoId] });
    }
  });
  const detailIsImportant = state.label === "failed" || state.label === "unknown" || state.label === "pixel";
  const content = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={compact ? "text-neutral-500" : "font-medium"}>Signing</span>
          <span className="font-mono text-neutral-400">{state.label}</span>
        </div>
        {repoId && (
          <button
            type="button"
            onClick={() => setSetupOpen(true)}
            className={
              compact
                ? "h-6 rounded-md border border-neutral-800 px-2 text-[11px] font-medium text-neutral-400 transition-colors hover:border-neutral-700 hover:bg-neutral-900 hover:text-neutral-200"
                : "h-6 rounded-md border border-current/20 px-2 text-[11px] font-medium opacity-90 transition-opacity hover:opacity-100"
            }
          >
            {compact && state.label === "unsigned" ? "Add" : actionLabel}
          </button>
        )}
      </div>
      {state.detail && (!compact || detailIsImportant) && <div className="mt-1 break-words leading-5 opacity-80">{state.detail}</div>}
      {setupOpen && identity && repoId && (
        <CommitSigningSetupDialog
          repoId={repoId}
          identity={identity}
          pending={updateSigning.isPending}
          error={updateSigning.error}
          onClose={() => setSetupOpen(false)}
          onSave={(input) => updateSigning.mutate(input)}
        />
      )}
    </>
  );
  if (compact) {
    return <div className="rounded-md border border-neutral-900 bg-black/10 px-2.5 py-2 text-[12px] text-neutral-500">{content}</div>;
  }
  return <div className={`rounded-md border px-3 py-2 text-[12px] ${state.className}`}>{content}</div>;
}

function CommitSigningSetupDialog({
  repoId,
  identity,
  pending,
  error,
  onClose,
  onSave
}: {
  repoId: string;
  identity: RepoIdentity;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (input: Pick<UpdateRepoIdentityInput, "signingMode" | "signingKeyHint">) => void;
}) {
  const initialMode = identity.signingMode === "unknown" ? identity.currentSigningMode : identity.signingMode;
  const [signingMode, setSigningMode] = useState<RepoIdentity["signingMode"]>(
    initialMode === "gpg" || initialMode === "ssh" || initialMode === "unsigned" || initialMode === "pixel" ? initialMode : "ssh"
  );
  const [signingKey, setSigningKey] = useState(identity.signingMode === "pixel" ? "" : (identity.signingKeyHint ?? ""));
  const [pixelDigest, setPixelDigest] = useState(identity.signingMode === "pixel" ? (identity.signingKeyHint ?? "") : "");
  const { data: readiness, isFetching: readinessLoading } = useQuery({
    queryKey: ["repoSigningReadiness", repoId],
    queryFn: () => window.fallback.repos.signingReadiness(repoId),
    staleTime: 10_000
  });
  const verifySigning = useMutation({
    mutationFn: () => window.fallback.repos.verifySigning(repoId)
  });
  const keyRequired = signingMode === "ssh";
  const keyLabel = signingMode === "gpg" ? "GPG key ID or email" : "SSH signing key";
  const keyPlaceholder = signingMode === "gpg" ? "A1234567890ABCDEF or you@example.com" : "~/.ssh/id_ed25519.pub";
  const canSave =
    signingMode === "unsigned" ||
    (signingMode === "pixel" && pixelDigest.trim().length > 0) ||
    (!keyRequired && signingMode !== "pixel") ||
    signingKey.trim().length > 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[86vh] w-[min(92vw,620px)] max-w-none gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border/80 px-5 py-4">
          <DialogTitle className="text-[15px] leading-6">Commit signing</DialogTitle>
          <DialogDescription className="max-w-[480px] text-[13px] leading-5">
            Configure repo-local signing without storing private keys.
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-4 overflow-y-auto px-5 py-4">
          <SigningReadinessSummary readiness={readiness} loading={readinessLoading} verification={verifySigning.data} />
          <label className="grid gap-1.5">
            <span className="text-[12px] font-medium text-muted-foreground">Signing method</span>
            <NativeSelect
              value={signingMode}
              onChange={(event) => setSigningMode(event.currentTarget.value as RepoIdentity["signingMode"])}
              size="sm"
              className="min-w-[220px] border-border/90 bg-background-100 text-[13px] text-foreground shadow-none"
            >
              <NativeSelectOption value="ssh">SSH signature</NativeSelectOption>
              <NativeSelectOption value="gpg">GPG signature</NativeSelectOption>
              <NativeSelectOption value="pixel">Pixel stamp</NativeSelectOption>
              <NativeSelectOption value="unsigned">Do not sign commits</NativeSelectOption>
            </NativeSelect>
          </label>
          {(signingMode === "ssh" || signingMode === "gpg") && (
            <label className="grid gap-1.5">
              <span className="text-[12px] font-medium text-muted-foreground">{keyLabel}</span>
              <Input
                value={signingKey}
                onChange={(event) => setSigningKey(event.currentTarget.value)}
                placeholder={keyPlaceholder}
                className="h-8 border-border/90 bg-background-100 font-mono text-[12px] text-foreground shadow-none placeholder:text-muted-foreground"
              />
            </label>
          )}
          {readiness && readiness.candidates.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[12px] font-medium text-muted-foreground">Existing keys</div>
              <div className="max-h-28 overflow-auto rounded-md border border-border/80 bg-background-100">
                {readiness.candidates.slice(0, 8).map((candidate) => (
                  <button
                    key={`${candidate.mode}:${candidate.source}:${candidate.key}`}
                    type="button"
                    onClick={() => {
                      setSigningMode(candidate.mode);
                      setSigningKey(candidate.key);
                    }}
                    className="grid w-full grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-2 border-b border-border/60 px-3 py-2 text-left text-[12px] text-muted-foreground transition-colors last:border-b-0 hover:bg-accent/60 hover:text-accent-foreground focus-visible:bg-accent/60 focus-visible:outline-none"
                  >
                    <span className="font-mono text-[11px] uppercase text-muted-foreground">{candidate.mode}</span>
                    <span className="truncate font-mono text-foreground">{candidate.hint}</span>
                    <span className="text-[11px]">{candidate.source.replaceAll("_", " ")}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="max-w-full rounded-md border border-border/80 bg-background-100 px-3 py-2 text-[12px] leading-5 text-muted-foreground">
            {signingMode === "ssh"
              ? "SSH signing uses commit.gpgsign=true, gpg.format=ssh, and user.signingkey set to your public key path or key value. Private keys stay with your SSH agent."
              : signingMode === "gpg"
                ? "GPG signing uses commit.gpgsign=true. Leave the key blank to let Git use its default signing key. Fallback checks secret-key and pinentry readiness where Git exposes it."
                : signingMode === "pixel"
                  ? "Pixel stamp adds a SHA-256 trailer to commits. Git commits remain unsigned, so GitHub will not show them as verified."
                  : "Unsigned commits use commit.gpgsign=false and clear repo-local signing key settings."}
          </div>
          {readiness && readiness.checks.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[12px] font-medium text-muted-foreground">Readiness checks</div>
              <div className="overflow-hidden rounded-md border border-border/80 bg-background-100">
                {readiness.checks.map((check) => (
                  <SigningCheckLine key={`${check.summary}:${check.status}`} check={check} />
                ))}
              </div>
            </div>
          )}
          {signingMode === "pixel" && <PixelSignatureStamp initialDigest={pixelDigest} onDigestChange={setPixelDigest} />}
          {Boolean(error) && (
            <Alert variant="destructive" className="border-red-700/30 bg-red-200/35 text-red-900">
              <AlertDescription>{String(errorMessage(error))}</AlertDescription>
            </Alert>
          )}
          {verifySigning.error && (
            <Alert variant="destructive" className="border-red-700/30 bg-red-200/35 text-red-900">
              <AlertDescription>{String(errorMessage(verifySigning.error))}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter className="border-t border-border/80 bg-background-100/60 px-5 py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => verifySigning.mutate()}
            disabled={pending || verifySigning.isPending || !identity.localPath}
            title={
              identity.localPath
                ? "Verify with git commit-tree -S without updating branch history."
                : "Clone the repository before verifying signing."
            }
            className="mr-auto h-8 border-border/90 bg-background text-[13px] shadow-none"
          >
            {verifySigning.isPending ? "Verifying..." : "Verify"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={pending} className="h-8 text-[13px] shadow-none">
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() =>
              onSave({
                signingMode,
                signingKeyHint:
                  signingMode === "unsigned" ? null : signingMode === "pixel" ? pixelDigest.trim() || null : signingKey.trim() || null
              })
            }
            disabled={pending || !canSave}
            className="h-8 text-[13px] font-semibold shadow-none"
          >
            {pending ? "Saving..." : "Save signature"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SigningReadinessSummary({
  readiness,
  loading,
  verification
}: {
  readiness?: RepoSigningReadiness;
  loading: boolean;
  verification?: RepoSigningVerification;
}) {
  if (loading && !readiness) {
    return (
      <div className="rounded-md border border-border/80 bg-background-100 px-3 py-2 text-[12px] text-muted-foreground">
        Checking signing setup...
      </div>
    );
  }
  if (!readiness) return null;
  const statusTone = readiness.satisfiesPolicy
    ? "border-emerald-500/20 bg-emerald-500/[0.08] text-emerald-300"
    : "border-amber-500/20 bg-amber-500/[0.08] text-amber-300";
  return (
    <div className="space-y-3 rounded-md border border-border/80 bg-background-100 px-3 py-3 text-[12px] text-muted-foreground">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[12px] font-medium ${statusTone}`}>
          {readiness.satisfiesPolicy ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
          {readiness.satisfiesPolicy ? "Ready" : "Needs setup"}
        </span>
        <span className="rounded-full border border-border/80 bg-background px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
          {readiness.expectedMode}
        </span>
      </div>
      <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        <SigningMeta label="Repo" value={readiness.repoFullName} mono />
        <SigningMeta label="Branch" value={readiness.branch ?? "unknown"} mono />
        <SigningMeta label="Identity" value={readiness.identityLabel} />
        <SigningMeta label="Key" value={readiness.currentKeyHint ?? readiness.configuredKeyHint ?? "not configured"} mono />
      </div>
      <div className="border-t border-border/70 pt-2 leading-5">{readiness.requirement.detail}</div>
      {verification && (
        <div className="rounded-md border border-border/80 bg-background px-2.5 py-2">
          <span className="font-medium text-foreground">{verification.summary}</span>
          {verification.detail && <span> {verification.detail}</span>}
          {verification.remediation && <div className="mt-1">{verification.remediation}</div>}
        </div>
      )}
    </div>
  );
}

function SigningMeta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] items-baseline gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={`truncate text-foreground ${mono ? "font-mono text-[11px]" : ""}`}>{value}</span>
    </div>
  );
}

function SigningCheckLine({ check }: { check: RepoSigningReadiness["checks"][number] }) {
  const color = check.status === "ok" ? "text-emerald-300" : check.status === "failed" ? "text-red-300" : "text-amber-300";
  const Icon = check.status === "ok" ? CheckCircle2 : check.status === "failed" ? AlertCircle : CircleDot;
  return (
    <div className="border-b border-border/60 px-3 py-2.5 text-[12px] last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-foreground">{check.summary}</div>
          {check.detail && <div className="mt-1 break-words leading-5 text-muted-foreground">{check.detail}</div>}
          {check.remediation && <div className="mt-1 leading-5 text-muted-foreground">{check.remediation}</div>}
          {check.redactedCommand && (
            <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{check.redactedCommand}</div>
          )}
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1 font-mono text-[11px] ${color}`}>
          <Icon className="h-3 w-3" />
          {check.status}
        </span>
      </div>
    </div>
  );
}

function PixelSignatureStamp({
  initialDigest = "",
  onDigestChange
}: {
  initialDigest?: string;
  onDigestChange?: (digest: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);
  const [digest, setDigest] = useState<string | null>(initialDigest || null);
  const [copied, setCopied] = useState(false);

  const resetCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    setDigest(null);
    onDigestChange?.("");
    setCopied(false);
  }, [onDigestChange]);

  const hashCanvas = useCallback(async () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const binary = new Uint8Array(canvas.width * canvas.height + 12);
    binary.set(new TextEncoder().encode("fallback-sig"), 0);
    for (let pixel = 0, output = 12; pixel < pixels.length; pixel += 4, output += 1) {
      binary[output] = pixels[pixel + 3] > 24 ? 1 : 0;
    }
    const bytes = await crypto.subtle.digest("SHA-256", binary);
    const nextDigest = [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    setDigest(nextDigest);
    onDigestChange?.(nextDigest);
    setCopied(false);
  }, [onDigestChange]);

  const canvasPoint = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height
    };
  };

  const drawTo = (canvas: HTMLCanvasElement, point: { x: number; y: number }) => {
    const context = canvas.getContext("2d");
    const previous = lastPointRef.current ?? point;
    if (!context) return;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 4;
    context.strokeStyle = "rgb(245 245 245)";
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    lastPointRef.current = point;
  };

  const copyDigest = async () => {
    if (!digest) return;
    await navigator.clipboard.writeText(`Pixel-Signature-SHA256: ${digest}`);
    setCopied(true);
  };

  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-md border border-border bg-background-100 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground">Pixel signature stamp</div>
          <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">Draw a tiny signature to generate a SHA-256 trailer.</div>
        </div>
        <button
          type="button"
          onClick={resetCanvas}
          disabled={!hasInk && !digest}
          className="h-7 rounded-md border border-border px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
        >
          Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={480}
        height={132}
        className="block h-[132px] w-full max-w-full rounded-md border border-neutral-800 bg-black/50"
        style={{ touchAction: "none" }}
        aria-label="Draw pixel signature"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drawingRef.current = true;
          const point = canvasPoint(event);
          lastPointRef.current = point;
          drawTo(event.currentTarget, point);
          setHasInk(true);
        }}
        onPointerMove={(event) => {
          if (!drawingRef.current) return;
          drawTo(event.currentTarget, canvasPoint(event));
        }}
        onPointerUp={(event) => {
          drawingRef.current = false;
          lastPointRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          void hashCanvas();
        }}
        onPointerCancel={(event) => {
          drawingRef.current = false;
          lastPointRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          void hashCanvas();
        }}
      />
      <div className="mt-2 grid min-h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <div className="min-w-0 overflow-hidden truncate rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
          {digest ? `sha256:${digest}` : "Draw to generate SHA-256"}
        </div>
        <button
          type="button"
          onClick={() => void copyDigest()}
          disabled={!digest}
          className="h-8 rounded-md bg-white px-2.5 text-[12px] font-semibold text-black transition-colors hover:bg-neutral-200 disabled:bg-white/[0.08] disabled:text-neutral-600"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function commitSigningState(identity?: RepoIdentity | null): { label: string; detail: string | null; className: string } {
  if (!identity) {
    return {
      label: "unknown",
      detail: "Fallback is still loading the repository signing state.",
      className: "border-border bg-background-200 text-muted-foreground"
    };
  }
  if (identity.signingMode === "pixel") {
    return {
      label: "pixel",
      detail: identity.signingKeyHint
        ? `Pixel stamp will add Pixel-Signature-SHA256: ${identity.signingKeyHint} to commits.`
        : "Draw a pixel signature to generate a commit trailer. Git will still create an unsigned commit.",
      className: "border-sky-500/20 bg-sky-500/[0.06] text-sky-200"
    };
  }
  const health = identity.signingHealth ?? "unknown";
  const mode = identity.currentSigningMode ?? "unknown";
  if (health === "configured") {
    return {
      label: "signed",
      detail: `${mode.toUpperCase()} signing is configured${identity.currentSigningKeyHint ? ` with ${identity.currentSigningKeyHint}` : ""}.`,
      className: "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-200"
    };
  }
  if (health === "unsigned") {
    return {
      label: "unsigned",
      detail: "Git will create an unsigned commit in this repository.",
      className: "border-neutral-800 bg-black/20 text-neutral-400"
    };
  }
  if (health === "missing_key" || health === "failed") {
    return {
      label: "failed",
      detail: identity.signingHealthMessage ?? "Commit signing is enabled, but Fallback could not confirm the signing configuration.",
      className: "border-red-500/20 bg-red-500/[0.06] text-red-200"
    };
  }
  return {
    label: "unknown",
    detail: identity.signingHealthMessage ?? "Fallback could not determine whether Git will sign this commit.",
    className: "border-amber-500/20 bg-amber-500/[0.06] text-amber-300"
  };
}

function identityAuthorLabel(identity: RepoIdentity): string {
  const name = identity.gitName ?? identity.currentGitName ?? "Unknown";
  const email = identity.gitEmail ?? identity.currentGitEmail ?? "no email";
  return `${name} <${email}>`;
}

function identityAuthorName(identity: RepoIdentity): string {
  return identity.gitName ?? identity.currentGitName ?? identity.gitEmail ?? identity.currentGitEmail ?? "Unknown";
}

type IdentityChipLabelMode = "account" | "author";

export function RepoIdentityControl({
  repoId,
  compact = false,
  labelMode = "account",
  allowApply = true
}: {
  repoId: string;
  compact?: boolean;
  labelMode?: IdentityChipLabelMode;
  allowApply?: boolean;
}) {
  const queryClient = useQueryClient();
  const setView = useNavigationStore((s) => s.setView);
  const [editing, setEditing] = useState(false);
  const [diagnosticsReport, setDiagnosticsReport] = useState<CredentialDiagnosticReport | null>(null);
  const deferRead = compact;
  const [identityReadEnabled, setIdentityReadEnabled] = useState(!deferRead);
  useEffect(() => {
    if (!deferRead) {
      setIdentityReadEnabled(true);
      return;
    }
    setIdentityReadEnabled(false);
  }, [deferRead, repoId]);
  const { data: identity } = useQuery({
    queryKey: ["repoIdentity", repoId],
    queryFn: () => window.fallback.repos.getIdentity(repoId, compact ? "repo-identity-compact" : "repo-identity-control"),
    enabled: identityReadEnabled || editing || Boolean(diagnosticsReport),
    staleTime: 5_000
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: window.fallback.auth.listAccounts,
    enabled: editing,
    staleTime: 60_000
  });
  const updateIdentity = useMutation({
    mutationFn: (input: UpdateRepoIdentityInput) => window.fallback.repos.updateIdentity(repoId, input),
    onSuccess: async () => {
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ["repoIdentity", repoId] });
    }
  });
  const applyIdentity = useMutation({
    mutationFn: () => window.fallback.repos.applyLocalGitIdentity(repoId),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["repoIdentity", repoId] })
  });
  const runDiagnostics = useMutation({
    mutationFn: () => window.fallback.repos.checkCredentials(repoId),
    onSuccess: async (report) => {
      setDiagnosticsReport(report);
      await queryClient.invalidateQueries({ queryKey: ["repoIdentity", repoId] });
    }
  });
  const busy = updateIdentity.isPending || applyIdentity.isPending || runDiagnostics.isPending;

  return (
    <>
      {diagnosticsReport && <CredentialDiagnosticsDialog report={diagnosticsReport} onClose={() => setDiagnosticsReport(null)} />}
      {editing && identity && (
        <RepoIdentityEditorDialog
          identity={identity}
          accounts={accounts}
          pending={updateIdentity.isPending}
          error={updateIdentity.error}
          onClose={() => setEditing(false)}
          onSave={(input) => updateIdentity.mutate(input)}
        />
      )}
      <IdentityChip
        identity={identity}
        compact={compact}
        labelMode={labelMode}
        busy={busy}
        allowApply={allowApply}
        onIntent={() => setIdentityReadEnabled(true)}
        onEdit={() => setEditing(true)}
        onApply={() => applyIdentity.mutate()}
        onDiagnose={() => runDiagnostics.mutate()}
        onOpenSettings={() => setView("Settings")}
      />
    </>
  );
}

export function IdentityRiskNotice({ repoId, action, className = "" }: { repoId: string; action: IdentityRiskAction; className?: string }) {
  const { data: identity } = useQuery({
    queryKey: ["repoIdentity", repoId],
    queryFn: () => window.fallback.repos.getIdentity(repoId, "identity-risk-notice")
  });
  const risk = identityRisk(identity, action);
  return <IdentityRiskWarning risk={risk} className={className} />;
}

function RepoIdentityEditorDialog({
  identity,
  accounts,
  pending,
  error,
  onClose,
  onSave
}: {
  identity: RepoIdentity;
  accounts: GitHubAccountSession[];
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (input: UpdateRepoIdentityInput) => void;
}) {
  const [accountId, setAccountId] = useState(identity.accountId ?? "");
  const [gitName, setGitName] = useState(identity.gitName ?? identity.currentGitName ?? "");
  const [gitEmail, setGitEmail] = useState(identity.gitEmail ?? identity.currentGitEmail ?? "");
  const [signingMode, setSigningMode] = useState<RepoIdentity["signingMode"]>(identity.signingMode);
  const [signingKeyHint, setSigningKeyHint] = useState(identity.signingKeyHint ?? "");
  const [remoteProtocol, setRemoteProtocol] = useState<RepoIdentity["remoteProtocol"]>(identity.remoteProtocol);
  const selectedAccount = accounts.find((account) => account.id === accountId) ?? null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl gap-0 p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>Repository identity</DialogTitle>
          <DialogDescription>Applies to this watched repository only.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-5 py-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">GitHub account</span>
            <NativeSelect
              value={accountId}
              onChange={(event) => setAccountId(event.currentTarget.value)}
              className="w-full text-[13px] text-foreground"
            >
              <NativeSelectOption value="">No bound account</NativeSelectOption>
              {accounts.map((account) => (
                <NativeSelectOption key={account.id} value={account.id}>
                  @{account.login ?? "unknown"} on {endpointLabel(account.endpoint)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Commit author name</span>
              <Input value={gitName} onChange={(event) => setGitName(event.currentTarget.value)} className="text-[13px] text-foreground" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Commit author email</span>
              <Input
                value={gitEmail}
                onChange={(event) => setGitEmail(event.currentTarget.value)}
                className="text-[13px] text-foreground"
              />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Signing mode</span>
              <NativeSelect
                value={signingMode}
                onChange={(event) => setSigningMode(event.currentTarget.value as RepoIdentity["signingMode"])}
                className="w-full text-[13px] text-foreground"
              >
                <NativeSelectOption value="unknown">Unknown</NativeSelectOption>
                <NativeSelectOption value="unsigned">Unsigned</NativeSelectOption>
                <NativeSelectOption value="gpg">GPG</NativeSelectOption>
                <NativeSelectOption value="ssh">SSH</NativeSelectOption>
                <NativeSelectOption value="pixel">Pixel stamp</NativeSelectOption>
              </NativeSelect>
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Remote protocol</span>
              <NativeSelect
                value={remoteProtocol}
                onChange={(event) => setRemoteProtocol(event.currentTarget.value as RepoIdentity["remoteProtocol"])}
                className="w-full text-[13px] text-foreground"
              >
                <NativeSelectOption value="unknown">Unknown</NativeSelectOption>
                <NativeSelectOption value="https">HTTPS</NativeSelectOption>
                <NativeSelectOption value="ssh">SSH</NativeSelectOption>
                <NativeSelectOption value="file">File</NativeSelectOption>
              </NativeSelect>
            </label>
          </div>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {signingMode === "pixel" ? "Pixel signature SHA" : "Signing key hint"}
            </span>
            <Input
              value={signingKeyHint}
              onChange={(event) => setSigningKeyHint(event.currentTarget.value)}
              placeholder={signingMode === "pixel" ? "SHA-256 from pixel stamp" : "Optional key id or fingerprint"}
              className="text-[13px] text-foreground placeholder:text-muted-foreground"
            />
          </label>
          <div className="rounded-md border border-border bg-background-200 px-3 py-2 text-xs text-muted-foreground">
            {selectedAccount
              ? `Bound to @${selectedAccount.login ?? "unknown"} on ${endpointLabel(selectedAccount.endpoint)}.`
              : "No account is bound to this repository."}
            {identity.localPath
              ? " Saving writes repo-local user.name and user.email."
              : " This repository is metadata-only, so local Git config will not be changed."}
          </div>
          {Boolean(error) && (
            <Alert variant="destructive" className="border-red-700/30 bg-red-200/35 text-red-900">
              <AlertDescription>{String(errorMessage(error))}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter className="border-t border-border px-5 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={pending}
            className="text-[13px] text-foreground hover:bg-accent"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() =>
              onSave({
                accountId: accountId || null,
                gitName: gitName.trim() || null,
                gitEmail: gitEmail.trim() || null,
                signingMode,
                signingKeyHint: signingKeyHint.trim() || null,
                remoteProtocol
              })
            }
            disabled={pending}
            className="text-[13px] font-semibold"
          >
            {pending ? "Saving..." : "Save identity"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IdentityDetail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-gray-600">{label}</span>
      <span className="min-w-0 truncate text-right font-mono text-gray-900">{value || "unknown"}</span>
    </div>
  );
}
