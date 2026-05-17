import type { AttentionListInput, NotificationEventRecord } from "../../../src/shared/attention.js";
import { nowIso } from "../path-utils.js";
import { LocalCacheStoreBase } from "./store-base.js";
import { mapNotificationEvent } from "./store-helpers.js";

export class NotificationStore extends LocalCacheStoreBase {
  listNotificationEvents(input: AttentionListInput = {}): NotificationEventRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    const accountId = this.getGitHubAccount()?.id ?? null;
    if (accountId && !this.useLegacyUnscopedRepoVisibility(accountId)) {
      clauses.push(
        "EXISTS (SELECT 1 FROM repo_accounts ra WHERE ra.repo_id = notification_events.repo_id AND ra.account_id = ? AND ra.watch_enabled = 1)"
      );
      params.push(accountId);
    }
    if (input.repoId) {
      clauses.push("repo_id = ?");
      params.push(input.repoId);
    }
    if (input.filter === "bots") clauses.push("actor_is_bot = 1");
    if (input.filter === "human") clauses.push("actor_is_bot = 0");
    if (input.filter === "reviews") clauses.push("event_kind IN ('review', 'review_request')");
    if (input.filter === "checks") clauses.push("event_kind IN ('check_failed', 'check_passed', 'workflow_failed', 'workflow_passed')");
    const limit = Math.min(Math.max(Math.floor(input.limit ?? 100), 1), 500);
    const rows = this.db
      .prepare(
        `SELECT *
         FROM notification_events
         ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
         ORDER BY COALESCE(github_updated_at, github_created_at, last_seen_at) DESC
         LIMIT ?`
      )
      .all(...params, limit) as Record<string, unknown>[];
    return rows.map(mapNotificationEvent);
  }

  upsertNotificationEvent(event: NotificationEventRecord): NotificationEventRecord {
    const timestamp = nowIso();
    const id = event.id ?? `event:${event.eventKey}`;
    const current = this.db.prepare("SELECT first_seen_at FROM notification_events WHERE event_key = ?").get(event.eventKey) as
      | Record<string, unknown>
      | undefined;
    this.db
      .prepare(
        `INSERT INTO notification_events (
          id, event_key, entity_type, repo_id, entity_number, event_kind, actor_login, actor_is_bot,
          title, body_preview, html_url, github_created_at, github_updated_at, first_seen_at, last_seen_at,
          importance, promotes_to_my_work, collapse_key, payload_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_key) DO UPDATE SET
          event_kind = excluded.event_kind,
          actor_login = excluded.actor_login,
          actor_is_bot = excluded.actor_is_bot,
          title = excluded.title,
          body_preview = excluded.body_preview,
          html_url = excluded.html_url,
          github_created_at = excluded.github_created_at,
          github_updated_at = excluded.github_updated_at,
          last_seen_at = excluded.last_seen_at,
          importance = excluded.importance,
          promotes_to_my_work = excluded.promotes_to_my_work,
          collapse_key = excluded.collapse_key,
          payload_json = excluded.payload_json`
      )
      .run(
        id,
        event.eventKey,
        event.entityType,
        event.repoId,
        event.entityNumber,
        event.eventKind,
        event.actorLogin,
        event.actorIsBot ? 1 : 0,
        event.title,
        event.bodyPreview,
        event.htmlUrl,
        event.githubCreatedAt,
        event.githubUpdatedAt,
        current?.first_seen_at ?? event.firstSeenAt ?? timestamp,
        event.lastSeenAt ?? timestamp,
        event.importance,
        event.promotesToMyWork ? 1 : 0,
        event.collapseKey,
        event.payload ? JSON.stringify(event.payload) : null
      );
    return this.getNotificationEvent(event.eventKey) ?? { ...event, id };
  }

  getNotificationEvent(eventKey: string): NotificationEventRecord | null {
    const row = this.db.prepare("SELECT * FROM notification_events WHERE event_key = ?").get(eventKey) as
      | Record<string, unknown>
      | undefined;
    return row ? mapNotificationEvent(row) : null;
  }
}
