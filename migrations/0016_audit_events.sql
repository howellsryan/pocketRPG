-- Durable audit log for high-value mutations: credit grants/spends,
-- protected reward claims, PvP settlement, action completion, trading
-- post movements. Required by CLAUDE.md §14. Previously these only hit
-- console.log, which on Cloudflare Pages is ephemeral and unsearchable
-- for support / dispute resolution.

CREATE TABLE IF NOT EXISTS audit_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type    TEXT NOT NULL,
  identity_id   INTEGER,
  character_id  INTEGER,
  payload_json  TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_character
  ON audit_events(character_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_type_time
  ON audit_events(event_type, created_at DESC);
