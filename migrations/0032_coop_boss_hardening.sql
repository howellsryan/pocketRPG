-- Hardening pass over co-op boss fights (migration 0031). Additive only:
-- sessions created before this migration keep working, they just start with
-- NULL denormalised HP and NULL member heartbeats until their next tick.

-- Per-member liveness. 0031 keyed the save lock off the SESSION's last_tick_at,
-- which any member refreshes — so a player whose tab crashed stayed locked out
-- of their own save for as long as the other seven kept the room alive. The
-- lock has to follow the member, exactly as world_sessions.heartbeat_at follows
-- one character rather than one zone.
ALTER TABLE coop_session_members ADD COLUMN last_seen_at INTEGER;

-- The join picker only ever wants the boss's health bar, but listOpenSessions
-- had to SELECT state_json (tens of KB per room, every member's full inventory)
-- to read two numbers. Denormalised so the picker never touches the blob.
ALTER TABLE coop_boss_sessions ADD COLUMN boss_hp INTEGER;
ALTER TABLE coop_boss_sessions ADD COLUMN boss_max_hp INTEGER;

-- The stale sweep nulls this column across every character row; without an
-- index that is a full table scan on every /api/coop/bosses and every join.
CREATE INDEX IF NOT EXISTS idx_characters_active_coop
  ON characters(active_coop_session_id);

-- Exactly-once kill settlement. The room is single-threaded, but a Durable
-- Object can be evicted mid-settlement and replay its alarm, and the D1 write
-- is not in the same transaction as the room's in-memory state. The unique key
-- is what actually makes the grant idempotent — the room's own bookkeeping is
-- only a fast path in front of it.
CREATE TABLE IF NOT EXISTS coop_kill_settlements (
  session_id     INTEGER NOT NULL REFERENCES coop_boss_sessions(id),
  kill_seq       INTEGER NOT NULL,
  character_id   INTEGER NOT NULL REFERENCES characters(id),
  boss_id        TEXT    NOT NULL,
  granted_json   TEXT,
  settled_at     INTEGER NOT NULL,
  PRIMARY KEY (session_id, kill_seq)
);

-- How many bosses this room has killed. Doubles as the settlement idempotency
-- key, so it must be persisted alongside the session rather than living only in
-- the room's memory.
ALTER TABLE coop_boss_sessions ADD COLUMN kill_seq INTEGER NOT NULL DEFAULT 0;
