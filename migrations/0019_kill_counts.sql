-- Per-character boss/raid kill counts. Moved out of the save blob (see
-- collection_log, 0011) because monotonic counters are lost under
-- last-write-wins blob merges. Server-authoritative: only the action
-- completion endpoints increment these rows.
CREATE TABLE IF NOT EXISTS kill_counts (
  character_id INTEGER NOT NULL REFERENCES characters(id),
  source_type  TEXT    NOT NULL,
  source_id    TEXT    NOT NULL,
  kill_count   INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (character_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_kill_counts_character ON kill_counts(character_id);
