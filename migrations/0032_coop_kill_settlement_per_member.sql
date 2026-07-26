DROP TABLE IF EXISTS coop_kill_settlements;

CREATE TABLE coop_kill_settlements (
  session_id     INTEGER NOT NULL REFERENCES coop_boss_sessions(id),
  kill_seq       INTEGER NOT NULL,
  character_id   INTEGER NOT NULL REFERENCES characters(id),
  boss_id        TEXT    NOT NULL,
  granted_json   TEXT,
  settled_at     INTEGER NOT NULL,
  PRIMARY KEY (session_id, kill_seq, character_id)
);

CREATE INDEX IF NOT EXISTS idx_coop_settlements_seq
  ON coop_kill_settlements(session_id, kill_seq);
