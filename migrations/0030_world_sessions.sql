-- Live world-session presence, so the open-world companion and the idle game
-- can never mutate the same character's save concurrently. The whole world
-- grant design assumes "a world session and the main game are never played
-- simultaneously" (world/server/grants.ts) but nothing enforced it: playing
-- both at once could clobber or duplicate equipment (the world flush overwrites
-- save.equipment wholesale) and silently vanish items via clamped removals.
--
-- The world Durable Object writes a row on hello and refreshes heartbeat_at on
-- its checkpoint cadence; it clears the row on disconnect. /api/save treats a
-- row whose heartbeat_at is within the TTL as a live session and refuses the
-- write (409), exactly like the PvP active-match lock. The TTL is the
-- self-heal: if a DO dies without clearing its row, the lock lapses on its own
-- rather than stranding the character out of the idle game forever.
CREATE TABLE IF NOT EXISTS world_sessions (
  character_id INTEGER PRIMARY KEY REFERENCES characters(id),
  session_id   TEXT    NOT NULL,
  heartbeat_at INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);
