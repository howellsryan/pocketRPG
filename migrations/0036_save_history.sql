CREATE TABLE IF NOT EXISTS save_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id  INTEGER NOT NULL REFERENCES characters(id),
  save_revision INTEGER NOT NULL,
  save_blob     BLOB,
  save_data     TEXT,
  created_at    INTEGER NOT NULL,
  reason        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_save_history_character
  ON save_history(character_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_save_history_reason_created
  ON save_history(reason, created_at);
