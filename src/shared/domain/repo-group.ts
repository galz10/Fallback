export interface RepoGroupBadge {
  id: string;
  name: string;
}

export interface RepoGroup {
  id: string;
  name: string;
  repoIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UpdateRepoGroupsInput {
  name?: string;
}
