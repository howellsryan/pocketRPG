CREATE TABLE IF NOT EXISTS hard_mode_targets (
  character_id INTEGER NOT NULL REFERENCES characters(id),
  source_type  TEXT    NOT NULL,
  source_id    TEXT    NOT NULL,
  enabled_at   INTEGER NOT NULL,
  PRIMARY KEY (character_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_hard_mode_character
  ON hard_mode_targets(character_id);

ALTER TABLE coop_boss_sessions ADD COLUMN hard_mode INTEGER NOT NULL DEFAULT 0;
