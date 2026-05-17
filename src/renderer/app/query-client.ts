import { QueryClient } from "@tanstack/react-query";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRateLimitError(error: unknown): boolean {
  return /rate limit/i.test(errorMessage(error));
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => failureCount < 1 && !isRateLimitError(error),
      refetchOnWindowFocus: false,
      staleTime: 2_000
    }
  }
});
