-- Supports the per-boss / per-raid KC leaderboards: top killers of a given
-- source ordered by kill_count. Without this the leaderboard query would scan
-- every row for the source_type.
CREATE INDEX IF NOT EXISTS idx_kill_counts_leaderboard
  ON kill_counts(source_type, source_id, kill_count DESC);
