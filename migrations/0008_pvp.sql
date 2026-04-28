-- PvP system: waiting room, invitations, matches, intents.
-- Phase 1 ships waiting + invitations + match table (with stub accept that
-- aborts the match immediately). Phase 3 wires the full match-loop server.
--
-- See CLAUDE.md §16 (added in Phase 5) for engine + loot rules.

-- Fast lookup for "is this character in an active match?". Cleared on
-- match end. Acts as the inventory lock signal across save/idle/purchase
-- endpoints.
ALTER TABLE characters ADD COLUMN active_match_id INTEGER;

CREATE TABLE IF NOT EXISTS pvp_waiting_room (
  character_id   INTEGER PRIMARY KEY REFERENCES characters(id),
  combat_level   INTEGER NOT NULL,
  joined_at      INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pvp_waiting_combat ON pvp_waiting_room(combat_level);
CREATE INDEX IF NOT EXISTS idx_pvp_waiting_last_seen ON pvp_waiting_room(last_seen_at);

CREATE TABLE IF NOT EXISTS pvp_matches (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  character_a         INTEGER NOT NULL REFERENCES characters(id),
  character_b         INTEGER NOT NULL REFERENCES characters(id),
  status              TEXT NOT NULL,              -- 'active' | 'completed' | 'aborted'
  started_at          INTEGER NOT NULL,
  ended_at            INTEGER,
  winner_character_id INTEGER REFERENCES characters(id),
  current_tick        INTEGER NOT NULL DEFAULT 0,
  state_json          TEXT NOT NULL,
  last_tick_at        INTEGER NOT NULL
);
-- Enforce one active match per character. Insertion of a second active row
-- for either side fails loudly on the UNIQUE constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pvp_matches_one_active_a
  ON pvp_matches(character_a) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_pvp_matches_one_active_b
  ON pvp_matches(character_b) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_pvp_matches_status_ended
  ON pvp_matches(status, ended_at);

CREATE TABLE IF NOT EXISTS pvp_invitations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  from_character  INTEGER NOT NULL REFERENCES characters(id),
  to_character    INTEGER NOT NULL REFERENCES characters(id),
  status          TEXT NOT NULL,                  -- 'pending' | 'accepted' | 'declined' | 'expired'
  created_at      INTEGER NOT NULL,
  responded_at    INTEGER,
  match_id        INTEGER REFERENCES pvp_matches(id)
);
-- Only one pending invite per directed pair. Repeat matches between the same
-- pair after a decline/accept stay possible because completed/declined rows
-- don't trip this index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pvp_invitations_pending
  ON pvp_invitations(from_character, to_character) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_pvp_invitations_to_pending
  ON pvp_invitations(to_character) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_pvp_invitations_from_pending
  ON pvp_invitations(from_character) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS pvp_intents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id        INTEGER NOT NULL REFERENCES pvp_matches(id),
  character_id    INTEGER NOT NULL REFERENCES characters(id),
  tick_number     INTEGER NOT NULL,
  character_seq   INTEGER NOT NULL,               -- per-character monotonic; deterministic ordering
  action_json     TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  applied         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pvp_intents_match_tick
  ON pvp_intents(match_id, tick_number, character_id, character_seq) WHERE applied = 0;
