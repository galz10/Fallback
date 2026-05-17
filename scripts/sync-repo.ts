import { createAppServices } from "../electron/main/app-services.js";

const fullName = process.argv[2];

if (!fullName) {
  console.error("Usage: GITHUB_TOKEN=... pnpm sync:repo owner/repo");
  process.exit(1);
}

if (!process.env.GITHUB_TOKEN) {
  console.error("GITHUB_TOKEN is required for GitHub API sync.");
  process.exit(1);
}

const services = createAppServices();

try {
  const repo = await services.sync.watchRepo(fullName);
  if (!repo) {
    throw new Error("Failed to watch repo.");
  }
  const job = await services.sync.syncRepo(repo.id);
  console.log(JSON.stringify({ repo: services.database.localCache.repos.getRepo(repo.id), job }, null, 2));
} finally {
  services.database.close();
}
