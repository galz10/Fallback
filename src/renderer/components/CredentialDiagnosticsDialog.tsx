import type { CredentialDiagnosticReport } from "../../shared/domain/repo-identity";
import { SignalBadge } from "./SignalBadge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { ScrollArea } from "./ui/scroll-area";

export function CredentialDiagnosticsDialog({ report, onClose }: { report: CredentialDiagnosticReport; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[80vh] max-w-2xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-neutral-800 px-5 py-4">
          <DialogTitle>Credential diagnostics</DialogTitle>
          <DialogDescription>
            {report.repoFullName} | {report.overallStatus}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[calc(80vh-82px)]">
          <div className="divide-y divide-neutral-900">
            {report.results.map((result) => (
              <div key={result.surface} className="px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-neutral-200">{diagnosticSurfaceLabel(result.surface)}</div>
                  <SignalBadge tone={diagnosticTone(result.status)}>{result.status}</SignalBadge>
                </div>
                <div className="mt-2 text-sm text-neutral-400">{result.summary}</div>
                {result.detail && <div className="mt-1 text-xs text-neutral-500">{result.detail}</div>}
                {result.remediation && <div className="mt-2 text-xs text-amber-300">{result.remediation}</div>}
                {result.redactedCommand && <div className="mt-2 font-mono text-[11px] text-neutral-600">{result.redactedCommand}</div>}
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export function diagnosticTone(status: CredentialDiagnosticReport["results"][number]["status"]): "good" | "bad" | "warn" | "neutral" {
  if (status === "ok") return "good";
  if (status === "failed") return "bad";
  if (status === "warning") return "warn";
  return "neutral";
}

function diagnosticSurfaceLabel(surface: CredentialDiagnosticReport["results"][number]["surface"]): string {
  return surface
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
