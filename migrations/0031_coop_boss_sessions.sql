-- Co-operative boss fights: several players versus one shared boss, with the
-- server owning every swing.
--
-- The combat model mirrors the open world: each member runs their own engine
-- session against a shared boss HP record, damage is attributed per character,
-- and the kill's loot goes to the top-damage contributor. The fight itself runs
-- in the CoopBossRoom Durable Object; these tables are the durable side of it —
-- joining, leaving, the save lock, kill settlement and crash recovery.
--
-- Instances are sharded rather than one global boss per boss id: joining picks
-- the fullest non-full active session, so a popular boss spreads across rooms
-- instead of contending on a single row.
--
-- RE-RUN SAFETY. D1 aborts a batch at the first failing statement and says
-- nothing about the rest, so a half-applied migration is invisible until a query
-- hits the missing column — as a save endpoint 500ing on `no such column:
-- m.last_seen_at` once demonstrated. Everything below is therefore re-runnable,
-- and the ONE statement that cannot be — the ALTER — is deliberately FIRST, so a
-- database that already has the column fails on the line where nothing has been
-- done yet instead of half way through. If it errors with
-- `duplicate column name: active_coop_session_id`, that column is already there:
-- run the file from the next statement on.
--
-- That re-runnability is bought by dropping and recreating the co-op tables,
-- which is safe because they hold only live-fight state — but it does end any
-- fight in progress at the moment it runs.

ALTER TABLE characters ADD COLUMN active_coop_session_id INTEGER;

-- coop_intents is dead. The first cut of this feature queued member actions in
-- D1 because the fight was advanced by whichever member polled first; the room
-- now holds pending intents in memory and applies them on its own tick, so
-- nothing writes this table. Dropped here for databases that already have it.
DROP TABLE IF EXISTS coop_intents;

DROP TABLE IF EXISTS coop_kill_settlements;
DROP TABLE IF EXISTS coop_session_members;
DROP TABLE IF EXISTS coop_boss_sessions;

CREATE TABLE coop_boss_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  boss_id       TEXT    NOT NULL,
  status        TEXT    NOT NULL,           -- 'active' | 'completed' | 'abandoned'
  member_count  INTEGER NOT NULL DEFAULT 0, -- denormalised for the join picker
  created_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  current_tick  INTEGER NOT NULL DEFAULT 0,
  state_json    TEXT    NOT NULL,
  last_tick_at  INTEGER NOT NULL,
  -- The join picker only ever wants the boss's health bar. Denormalised so it
  -- never has to SELECT state_json — tens of KB per room, every member's full
  -- inventory — to read two numbers.
  boss_hp       INTEGER,
  boss_max_hp   INTEGER,
  -- How many bosses this room has killed. Doubles as the settlement idempotency
  -- key below, so it has to be persisted alongside the session rather than
  -- living only in the room's memory.
  kill_seq      INTEGER NOT NULL DEFAULT 0
);
-- The join picker's hot query: active sessions for a boss, fullest first.
CREATE INDEX IF NOT EXISTS idx_coop_sessions_open
  ON coop_boss_sessions(boss_id, status, member_count);
CREATE INDEX IF NOT EXISTS idx_coop_sessions_status_tick
  ON coop_boss_sessions(status, last_tick_at);

CREATE TABLE coop_session_members (
  session_id   INTEGER NOT NULL REFERENCES coop_boss_sessions(id),
  character_id INTEGER NOT NULL REFERENCES characters(id),
  joined_at    INTEGER NOT NULL,
  left_at      INTEGER,
  -- Per-member liveness, and what the save lock is keyed on. A session-wide
  -- clock left a player whose tab crashed locked out of their own save for as
  -- long as the other seven kept the room alive; the lock has to follow the
  -- member, exactly as world_sessions.heartbeat_at follows one character.
  last_seen_at INTEGER,
  PRIMARY KEY (session_id, character_id)
);
CREATE INDEX IF NOT EXISTS idx_coop_members_character
  ON coop_session_members(character_id, left_at);

-- Exactly-once kill settlement. The room is single-threaded, but a Durable
-- Object can be evicted mid-settlement and replay its alarm, and the D1 write is
-- not in the same transaction as the room's in-memory state. This unique key is
-- what actually makes the grant idempotent — the room's own bookkeeping is only
-- a fast path in front of it.
CREATE TABLE coop_kill_settlements (
  session_id     INTEGER NOT NULL REFERENCES coop_boss_sessions(id),
  kill_seq       INTEGER NOT NULL,
  character_id   INTEGER NOT NULL REFERENCES characters(id),
  boss_id        TEXT    NOT NULL,
  granted_json   TEXT,
  settled_at     INTEGER NOT NULL,
  PRIMARY KEY (session_id, kill_seq)
);

-- The save lock, same lock class as characters.active_match_id (PvP) and
-- world_sessions (open world): while active_coop_session_id is set the server is
-- mutating that character's inventory (food, runes, ammo) and XP tick by tick,
-- so the idle client must not write the save underneath it. The stale sweep
-- nulls this column across every character row, which without an index is a full
-- table scan on every /api/coop/bosses and every join.
CREATE INDEX IF NOT EXISTS idx_characters_active_coop
  ON characters(active_coop_session_id);

-- Any lock left pointing at a session the drops above removed. Harmless when it
-- matches nothing.
UPDATE characters SET active_coop_session_id = NULL WHERE active_coop_session_id IS NOT NULL;
