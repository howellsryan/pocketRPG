// Single SQL source of truth for the character_idle_state upsert. Stamps
// last_active_at + active_task for a character, inserting the row if absent.
// Shared by /api/idle (the dedicated idle endpoint), the MCP idle helper, and
// /api/save (which folds the idle heartbeat into the save write). Server stamps
// the clock with `now` so the client can't inflate offline rewards.
//
// `interactiveAt` (optional): when the save reflects genuine player interaction
// (not an idle backstop write), pass `now` to advance last_interactive_at —
// the freshness signal the idle write ceiling checks. Pass null/omit to leave
// it unchanged (COALESCE keeps the stored value), so idle-only writes never
// refresh it.
export async function stampIdleActive(env, characterId, activeTaskJson, now, interactiveAt = null) {
  await stampIdleActiveStatement(env, characterId, activeTaskJson, now, interactiveAt).run()
}

// Same upsert, as a prepared statement (not yet run) for callers that want to
// fold the stamp into an existing env.DB.batch() for one atomic round-trip.
export function stampIdleActiveStatement(env, characterId, activeTaskJson, now, interactiveAt = null) {
  return env.DB.prepare(
    `INSERT INTO character_idle_state (character_id, last_active_at, active_task, updated_at, last_interactive_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(character_id) DO UPDATE SET
       last_active_at = excluded.last_active_at,
       active_task    = excluded.active_task,
       updated_at     = excluded.updated_at,
       last_interactive_at = COALESCE(excluded.last_interactive_at, character_idle_state.last_interactive_at)`,
  ).bind(characterId, now, activeTaskJson, now, interactiveAt)
}
