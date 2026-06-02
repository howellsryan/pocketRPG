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
