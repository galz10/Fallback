export interface CacheSummary {
  workspacePath: string;
  databasePath: string;
  totalBytes: number;
  databaseBytes: number;
  watchedRepos: number;
  pullRequests: number;
  issues: number;
  comments: number;
  reviews: number;
  checkRuns: number;
  commitStatuses: number;
  searchRows: number;
  repos: Array<{ repoId: string; repoFullName: string; estimatedBytes: number; localBytes: number; rows: number }>;
}

export interface DiagnosticsExport {
  path: string;
  createdAt: string;
  redacted: boolean;
}
