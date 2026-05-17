import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const scheduler = await readFile("electron/main/workers/sync-scheduler.ts", "utf8");
const watchedRepoHandlers = await readFile("electron/main/ipc/watched-repos.handlers.ts", "utf8");

assert.match(scheduler, /setInterval\(\(\) => \{\s*void this\.refreshDueRepos\(\);\s*\}, this\.intervalMs\)/);
assert.doesNotMatch(scheduler, /refreshDueRepos\("startup_repo_sync"\)/);
assert.match(watchedRepoHandlers, /reposRefresh[\s\S]*manual_repo_sync[\s\S]*bypassCooldown: true/);

console.log("Sync scheduler startup tests ok");
