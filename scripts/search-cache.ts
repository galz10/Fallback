import { createAppServices } from "../electron/main/app-services.js";

const query = process.argv.slice(2).join(" ");

if (!query) {
  console.error('Usage: pnpm search "query"');
  process.exit(1);
}

const services = createAppServices();

try {
  const results = services.database.localCache.searchIndex.search(query);
  console.log(JSON.stringify(results, null, 2));
} finally {
  services.database.close();
}
