CREATE TABLE IF NOT EXISTS world_positions (
  character_id INTEGER PRIMARY KEY REFERENCES characters(id),
  zone_id      TEXT    NOT NULL,
  x            INTEGER NOT NULL,
  z            INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS world_grants (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id    INTEGER NOT NULL REFERENCES characters(id),
  idempotency_key TEXT    NOT NULL UNIQUE,
  payload_json    TEXT    NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_world_grants_char ON world_grants (character_id, created_at);
