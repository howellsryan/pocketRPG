-- Idle state table: authoritative source for "when was the player last active"
-- and "what task were they doing" when they come back to the app.
--
-- The full save blob in `saves` still embeds lastTick/activeTask as a safety
-- backup, but the idle engine reads from this row first when online. The
-- server stamps `last_active_at` with its own Date.now() on every write to
-- defeat client clock-skew cheats.
CREATE TABLE IF NOT EXISTS character_idle_state (
  character_id   INTEGER PRIMARY KEY REFERENCES characters(id),
  last_active_at INTEGER NOT NULL,
  active_task    TEXT,
  updated_at     INTEGER NOT NULL
);
