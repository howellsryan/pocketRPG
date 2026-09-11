-- Durable server-owned Sunspire run/reward ledger.
CREATE TABLE IF NOT EXISTS sunspire_runs (
  run_id TEXT NOT NULL,
  character_id INTEGER NOT NULL,
  mode TEXT NOT NULL DEFAULT 'solo',
  party_session_id TEXT,
  status TEXT NOT NULL,
  current_wave INTEGER NOT NULL DEFAULT 1,
  cleared_wave INTEGER NOT NULL DEFAULT 0,
  modifier_json TEXT NOT NULL DEFAULT '{}',
  offers_json TEXT NOT NULL DEFAULT '[]',
  chest_json TEXT NOT NULL DEFAULT '[]',
  staged_json TEXT NOT NULL DEFAULT '[]',
  settlement_json TEXT,
  claim_nonce TEXT,
  last_action_nonce TEXT,
  final_wave_cleared INTEGER NOT NULL DEFAULT 0,
  completion_counted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  settled_at INTEGER,
  PRIMARY KEY (run_id, character_id),
  FOREIGN KEY (character_id) REFERENCES characters(id)
);

CREATE INDEX IF NOT EXISTS idx_sunspire_runs_character_updated
  ON sunspire_runs(character_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sunspire_runs_one_open_per_character
  ON sunspire_runs(character_id)
  WHERE status IN ('active', 'decision', 'settling');
