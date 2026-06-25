-- Per-character daily task issuance + progress. Server-authoritative; lives
-- outside the save blob (like kill_counts/collection_log) so the credit-once
-- grant and progress survive last-write-wins save merges.
CREATE TABLE IF NOT EXISTS character_daily_tasks (
  character_id INTEGER NOT NULL REFERENCES characters(id),
  task_date    TEXT    NOT NULL,            -- 'YYYY-MM-DD' (UTC)
  slot         INTEGER NOT NULL,            -- 0..4
  task_id      TEXT    NOT NULL,
  tier         TEXT    NOT NULL,
  target       INTEGER NOT NULL DEFAULT 1,
  progress     INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,                     -- ms epoch; NULL = incomplete
  credited     INTEGER NOT NULL DEFAULT 0,  -- 1 once +1 credit granted (idempotency flag)
  issued_at    INTEGER NOT NULL,
  PRIMARY KEY (character_id, task_date, slot)
);
CREATE INDEX IF NOT EXISTS idx_daily_tasks_char_date
  ON character_daily_tasks(character_id, task_date);
