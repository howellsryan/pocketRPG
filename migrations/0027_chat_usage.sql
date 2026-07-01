-- Help-chatbot usage quotas. Per-character daily message counts plus a global
-- daily counter used as a circuit-breaker so the Workers AI free allocation is
-- never exceeded (when tripped, /api/chat degrades to retrieval-only answers).
CREATE TABLE IF NOT EXISTS chat_usage (
  character_id INTEGER NOT NULL REFERENCES characters(id),
  day_key      TEXT    NOT NULL,             -- UTC day, YYYY-MM-DD (resets 00:00 UTC)
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (character_id, day_key)
);

CREATE TABLE IF NOT EXISTS chat_global_usage (
  day_key TEXT PRIMARY KEY,
  count   INTEGER NOT NULL DEFAULT 0
);
