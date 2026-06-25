-- Seed 5 daily tasks for character 47 (one per tier) for today (2026-06-25).
-- Run against the D1 database:
--   npx wrangler d1 execute pocketrpg-db --file=scripts/seed-daily-tasks-dev.sql
-- Or in the Wrangler dashboard's SQL console.
--
-- To clear and re-seed:
--   DELETE FROM character_daily_tasks WHERE character_id = 47 AND task_date = '2026-06-25';
-- then re-run this file.

INSERT OR IGNORE INTO character_daily_tasks
  (character_id, task_date, slot, task_id, tier, target, progress, completed_at, credited, issued_at)
VALUES
  (47, '2026-06-25', 0, 'craft_leather_gloves',    'Novice',       1,  0, NULL, 0, unixepoch() * 1000),
  (47, '2026-06-25', 1, 'kill_lesser_fiends',       'Intermediate', 20, 0, NULL, 0, unixepoch() * 1000),
  (47, '2026-06-25', 2, 'kill_arcane_adepts',       'Experienced',  10, 0, NULL, 0, unixepoch() * 1000),
  (47, '2026-06-25', 3, 'slay_king_black_dragon',   'Master',       1,  0, NULL, 0, unixepoch() * 1000),
  (47, '2026-06-25', 4, 'conquer_vaults_of_xyren',  'Grandmaster',  1,  0, NULL, 0, unixepoch() * 1000);
