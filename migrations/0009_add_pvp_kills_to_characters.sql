ALTER TABLE characters ADD COLUMN total_pvp_kills INTEGER NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN last_updated_total_pvp_kills INTEGER;

CREATE INDEX IF NOT EXISTS idx_characters_pvp_kills_rank
  ON characters(total_pvp_kills DESC, last_updated_total_pvp_kills ASC, id ASC)
  WHERE total_pvp_kills > 0 AND deleted_at IS NULL;
