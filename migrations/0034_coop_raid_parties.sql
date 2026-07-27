ALTER TABLE coop_boss_sessions ADD COLUMN raid_id TEXT;
ALTER TABLE coop_boss_sessions ADD COLUMN phase TEXT NOT NULL DEFAULT 'active';
ALTER TABLE coop_boss_sessions ADD COLUMN host_character_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_coop_sessions_raid
  ON coop_boss_sessions(raid_id, status, phase);
