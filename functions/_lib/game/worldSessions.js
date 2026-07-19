// Live world-session lock (migration 0030). Shared by /api/save (reads: is a
// live world session holding this character?) and the world Durable Object
// (writes: begin on hello, refresh on the checkpoint cadence, clear on
// disconnect). Enforces the "world and idle game are never played at once"
// assumption the world grant design was built on.
//
// TTL is the crash-safety valve: the DO refreshes heartbeat_at every ~60s, so a
// row older than the TTL means the world session is gone (tab closed, DO
// evicted) and the lock lapses on its own — a dead world session can never
// strand a character out of the idle game permanently.
export const WORLD_SESSION_TTL_MS = 120 * 1000

/** True when a live (non-expired) world session holds this character. Fails
 * OPEN: the lock is a concurrency guard, not one of the two mandated /api/save
 * guards (stale-write, total-level regression), so a read failure — e.g. the
 * world_sessions table absent because migration 0030 hasn't been applied to
 * this D1 yet — must degrade to "no lock" rather than 500 the whole save path
 * for every player. */
export async function isWorldSessionLive(env, characterId, now = Date.now()) {
  if (!env?.DB || !Number.isInteger(Number(characterId))) return false
  try {
    const row = await env.DB.prepare(
      'SELECT heartbeat_at FROM world_sessions WHERE character_id = ?'
    ).bind(Number(characterId)).first()
    const heartbeat = Number(row?.heartbeat_at)
    return Number.isFinite(heartbeat) && now - heartbeat < WORLD_SESSION_TTL_MS
  } catch (err) {
    console.error('[worldSessions] isWorldSessionLive read failed, failing open:', err?.message || err)
    return false
  }
}

/** Claims (or refreshes) the world-session lock for this character/session. */
export async function beginWorldSession(env, characterId, sessionId, now = Date.now()) {
  if (!env?.DB) return
  await env.DB.prepare(
    `INSERT INTO world_sessions (character_id, session_id, heartbeat_at, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(character_id) DO UPDATE SET session_id = excluded.session_id, heartbeat_at = excluded.heartbeat_at`
  ).bind(Number(characterId), String(sessionId), now, now).run()
}

/** Bumps heartbeat_at, but only while THIS session still owns the row — a row
 * re-claimed by a newer session (second device) must not be kept alive by a
 * stale one's heartbeat. */
export async function refreshWorldSession(env, characterId, sessionId, now = Date.now()) {
  if (!env?.DB) return
  await env.DB.prepare(
    'UPDATE world_sessions SET heartbeat_at = ? WHERE character_id = ? AND session_id = ?'
  ).bind(now, Number(characterId), String(sessionId)).run()
}

/** Releases the lock, but only if THIS session still holds it — a disconnect
 * flush from an old session must not clear a row a reconnect already re-claimed. */
export async function endWorldSession(env, characterId, sessionId) {
  if (!env?.DB) return
  await env.DB.prepare(
    'DELETE FROM world_sessions WHERE character_id = ? AND session_id = ?'
  ).bind(Number(characterId), String(sessionId)).run()
}
