-- Co-operative boss fights: several players versus one shared boss, with the
-- server owning every swing.
--
-- Transport mirrors PvP (state_json + current_tick advanced by whichever member
-- polls first, optimistic concurrency on current_tick). The combat model
-- mirrors the open world: each member runs their own engine session against a
-- shared boss HP record, damage is attributed per character, and the kill's
-- loot goes to the top-damage contributor.
--
-- Instances are sharded rather than one global boss per boss id: joining picks
-- the fullest non-full active session, so a popular boss spreads across rooms
-- instead of contending on a single row (the scaling trap called out as item 13
-- in docs/multiplayer-bossing-review.md).

CREATE TABLE IF NOT EXISTS coop_boss_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  boss_id       TEXT    NOT NULL,
  status        TEXT    NOT NULL,           -- 'active' | 'completed' | 'abandoned'
  member_count  INTEGER NOT NULL DEFAULT 0, -- denormalised for the join picker
  created_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  current_tick  INTEGER NOT NULL DEFAULT 0,
  state_json    TEXT    NOT NULL,
  last_tick_at  INTEGER NOT NULL
);
-- The join picker's hot query: active sessions for a boss, fullest first.
CREATE INDEX IF NOT EXISTS idx_coop_sessions_open
  ON coop_boss_sessions(boss_id, status, member_count);
CREATE INDEX IF NOT EXISTS idx_coop_sessions_status_tick
  ON coop_boss_sessions(status, last_tick_at);

CREATE TABLE IF NOT EXISTS coop_session_members (
  session_id   INTEGER NOT NULL REFERENCES coop_boss_sessions(id),
  character_id INTEGER NOT NULL REFERENCES characters(id),
  joined_at    INTEGER NOT NULL,
  left_at      INTEGER,
  PRIMARY KEY (session_id, character_id)
);
CREATE INDEX IF NOT EXISTS idx_coop_members_character
  ON coop_session_members(character_id, left_at);

-- Queued member actions (eat, drink, prayer, stance, special, target swap),
-- applied in tick + character + seq order so every client replays the fight
-- identically. Mirrors pvp_intents.
CREATE TABLE IF NOT EXISTS coop_intents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    INTEGER NOT NULL REFERENCES coop_boss_sessions(id),
  character_id  INTEGER NOT NULL REFERENCES characters(id),
  tick_number   INTEGER NOT NULL,
  character_seq INTEGER NOT NULL,
  action_json   TEXT    NOT NULL,
  applied       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coop_intents_pending
  ON coop_intents(session_id, applied, tick_number);

-- Save lock, same lock class as characters.active_match_id (PvP) and
-- world_sessions (open world): while this is set the server is mutating the
-- character's inventory (food, runes, ammo) and XP tick by tick, so the idle
-- client must not write the save underneath it.
ALTER TABLE characters ADD COLUMN active_coop_session_id INTEGER;
