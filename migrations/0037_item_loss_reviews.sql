CREATE TABLE IF NOT EXISTS item_loss_reviews (
  audit_event_id INTEGER PRIMARY KEY REFERENCES audit_events(id),
  character_id   INTEGER,
  status         TEXT NOT NULL,
  note           TEXT,
  reviewed_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_item_loss_reviews_status
  ON item_loss_reviews(status, reviewed_at DESC);
