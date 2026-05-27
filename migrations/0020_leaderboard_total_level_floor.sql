-- Raise the leaderboard ranking index floor from total_level > 0 to
-- total_level > 33. A brand-new account sits at total_level=33 (every skill
-- at level 1 with Hitpoints starting at 10), so > 0 still admitted untouched
-- fresh accounts onto the leaderboard. > 33 keeps the partial index — and the
-- leaderboard read in functions/api/leaderboard.js — to accounts that have
-- gained at least one level beyond the starting state.
--
-- The query's WHERE clause is updated to match in the same change; SQLite can
-- only use this partial index when the query predicate implies it.
DROP INDEX IF EXISTS idx_characters_total_level_rank;

CREATE INDEX IF NOT EXISTS idx_characters_total_level_rank
  ON characters(total_level DESC, id ASC)
  WHERE deleted_at IS NULL AND total_level > 33;
