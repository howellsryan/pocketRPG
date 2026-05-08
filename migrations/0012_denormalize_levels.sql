-- Denormalize total_level and combat_level onto `characters` so the
-- leaderboard and PvP-CB lookup paths don't have to LEFT JOIN `saves` and
-- JSON.parse the full save blob in a Worker. The hot reads now run as
-- pure indexed SELECTs against `characters`.
--
-- New rows are populated by the next save PUT for each character (see
-- functions/api/save.js). Pre-migration characters who never re-save will
-- sit at total_level=0 / combat_level=3 — the index below skips them so
-- they never reach a leaderboard page until a save lands.

ALTER TABLE characters ADD COLUMN total_level  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN combat_level INTEGER NOT NULL DEFAULT 3;

CREATE INDEX IF NOT EXISTS idx_characters_total_level_rank
  ON characters(total_level DESC, id ASC)
  WHERE deleted_at IS NULL AND total_level > 0;
