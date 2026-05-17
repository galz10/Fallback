import { nowIso } from "../path-utils.js";
import { LocalCacheStoreBase } from "./store-base.js";

export class AppMetadataStore extends LocalCacheStoreBase {
  schemaVersion(): string {
    const row = this.db.prepare("SELECT value FROM app_metadata WHERE key = 'schema_version'").get() as { value: string } | undefined;
    return row?.value ?? "unknown";
  }

  getAppMetadata(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM app_metadata WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setAppMetadata(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO app_metadata (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value, nowIso());
  }
}
