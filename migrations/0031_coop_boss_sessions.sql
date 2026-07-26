ALTER TABLE characters ADD COLUMN active_coop_session_id INTEGER;

DROP TABLE IF EXISTS coop_intents;
DROP TABLE IF EXISTS coop_kill_settlements;
DROP TABLE IF EXISTS coop_session_members;
DROP TABLE IF EXISTS coop_boss_sessions;

CREATE TABLE coop_boss_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  boss_id       TEXT    NOT NULL,
  status        TEXT    NOT NULL,
  member_count  INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  current_tick  INTEGER NOT NULL DEFAULT 0,
  state_json    TEXT    NOT NULL,
  last_tick_at  INTEGER NOT NULL,
  boss_hp       INTEGER,
  boss_max_hp   INTEGER,
  kill_seq      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_coop_sessions_open
  ON coop_boss_sessions(boss_id, status, member_count);
CREATE INDEX IF NOT EXISTS idx_coop_sessions_status_tick
  ON coop_boss_sessions(status, last_tick_at);

CREATE TABLE coop_session_members (
  session_id   INTEGER NOT NULL REFERENCES coop_boss_sessions(id),
  character_id INTEGER NOT NULL REFERENCES characters(id),
  joined_at    INTEGER NOT NULL,
  left_at      INTEGER,
  last_seen_at INTEGER,
  PRIMARY KEY (session_id, character_id)
);

CREATE INDEX IF NOT EXISTS idx_coop_members_character
  ON coop_session_members(character_id, left_at);

CREATE TABLE coop_kill_settlements (
  session_id     INTEGER NOT NULL REFERENCES coop_boss_sessions(id),
  kill_seq       INTEGER NOT NULL,
  character_id   INTEGER NOT NULL REFERENCES characters(id),
  boss_id        TEXT    NOT NULL,
  granted_json   TEXT,
  settled_at     INTEGER NOT NULL,
  PRIMARY KEY (session_id, kill_seq)
);

CREATE INDEX IF NOT EXISTS idx_characters_active_coop
  ON characters(active_coop_session_id);

UPDATE characters SET active_coop_session_id = NULL WHERE active_coop_session_id IS NOT NULL;
