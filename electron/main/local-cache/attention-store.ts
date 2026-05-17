import type {
  AttentionEntityType,
  AttentionListInput,
  AttentionLocalState,
  NotificationEventRecord
} from "../../../src/shared/attention.js";
import { nowIso } from "../path-utils.js";
import { LocalCacheStoreBase } from "./store-base.js";
import { attentionEntityId, attentionStateRowId, mapAttentionState, parseAttentionItemId } from "./store-helpers.js";

export class AttentionStore extends LocalCacheStoreBase {
  getAttentionState(
    entityType: AttentionEntityType,
    repoId: string,
    entityNumber: number | null,
    accountLogin: string
  ): AttentionLocalState | null {
    const row = this.db
      .prepare(
        `SELECT *
         FROM attention_states
         WHERE entity_type = ? AND repo_id = ? AND entity_number IS ? AND account_login = ?`
      )
      .get(entityType, repoId, entityNumber, accountLogin) as Record<string, unknown> | undefined;
    return row ? mapAttentionState(row) : null;
  }

  listAttentionStates(accountLogin: string): AttentionLocalState[] {
    return (this.db.prepare("SELECT * FROM attention_states WHERE account_login = ?").all(accountLogin) as Record<string, unknown>[]).map(
      mapAttentionState
    );
  }

  upsertAttentionState(state: AttentionLocalState): AttentionLocalState {
    const timestamp = nowIso();
    const id = state.id ?? attentionStateRowId(state);
    const current = this.db.prepare("SELECT created_at FROM attention_states WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    this.db
      .prepare(
        `INSERT INTO attention_states (
          id, entity_type, repo_id, entity_number, account_login, last_seen_event_id, last_seen_at, read_at,
          done_at, snoozed_until, muted_until, pinned_at, manual_priority, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(entity_type, repo_id, entity_number, account_login) DO UPDATE SET
          last_seen_event_id = excluded.last_seen_event_id,
          last_seen_at = excluded.last_seen_at,
          read_at = excluded.read_at,
          done_at = excluded.done_at,
          snoozed_until = excluded.snoozed_until,
          muted_until = excluded.muted_until,
          pinned_at = excluded.pinned_at,
          manual_priority = excluded.manual_priority,
          updated_at = excluded.updated_at`
      )
      .run(
        id,
        state.entityType,
        state.repoId,
        state.entityNumber,
        state.accountLogin,
        state.lastSeenEventId,
        state.lastSeenAt,
        state.readAt,
        state.doneAt,
        state.snoozedUntil,
        state.mutedUntil,
        state.pinnedAt,
        state.manualPriority,
        current?.created_at ?? state.createdAt ?? timestamp,
        timestamp
      );
    return this.getAttentionState(state.entityType, state.repoId, state.entityNumber, state.accountLogin) ?? { ...state, id };
  }

  patchAttentionState(
    entityType: AttentionEntityType,
    repoId: string,
    entityNumber: number | null,
    accountLogin: string,
    patch: Partial<AttentionLocalState>
  ): AttentionLocalState {
    const current =
      this.getAttentionState(entityType, repoId, entityNumber, accountLogin) ??
      ({
        entityType,
        repoId,
        entityNumber,
        accountLogin,
        lastSeenEventId: null,
        lastSeenAt: null,
        readAt: null,
        doneAt: null,
        snoozedUntil: null,
        mutedUntil: null,
        pinnedAt: null,
        manualPriority: null
      } satisfies AttentionLocalState);
    return this.upsertAttentionState({ ...current, ...patch });
  }

  markAttentionRead(ids: string[], accountLogin: string, at = nowIso()): void {
    for (const id of ids) {
      const parsed = parseAttentionItemId(id);
      if (!parsed) continue;
      this.patchAttentionState(parsed.entityType, parsed.repoId, parsed.entityNumber, accountLogin, {
        readAt: at,
        lastSeenAt: at,
        lastSeenEventId: id
      });
    }
  }

  markAllAttentionRead(accountLogin: string, input: AttentionListInput = {}, at = nowIso()): void {
    const events = this.listNotificationEvents(input) as NotificationEventRecord[];
    const ids = events.map((event) => attentionEntityId(event.entityType, event.repoId, event.entityNumber));
    this.markAttentionRead(ids, accountLogin, at);
  }
}
