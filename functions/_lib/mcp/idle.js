// D1 helpers for the character_idle_state table (the server-authoritative idle
// clock for cloud characters — the client resyncs from it on load, so a
// server-side claim that resets last_active_at does not double-grant).

export async function getIdleRow(env, characterId) {
  return env.DB.prepare(
    'SELECT last_active_at, active_task, updated_at FROM character_idle_state WHERE character_id = ?',
  ).bind(characterId).first()
}

export async function setIdleTask(env, characterId, activeTaskJson, now) {
  await env.DB.prepare(
    `INSERT INTO character_idle_state (character_id, last_active_at, active_task, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(character_id) DO UPDATE SET
       last_active_at = excluded.last_active_at,
       active_task    = excluded.active_task,
       updated_at     = excluded.updated_at`,
  ).bind(characterId, now, activeTaskJson, now).run()
}

// Reset the idle clock to `now` while keeping the active task running.
export async function resetIdleActiveAt(env, characterId, now) {
  await env.DB.prepare(
    'UPDATE character_idle_state SET last_active_at = ?, updated_at = ? WHERE character_id = ?',
  ).bind(now, now, characterId).run()
}

// Clear the active task (e.g. a quest that just finished) and reset the clock.
export async function clearIdleTask(env, characterId, now) {
  await env.DB.prepare(
    'UPDATE character_idle_state SET active_task = NULL, last_active_at = ?, updated_at = ? WHERE character_id = ?',
  ).bind(now, now, characterId).run()
}

// Push the idle clock back by `ms`, so the next claim simulates that much extra
// elapsed time. Used by a 1-hour skip: the credit is already debited, this is
// what actually advances the running activity (the game client applies the same
// hour locally; whichever claims first resets the clock, so it grants once).
export async function advanceIdleClock(env, characterId, ms) {
  await env.DB.prepare(
    'UPDATE character_idle_state SET last_active_at = last_active_at - ?, updated_at = ? WHERE character_id = ?',
  ).bind(ms, Date.now(), characterId).run()
}
