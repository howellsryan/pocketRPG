-- Per-character PvE collection log. Composite PK keeps INSERTs idempotent so
-- the client (or idle backfill) can replay records without producing dupes.
-- source_type is one of: 'monster', 'raid', 'minigame', 'clue'.
-- source_id is the in-game source identifier (monsterId, raidId, minigameId,
-- or clue tier name).
CREATE TABLE IF NOT EXISTS collection_log (
  character_id INTEGER NOT NULL REFERENCES characters(id),
  item_id      TEXT    NOT NULL,
  source_type  TEXT    NOT NULL,
  source_id    TEXT    NOT NULL,
  obtained_at  INTEGER NOT NULL,
  PRIMARY KEY (character_id, item_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_log_character ON collection_log(character_id);
