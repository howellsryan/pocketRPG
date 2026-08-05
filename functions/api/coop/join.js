import { requireAuth, json } from '../../_lib/auth.js'
import { getOwnedCharacter } from '../../_lib/character.js'
import { isWorldSessionLive } from '../../_lib/game/worldSessions.js'
import { currentSaveRevision, joinCoopSession, parseCoopSessionId, readSession, parseSessionState, sweepStaleCoopSessions } from '../../_lib/game/coopBoss.js'
import { projectStateForMember } from '../../_lib/game/coopProjection.js'
import { toErrorResponse } from '../../_lib/game/errors.js'

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  // A co-op session mutates the save, so it collides with a live world session,
  // which wins.
  if (await isWorldSessionLive(env, ch.id)) {
    return json({ error: 'character_in_world_session', code: 'CHARACTER_IN_WORLD_SESSION' }, 409)
  }

  await sweepStaleCoopSessions(env)

  try {
    const body = await request.json().catch(() => null)
    const bossId = typeof body?.bossId === 'string' ? body.bossId : null
    if (!bossId) return json({ error: 'Missing bossId', code: 'INVALID_COOP_BOSS' }, 400)

    // Optional: the session browser joins one named group rather than letting
    // the picker choose.
    const rawSessionId = body?.sessionId
    const requestedSessionId = rawSessionId === undefined || rawSessionId === null
      ? null
      : parseCoopSessionId(String(rawSessionId))
    if (rawSessionId !== undefined && rawSessionId !== null && requestedSessionId === null) {
      return json({ error: 'Invalid session', code: 'INVALID_COOP_SESSION' }, 400)
    }

    const { sessionId, rejoined, saveRevision } = await joinCoopSession(env, {
      characterId: ch.id,
      identityId: auth.identity.id,
      bossId,
      username: ch.username,
      sessionId: requestedSessionId,
    })

    const row = await readSession(env, sessionId)
    const state = row ? parseSessionState(row) : null
    return json({
      ok: true,
      sessionId,
      rejoined,
      // The join wrote the save, so the client has to re-anchor on this or its
      // next push is a stale write.
      save_revision: saveRevision,
      state: state ? projectStateForMember(state, ch.id) : null,
      current_tick: row?.current_tick ?? 0,
    })
  } catch (err) {
    const mapped = toErrorResponse(err)
    // An unmapped failure becomes a bare 500 the player cannot act on and that
    // leaves nothing in `wrangler tail` — name it here or the next one is just
    // as blind.
    if (mapped.status >= 500) {
      console.error('[PocketRPG][coop] join failed', {
        characterId: ch.id, message: (err && (err.message || String(err))) || 'unknown',
      })
    }
    // A join can fail AFTER the snapshot write (a contended slot, a full room),
    // and the bumped revision outlives the failure. Send it with the error too,
    // or the player's next autosave is rejected for a fight they never entered.
    const saveRevision = await currentSaveRevision(env, ch.id).catch(() => null)
    return json(saveRevision === null ? mapped.body : { ...mapped.body, save_revision: saveRevision }, mapped.status)
  }
}
