import React from "react";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import { workerHighlighterOptions, workerPoolOptions } from "./options";
import { workerFactory } from "./workerFactory";

type DiffsCodeShellProps = React.HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode;
};

export function DiffsCodeShell({ children, className = "", ...props }: DiffsCodeShellProps) {
  return (
    <div {...props} className={`border border-neutral-800 rounded-[5px] bg-black overflow-hidden diffs-shell ${className}`}>
      <WorkerPoolContextProvider poolOptions={{ ...workerPoolOptions, workerFactory }} highlighterOptions={workerHighlighterOptions}>
        <React.Suspense fallback={<div className="p-8 text-center text-neutral-500 text-sm">Loading renderer...</div>}>
          {children}
        </React.Suspense>
      </WorkerPoolContextProvider>
    </div>
  );
}

export class PatchRenderBoundary extends React.Component<{ children: React.ReactNode; patch: string }, { error: Error | null }> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prevProps: { patch: string }) {
    if (prevProps.patch !== this.props.patch && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <pre className="max-h-[520px] overflow-auto p-4 text-xs leading-5 text-neutral-300 whitespace-pre-wrap font-mono">
          {this.props.patch}
        </pre>
      );
    }

    return this.props.children;
  }
}
