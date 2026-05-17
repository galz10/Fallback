import type { RepoIdentity } from "../../../src/shared/domain/repo-identity.js";
import { nowIso } from "../path-utils.js";
import { LocalCacheStoreBase } from "./store-base.js";
import { hasOwn, mapRepoIdentity } from "./store-helpers.js";
import type { RepoIdentityInput } from "./store-types.js";

export class RepoIdentityStore extends LocalCacheStoreBase {
  getRepoIdentity(repoId: string): RepoIdentity | null {
    const row = this.db
      .prepare(
        `SELECT
           ri.*,
           a.github_login AS account_login,
           a.auth_status AS account_status,
           a.github_endpoint AS account_endpoint,
           r.local_path AS local_path
         FROM repo_identities ri
         LEFT JOIN accounts a ON a.id = ri.account_id
         LEFT JOIN repos r ON r.id = ri.repo_id
         WHERE ri.repo_id = ?`
      )
      .get(repoId) as Record<string, unknown> | undefined;
    return row ? mapRepoIdentity(row) : null;
  }

  upsertRepoIdentity(repoId: string, input: RepoIdentityInput): RepoIdentity {
    const current = this.getRepoIdentity(repoId);
    const account = input.accountId ? this.getGitHubAccountById(input.accountId) : null;
    const timestamp = nowIso();
    const endpoint = input.endpoint ?? account?.endpoint ?? current?.accountEndpoint ?? "https://api.github.com";
    this.db
      .prepare(
        `INSERT INTO repo_identities (
           repo_id, account_id, endpoint, git_name, git_email, signing_mode, signing_key_hint,
           remote_protocol, verified_email_status, last_checked_at, last_check_status, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(repo_id) DO UPDATE SET
           account_id = excluded.account_id,
           endpoint = excluded.endpoint,
           git_name = excluded.git_name,
           git_email = excluded.git_email,
           signing_mode = excluded.signing_mode,
           signing_key_hint = excluded.signing_key_hint,
           remote_protocol = excluded.remote_protocol,
           verified_email_status = excluded.verified_email_status,
           last_checked_at = excluded.last_checked_at,
           last_check_status = excluded.last_check_status,
           updated_at = excluded.updated_at`
      )
      .run(
        repoId,
        hasOwn(input, "accountId") ? input.accountId : (current?.accountId ?? null),
        endpoint,
        hasOwn(input, "gitName") ? input.gitName : (current?.gitName ?? null),
        hasOwn(input, "gitEmail") ? input.gitEmail : (current?.gitEmail ?? null),
        input.signingMode ?? current?.signingMode ?? "unknown",
        hasOwn(input, "signingKeyHint") ? input.signingKeyHint : (current?.signingKeyHint ?? null),
        input.remoteProtocol ?? current?.remoteProtocol ?? "unknown",
        input.verifiedEmailStatus ?? current?.verifiedEmailStatus ?? "unknown",
        hasOwn(input, "lastCheckedAt") ? input.lastCheckedAt : (current?.lastCheckedAt ?? null),
        input.lastCheckStatus ?? current?.lastCheckStatus ?? "unknown",
        current?.createdAt ?? timestamp,
        timestamp
      );
    return this.getRepoIdentity(repoId)!;
  }
}
