CREATE TABLE IF NOT EXISTS offline_actions (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  repo_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_number INTEGER NOT NULL,
  title TEXT,
  body TEXT NOT NULL,
  payload_json TEXT,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_attempt_at TEXT,
  upstream_last_seen_sha TEXT,
  upstream_last_seen_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  posted_at TEXT,
  last_error_code TEXT,
  last_error TEXT,
  FOREIGN KEY (repo_id) REFERENCES repos(id),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_offline_actions_status_next_attempt ON offline_actions(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_offline_actions_entity ON offline_actions(repo_id, entity_type, entity_number);
CREATE INDEX IF NOT EXISTS idx_offline_actions_account_status ON offline_actions(account_id, status);
CREATE INDEX IF NOT EXISTS idx_offline_actions_updated_at ON offline_actions(updated_at);
