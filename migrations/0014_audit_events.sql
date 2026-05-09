CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  request_id TEXT,
  identity_id TEXT,
  character_id INTEGER,
  related_character_id INTEGER,
  match_id INTEGER,
  invitation_id INTEGER,
  stripe_event_id TEXT,
  item_id TEXT,
  status TEXT,
  error_code TEXT,
  message TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_created_at
  ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_event_type_created_at
  ON audit_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_character_created_at
  ON audit_events(character_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_request_id
  ON audit_events(request_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_match_id
  ON audit_events(match_id);
