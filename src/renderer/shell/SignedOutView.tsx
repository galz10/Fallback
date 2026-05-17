import { useMutation, useQueryClient } from "@tanstack/react-query";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { GitHubOAuthDeviceFlow } from "../../shared/domain/auth";
import { ShellIcon } from "../components/ShellIcon";
import { WindowLogoControls } from "./WindowLogoControls";

export function SignedOutView() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [oauthFlow, setOauthFlow] = useState<GitHubOAuthDeviceFlow | null>(null);
  const [oauthChecking, setOauthChecking] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const completionInFlightRef = useRef(false);
  const refreshSignedInData = useCallback(async () => {
    const nextAuth = await window.fallback.auth.getAuthState();
    queryClient.setQueryData(["auth"], nextAuth);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["accounts"] }),
      queryClient.invalidateQueries({ queryKey: ["availableRepos"] }),
      queryClient.invalidateQueries({ queryKey: ["repos"] }),
      queryClient.invalidateQueries({ queryKey: ["myPrs"] }),
      queryClient.invalidateQueries({ queryKey: ["myIssues"] })
    ]);
  }, [queryClient]);
  const startOAuth = useMutation({
    mutationFn: window.fallback.auth.startGitHubOAuth,
    onSuccess: (flow) => {
      setOauthFlow(flow);
      setCodeCopied(false);
      setMessage("Enter this code in GitHub. Fallback will finish sign-in automatically.");
    },
    onError: (signInError) => setMessage(errorMessage(signInError))
  });
  const completeDeviceSignIn = useCallback(
    async (deviceCode: string) => {
      if (completionInFlightRef.current) return;
      completionInFlightRef.current = true;
      setOauthChecking(true);
      try {
        const result = await window.fallback.auth.completeGitHubOAuth(deviceCode);
        if (result.status !== "success") {
          setMessage(
            result.status === "slow_down" ? "GitHub asked Fallback to slow down. Waiting..." : "Waiting for GitHub authorization..."
          );
          return;
        }
        setOauthFlow(null);
        setMessage("GitHub connected.");
        await refreshSignedInData();
      } catch (signInError) {
        const copy = errorMessage(signInError);
        if (isDeviceFlowWaiting(copy)) {
          setMessage("Waiting for GitHub authorization...");
        } else {
          if (copy.includes("expired")) setOauthFlow(null);
          setMessage(copy);
        }
      } finally {
        setOauthChecking(false);
        completionInFlightRef.current = false;
      }
    },
    [refreshSignedInData]
  );
  const copyUserCode = useCallback(async () => {
    if (!oauthFlow) return;
    await navigator.clipboard?.writeText(oauthFlow.userCode);
    setCodeCopied(true);
    window.setTimeout(() => setCodeCopied(false), 1800);
  }, [oauthFlow]);

  useEffect(() => {
    if (!oauthFlow) return;
    let cancelled = false;
    let timer: number | undefined;
    const intervalMs = Math.max(5_000, oauthFlow.intervalSeconds * 1000);
    const poll = async () => {
      if (cancelled) return;
      await completeDeviceSignIn(oauthFlow.deviceCode);
      if (!cancelled) timer = window.setTimeout(poll, intervalMs);
    };
    timer = window.setTimeout(poll, intervalMs);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [completeDeviceSignIn, oauthFlow]);

  useEffect(() => {
    return window.fallback.auth.onBrowserOAuthResult((result) => {
      if (result.status !== "success") return;
      setOauthFlow(null);
      setCodeCopied(false);
      setMessage("GitHub connected.");
      void refreshSignedInData();
    });
  }, [refreshSignedInData]);

  useEffect(() => {
    if (!oauthFlow) return;
    const timeoutMs = Math.max(0, new Date(oauthFlow.expiresAt).getTime() - Date.now());
    const timer = window.setTimeout(() => {
      setOauthFlow(null);
      setMessage("GitHub device sign-in timed out. Try again.");
    }, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [oauthFlow]);

  return (
    <div className="app-shell flex h-screen flex-col overflow-hidden bg-black font-sans text-foreground">
      <SignInSignal />
      <div className="app-drag-region flex h-14 shrink-0 items-center px-4">
        <WindowLogoControls />
      </div>
      <main className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-6 pb-24">
        <section className="flex w-full max-w-[520px] flex-col items-center text-center">
          <div className="space-y-1">
            <h1 className="text-[15px] font-medium text-neutral-200">Welcome to Fallback</h1>
            <p className="text-[13px] text-neutral-500">Sign in to keep your GitHub context local and ready.</p>
          </div>
          <button
            type="button"
            onClick={() => (oauthFlow ? void completeDeviceSignIn(oauthFlow.deviceCode) : startOAuth.mutate())}
            disabled={startOAuth.isPending || oauthChecking}
            className="app-no-drag mt-5 inline-flex h-9 items-center justify-center gap-2 rounded-md px-2 text-[13px] font-medium text-neutral-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600 focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-wait disabled:opacity-60"
          >
            <span>
              {startOAuth.isPending ? "Opening GitHub..." : oauthChecking ? "Checking..." : oauthFlow ? "Waiting for GitHub" : "Sign in"}
            </span>
            <ShellIcon name="repo" className="h-4 w-4" />
          </button>
          {oauthFlow && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-neutral-100">
              <span className="font-mono text-sm font-semibold tracking-[0.18em]">{oauthFlow.userCode}</span>
              <button
                type="button"
                onClick={() => void copyUserCode()}
                className="app-no-drag inline-grid h-6 w-6 place-items-center rounded text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600"
                aria-label={codeCopied ? "Code copied" : "Copy code"}
                title={codeCopied ? "Copied" : "Copy code"}
              >
                <ShellIcon name={codeCopied ? "check" : "copy"} className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {message && <p className="mt-3 min-h-5 text-[13px] text-neutral-500">{message}</p>}
        </section>
      </main>
    </div>
  );
}

const SIGNAL_DOTS = Array.from({ length: 132 }, (_, index) => {
  const split = index % 4 === 0;
  const direction = index % 2 === 0 ? -1 : 1;
  const startX = 3 + ((index * 37) % 94);
  return {
    id: index,
    startX,
    splitDirection: direction,
    split,
    size: split ? 4.2 : 3,
    duration: 8.5 + (index % 9) * 0.45,
    delay: -((index % 41) * 0.29),
    opacity: split ? 0.68 : 0.42
  };
});

function SignInSignal() {
  return (
    <div className="pointer-events-none absolute inset-0 select-none overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(56,189,248,0.03),transparent_34%,rgba(0,0,0,0.68))]" />
      <div className="absolute inset-0 motion-reduce:hidden">
        {SIGNAL_DOTS.map((dot) => (
          <React.Fragment key={dot.id}>
            <span
              className="absolute top-[-8%] rounded-full bg-sky-200 shadow-[0_0_10px_rgba(125,211,252,0.36)]"
              style={{
                left: `${dot.startX}%`,
                width: dot.size,
                height: dot.size,
                opacity: dot.opacity,
                animation: `signal-drop-${dot.id % 6} ${dot.duration}s linear ${dot.delay}s infinite`
              }}
            />
            {dot.split && (
              <>
                <span
                  className="absolute top-[-8%] rounded-full bg-sky-200 shadow-[0_0_8px_rgba(186,230,253,0.22)]"
                  style={{
                    left: `${dot.startX}%`,
                    width: 2.6,
                    height: 2.6,
                    opacity: dot.opacity * 0.8,
                    animation: `signal-split-${dot.splitDirection > 0 ? "right" : "left"} ${dot.duration}s linear ${dot.delay}s infinite`
                  }}
                />
                <span
                  className="absolute top-[-8%] rounded-full bg-cyan-200 shadow-[0_0_8px_rgba(165,243,252,0.18)]"
                  style={{
                    left: `${dot.startX}%`,
                    width: 2.2,
                    height: 2.2,
                    opacity: dot.opacity * 0.55,
                    animation: `signal-split-${dot.splitDirection > 0 ? "left" : "right"} ${dot.duration * 1.08}s linear ${
                      dot.delay - 0.14
                    }s infinite`
                  }}
                />
              </>
            )}
          </React.Fragment>
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-b from-transparent via-black/45 to-black" />
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDeviceFlowWaiting(message: string): boolean {
  return message.includes("authorization is still pending") || message.includes("slow down");
}
