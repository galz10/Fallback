import path from "node:path";
import { DatabaseService } from "../../electron/main/database-service.js";
import { withTempDir } from "./temp.js";

export async function withTempDatabase<T>(
  prefix: string,
  run: (input: { tempDir: string; databasePath: string; database: DatabaseService }) => Promise<T>
): Promise<T> {
  return withTempDir(prefix, async (tempDir) => {
    const databasePath = path.join(tempDir, "fallback.sqlite");
    const database = new DatabaseService(databasePath);
    try {
      return await run({ tempDir, databasePath, database });
    } finally {
      database.close();
    }
  });
}
