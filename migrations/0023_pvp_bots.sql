-- PvP Bot system: mark characters as system-owned bots and link them to
-- the template that defines their build/AI so resets are reproducible.
-- Bots are normal characters (not ironman / one-life) owned by a dedicated
-- system oauth_identity; they bypass the heartbeat-based waiting-room and
-- are injected into lobby responses at query time.

ALTER TABLE characters ADD COLUMN is_bot         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN bot_template_id TEXT;

CREATE INDEX IF NOT EXISTS idx_characters_is_bot
  ON characters(is_bot, combat_level)
  WHERE is_bot = 1;
