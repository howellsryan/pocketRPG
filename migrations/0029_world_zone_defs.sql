-- World editor: zone definitions stored in D1 so the world editor can save a
-- zone and have it play immediately (no Worker redeploy). A row here overrides
-- the bundled zones/*.json of the same id; absent, the bundled def is used.
CREATE TABLE IF NOT EXISTS world_zone_defs (
  zone_id    TEXT    PRIMARY KEY,
  def_json   TEXT    NOT NULL,
  revision   INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

-- Bounded save history (last N per zone, trimmed on write) — undo/rollback
-- safety net for the editor. Not read by the game runtime.
CREATE TABLE IF NOT EXISTS world_zone_revisions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id    TEXT    NOT NULL,
  revision   INTEGER NOT NULL,
  def_json   TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_world_zone_revisions_zone ON world_zone_revisions (zone_id, revision);
