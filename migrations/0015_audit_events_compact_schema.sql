PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS audit_events_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  request_id TEXT NOT NULL,
  character_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  error_code TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

INSERT INTO audit_events_new (id, event_type, severity, request_id, character_id, status, error_code, message, created_at)
SELECT
  id,
  event_type,
  severity,
  COALESCE(request_id, ''),
  COALESCE(character_id, 0),
  COALESCE(status, 'unknown'),
  COALESCE(error_code, 'none'),
  COALESCE(message, ''),
  created_at
FROM audit_events;

DROP TABLE audit_events;
ALTER TABLE audit_events_new RENAME TO audit_events;

CREATE INDEX IF NOT EXISTS idx_audit_events_created_at
  ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_event_type_created_at
  ON audit_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_character_created_at
  ON audit_events(character_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_request_id
  ON audit_events(request_id);

PRAGMA foreign_keys=ON;
