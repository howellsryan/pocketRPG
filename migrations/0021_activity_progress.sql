-- Per-activity progress ledger.
-- Stores partial progress for background activities so switching to a
-- different activity does not wipe the previous one's progress.
-- Fixed-duration activities (quests, minigames, dungeoneering rewards)
-- record progress_ticks so they can resume exactly where they left off.
CREATE TABLE IF NOT EXISTS character_activity_progress (
  character_id   INTEGER NOT NULL REFERENCES characters(id),
  activity_key   TEXT    NOT NULL,               -- e.g. 'quest:dragon_slayer'
  progress_ticks INTEGER NOT NULL DEFAULT 0,     -- ticks accrued toward this activity
  total_ticks    INTEGER,                        -- total ticks for fixed-duration (null = continuous loop)
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (character_id, activity_key)
);
