import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type Bump = "major" | "minor" | "patch";
type PublishMode = "draft" | "published";

interface Options {
  bump: Bump | null;
  repo: string | null;
  workflow: string;
  targetRef: string | null;
  publishMode: PublishMode;
  allowDirty: boolean;
  yes: boolean;
  dryRun: boolean;
  wait: boolean;
}

interface ReleaseRecord {
  tagName: string;
  isDraft: boolean;
  isPrerelease: boolean;
  publishedAt: string | null;
}

const defaultWorkflow = "release.yml";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await requireCommand("gh");
  await requireCommand("git");
  await ensureGitHubAuth();
  if (!options.allowDirty) await ensureCleanTree();

  const repo = options.repo ?? (await gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"])).trim();
  if (!repo.includes("/")) throw new Error(`Could not resolve GitHub repository owner/name from gh: ${repo}`);
  const workflow = options.workflow;
  await ensureWorkflowExists(repo, workflow);

  const targetRef = options.targetRef ?? (await git(["rev-parse", "HEAD"])).trim();
  const targetBranch = await currentBranch();
  const latest = await latestStableRelease(repo);
  const previousVersion = latest ? parseSemver(latest.tagName) : { major: 0, minor: 0, patch: 0 };
  const bump = options.bump ?? (await promptBump());
  const nextVersion = formatVersion(bumpVersion(previousVersion, bump));
  const tag = `v${nextVersion}`;

  await ensureRemoteTagAvailable(tag);

  printSummary({
    repo,
    workflow,
    latestTag: latest?.tagName ?? "none",
    nextVersion,
    bump,
    targetRef,
    targetBranch,
    publishMode: options.publishMode,
    dryRun: options.dryRun
  });

  if (!options.yes) {
    const confirmed = await promptConfirm("Trigger this release workflow?");
    if (!confirmed) {
      console.log("Release canceled.");
      return;
    }
  }

  const workflowArgs = [
    "workflow",
    "run",
    workflow,
    "--repo",
    repo,
    "--ref",
    targetBranch || targetRef,
    "--field",
    `version=${nextVersion}`,
    "--field",
    `publish_mode=${options.publishMode}`,
    "--field",
    `target_ref=${targetRef}`,
    "--field",
    "skip_tests=false"
  ];

  if (options.dryRun) {
    console.log(`Dry run command:\n  gh ${workflowArgs.map(shellQuote).join(" ")}`);
    return;
  }

  await gh(workflowArgs);
  console.log("Release workflow dispatched.");
  console.log(`Workflow page: https://github.com/${repo}/actions/workflows/${workflow}`);

  if (options.wait) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const runId = await latestRunId(repo, workflow, targetRef);
    if (runId) {
      console.log(`Watching run ${runId}...`);
      await inherit("gh", ["run", "watch", runId, "--repo", repo]);
    } else {
      console.log("Could not resolve the new run id yet. Open the workflow page above to watch it.");
    }
  }
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    bump: null,
    repo: null,
    workflow: defaultWorkflow,
    targetRef: null,
    publishMode: "draft",
    allowDirty: false,
    yes: false,
    dryRun: false,
    wait: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    const next = () => {
      const value = args[index + 1];
      if (!value) throw new Error(`Missing value for ${arg}`);
      index += 1;
      return value;
    };

    if (arg === "--bump") options.bump = assertBump(next());
    else if (arg === "--repo") options.repo = next();
    else if (arg === "--workflow") options.workflow = next();
    else if (arg === "--target-ref") options.targetRef = next();
    else if (arg === "--publish") options.publishMode = "published";
    else if (arg === "--draft") options.publishMode = "draft";
    else if (arg === "--allow-dirty") options.allowDirty = true;
    else if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--wait") options.wait = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`Trigger a signed Fallback release workflow.

Usage:
  pnpm release [options]

Options:
  --bump major|minor|patch   Version bump. Prompts when omitted.
  --repo owner/name          GitHub repository. Defaults to gh repo context.
  --workflow <file>          Workflow file. Default: release.yml
  --target-ref <ref>         Commit SHA/ref to release. Default: HEAD SHA.
  --publish                  Publish immediately instead of draft.
  --draft                    Create draft release. Default.
  --allow-dirty              Allow local uncommitted changes.
  --yes, -y                  Skip confirmation prompt.
  --dry-run                  Print the gh workflow command without running it.
  --wait                     Watch the created workflow run when it can be resolved.
  --help, -h                 Show this help.
`);
}

async function requireCommand(command: string): Promise<void> {
  try {
    await execFileAsync(command, ["--version"]);
  } catch {
    throw new Error(`Required command not found or not runnable: ${command}`);
  }
}

async function ensureGitHubAuth(): Promise<void> {
  try {
    await gh(["auth", "status"]);
  } catch {
    throw new Error("GitHub CLI is not authenticated. Run `gh auth login` first.");
  }
}

async function ensureCleanTree(): Promise<void> {
  const status = await git(["status", "--porcelain"]);
  if (status.trim()) {
    throw new Error("Working tree has local changes. Commit/stash them or pass --allow-dirty.");
  }
}

async function ensureWorkflowExists(repo: string, workflow: string): Promise<void> {
  try {
    await gh(["workflow", "view", workflow, "--repo", repo]);
  } catch {
    throw new Error(`Could not find workflow ${workflow} in ${repo}.`);
  }
}

async function latestStableRelease(repo: string): Promise<ReleaseRecord | null> {
  const raw = await gh(["release", "list", "--repo", repo, "--limit", "100", "--json", "tagName,isDraft,isPrerelease,publishedAt"]);
  const releases = JSON.parse(raw) as ReleaseRecord[];
  return releases.find((release) => !release.isDraft && !release.isPrerelease && parseSemverOrNull(release.tagName)) ?? null;
}

async function ensureRemoteTagAvailable(tag: string): Promise<void> {
  const localTag = await git(["tag", "--list", tag]);
  if (localTag.trim()) throw new Error(`Local tag already exists: ${tag}`);
  try {
    await git(["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`]);
    throw new Error(`Remote tag already exists: ${tag}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Remote tag already exists")) throw error;
  }
}

async function currentBranch(): Promise<string> {
  return (await git(["branch", "--show-current"])).trim();
}

async function promptBump(): Promise<Bump> {
  const rl = createInterface({ input, output });
  try {
    for (;;) {
      const answer = (await rl.question("Bump type? major / minor / patch: ")).trim().toLowerCase();
      if (answer === "major" || answer === "minor" || answer === "patch") return answer;
      console.log("Please enter major, minor, or patch.");
    }
  } finally {
    rl.close();
  }
}

async function promptConfirm(question: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`${question} Type yes to continue: `)).trim().toLowerCase();
    return answer === "yes" || answer === "y";
  } finally {
    rl.close();
  }
}

function printSummary(input: {
  repo: string;
  workflow: string;
  latestTag: string;
  nextVersion: string;
  bump: Bump;
  targetRef: string;
  targetBranch: string;
  publishMode: PublishMode;
  dryRun: boolean;
}): void {
  console.log("");
  console.log("Release summary");
  console.log(`  Repo:          ${input.repo}`);
  console.log(`  Workflow:      ${input.workflow}`);
  console.log(`  Latest stable: ${input.latestTag}`);
  console.log(`  Next version:  v${input.nextVersion}`);
  console.log(`  Bump:          ${input.bump}`);
  console.log(`  Target ref:    ${input.targetRef}`);
  console.log(`  Workflow ref:  ${input.targetBranch || input.targetRef}`);
  console.log(`  Mode:          ${input.publishMode}`);
  console.log(`  Dry run:       ${input.dryRun ? "yes" : "no"}`);
  console.log("");
  console.log("Updater asset contract");
  console.log("  macOS:   signed DMG, ZIP payload, latest-mac.yml, blockmaps");
  console.log("  Windows: signed NSIS EXE, latest.yml, blockmaps");
  console.log("  Linux:   AppImage, deb, checksums");
  console.log("");
}

function parseSemver(tag: string): { major: number; minor: number; patch: number } {
  const parsed = parseSemverOrNull(tag);
  if (!parsed) throw new Error(`Release tag is not semver: ${tag}`);
  return parsed;
}

function parseSemverOrNull(tag: string): { major: number; minor: number; patch: number } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function bumpVersion(
  version: { major: number; minor: number; patch: number },
  bump: Bump
): { major: number; minor: number; patch: number } {
  if (bump === "major") return { major: version.major + 1, minor: 0, patch: 0 };
  if (bump === "minor") return { major: version.major, minor: version.minor + 1, patch: 0 };
  return { major: version.major, minor: version.minor, patch: version.patch + 1 };
}

function formatVersion(version: { major: number; minor: number; patch: number }): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function assertBump(value: string): Bump {
  if (value === "major" || value === "minor" || value === "patch") return value;
  throw new Error(`Invalid bump type: ${value}`);
}

async function latestRunId(repo: string, workflow: string, targetSha: string): Promise<string | null> {
  const raw = await gh(["run", "list", "--repo", repo, "--workflow", workflow, "--limit", "10", "--json", "databaseId,headSha"]);
  const runs = JSON.parse(raw) as Array<{ databaseId: number; headSha: string }>;
  const matching = runs.find((run) => run.headSha === targetSha) ?? runs[0];
  return matching ? String(matching.databaseId) : null;
}

async function gh(args: string[]): Promise<string> {
  return capture("gh", args);
}

async function git(args: string[]): Promise<string> {
  return capture("git", args);
}

async function capture(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args, { maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

function inherit(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:=@-]+$/.test(value) ? value : JSON.stringify(value);
}

main().catch((error) => {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
