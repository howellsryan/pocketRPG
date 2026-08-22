CREATE TABLE IF NOT EXISTS slayer_task_blocks (
  character_id INTEGER NOT NULL REFERENCES characters(id),
  monster_id   TEXT    NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (character_id, monster_id)
);

CREATE INDEX IF NOT EXISTS idx_slayer_task_blocks_character
  ON slayer_task_blocks(character_id);
