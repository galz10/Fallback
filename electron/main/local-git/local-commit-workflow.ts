import type { CommitTemplate, LocalCommitInput, LocalCommitResult } from "../../../src/shared/domain/local-git.js";
import { conventionalCommitTemplate, fallbackTemplatesForRepo } from "../../../src/shared/commit-templates.js";
import { gitRaw, gitText } from "../git-command.js";
import { LocalGitWorkflowBase, type LocalGitWorkflowDependencies } from "./workflow-base.js";
import { gitCommitTemplate, pixelSignatureTrailer } from "./git-workflow-helpers.js";
import type { GitCommandOptions } from "./git-workflow-helpers.js";

export class LocalCommitWorkflow extends LocalGitWorkflowBase {
  constructor(deps: LocalGitWorkflowDependencies) {
    super(deps);
  }

  async commitTemplates(repoId: string): Promise<CommitTemplate[]> {
    const repo = this.database.localCache.repos.getRepo(repoId);
    if (!repo) throw new Error("Repository is not watched.");
    const templates: CommitTemplate[] = [conventionalCommitTemplate];
    if (this.settings) templates.push(...fallbackTemplatesForRepo(this.settings.get(), repoId));
    const gitTemplate = repo.localPath ? await gitCommitTemplate(repo.localPath).catch(() => null) : null;
    if (gitTemplate) templates.unshift(gitTemplate);
    return templates;
  }

  async commit(repoId: string, input: LocalCommitInput, options: GitCommandOptions = {}): Promise<LocalCommitResult> {
    const repo = this.requireLocalRepo(repoId);
    const summary = input.summary.trim();
    if (!summary) throw new Error("Commit summary is required.");

    const hasStagedChanges = (await gitText(repo.localPath!, ["diff", "--cached", "--name-only"], 30_000, options.signal)).length > 0;
    if (!hasStagedChanges) throw new Error("Stage at least one file before committing.");

    const args = ["commit", "-m", summary];
    const description = input.description?.trim();
    if (description) args.push("-m", description);
    const identity = this.database.localCache.repoIdentities.getRepoIdentity(repoId);
    const pixelSignature = pixelSignatureTrailer(identity?.signingMode, identity?.signingKeyHint);
    if (pixelSignature) args.push("-m", pixelSignature);
    await gitRaw(repo.localPath!, args, 120_000, [0], options.signal);
    const sha = await gitText(repo.localPath!, ["rev-parse", "--short", "HEAD"], 30_000, options.signal);
    this.invalidateLocalChangesCache(repoId);
    return { sha, message: summary };
  }
}
