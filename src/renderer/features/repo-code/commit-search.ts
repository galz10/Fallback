import type { CommitSearchInput, CommitSearchResult } from "../../../shared/domain/repo-code";

export async function searchCommitsWithCancellation(
  repoId: string,
  input: CommitSearchInput,
  signal?: AbortSignal
): Promise<CommitSearchResult> {
  const requestId = `commit-search:${repoId}:${commitSearchRequestKey(input)}`;
  const abort = () => {
    void window.fallback.repos.cancelCommitSearch(requestId).catch(() => undefined);
  };
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    return await window.fallback.repos.searchCommits(repoId, { ...input, requestId });
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

function commitSearchRequestKey(input: CommitSearchInput): string {
  return JSON.stringify({
    message: input.message ?? "",
    author: input.author ?? "",
    sha: input.sha ?? "",
    after: input.after ?? "",
    before: input.before ?? "",
    ref: input.ref ?? "",
    path: input.path ?? "",
    limit: input.limit ?? 0,
    timeoutMs: input.timeoutMs ?? 0
  });
}
