-- PocketRPG initial schema
-- One OAuth identity may own many characters. Each character has a globally
-- unique username (case-insensitive). Saves are 1:1 with characters.

CREATE TABLE IF NOT EXISTS oauth_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  email TEXT,
  display_name TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES oauth_identities(id),
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_characters_owner ON characters(owner_id);

CREATE TABLE IF NOT EXISTS saves (
  character_id INTEGER PRIMARY KEY REFERENCES characters(id),
  base64 TEXT NOT NULL,
  hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Reserved names that nobody can claim. Seed with a few obvious ones.
CREATE TABLE IF NOT EXISTS reserved_usernames (
  username TEXT PRIMARY KEY COLLATE NOCASE
);

INSERT OR IGNORE INTO reserved_usernames (username) VALUES
  ('admin'), ('administrator'), ('mod'), ('moderator'),
  ('system'), ('pocketrpg'), ('null'), ('undefined'),
  ('root'), ('support'), ('help');
