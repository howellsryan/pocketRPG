-- First-achieved leaderboard tie-break. The total-level board sorts by
-- total_level DESC; previously ties broke by id ASC (account creation order),
-- which is not the same as who *reached* that total level first. This adds a
-- total_level_at timestamp (epoch ms) stamped whenever an account reaches a new
-- total level (see functions/api/save.js), so two accounts on the same total
-- level rank by whoever got there first.
--
-- Backfill existing rows to created_at: we have no level-up history, so the
-- account's creation time is the best available proxy and preserves the prior
-- id-ASC ordering for accounts already tied today.
ALTER TABLE characters ADD COLUMN total_level_at INTEGER NOT NULL DEFAULT 0;

UPDATE characters SET total_level_at = created_at WHERE total_level_at = 0;

-- Rebuild the ranking index to match the leaderboard ORDER BY
-- (total_level DESC, total_level_at ASC, id ASC) so the read stays a pure
-- indexed scan. The partial-index floor (total_level > 33) is unchanged.
DROP INDEX IF EXISTS idx_characters_total_level_rank;

CREATE INDEX IF NOT EXISTS idx_characters_total_level_rank
  ON characters(total_level DESC, total_level_at ASC, id ASC)
  WHERE deleted_at IS NULL AND total_level > 33;
