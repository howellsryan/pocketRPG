-- Per-character daily task issuance + progress. Server-authoritative; lives
-- outside the save blob (like kill_counts/collection_log) so the credit-once
-- grant and progress survive last-write-wins save merges.
CREATE TABLE IF NOT EXISTS character_daily_tasks (
  character_id INTEGER NOT NULL REFERENCES characters(id),
  task_date    TEXT    NOT NULL,            
  slot         INTEGER NOT NULL,           
  task_id      TEXT    NOT NULL,
  tier         TEXT    NOT NULL,
  target       INTEGER NOT NULL DEFAULT 1,
  progress     INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,                    
  credited     INTEGER NOT NULL DEFAULT 0,
  issued_at    INTEGER NOT NULL,
  PRIMARY KEY (character_id, task_date, slot)
);
CREATE INDEX IF NOT EXISTS idx_daily_tasks_char_date
  ON character_daily_tasks(character_id, task_date);
