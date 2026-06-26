// Single SQL source of truth for the character_idle_state upsert. Stamps
// last_active_at + active_task for a character, inserting the row if absent.
// Shared by /api/idle (the dedicated idle endpoint), the MCP idle helper, and
// /api/save (which folds the idle heartbeat into the save write). Server stamps
// the clock with `now` so the client can't inflate offline rewards.
export async function stampIdleActive(env, characterId, activeTaskJson, now) {
  await env.DB.prepare(
    `INSERT INTO character_idle_state (character_id, last_active_at, active_task, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(character_id) DO UPDATE SET
       last_active_at = excluded.last_active_at,
       active_task    = excluded.active_task,
       updated_at     = excluded.updated_at`,
  ).bind(characterId, now, activeTaskJson, now).run()
}

// Same upsert, as a prepared statement (not yet run) for callers that want to
// fold the stamp into an existing env.DB.batch() for one atomic round-trip.
export function stampIdleActiveStatement(env, characterId, activeTaskJson, now) {
  return env.DB.prepare(
    `INSERT INTO character_idle_state (character_id, last_active_at, active_task, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(character_id) DO UPDATE SET
       last_active_at = excluded.last_active_at,
       active_task    = excluded.active_task,
       updated_at     = excluded.updated_at`,
  ).bind(characterId, now, activeTaskJson, now)
}
