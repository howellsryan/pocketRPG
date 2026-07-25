import { requireAuth, json } from '../../_lib/auth.js'
import { assertNotInActiveMatch, getOwnedCharacter } from '../../_lib/pvp.js'
import { isWorldSessionLive } from '../../_lib/game/worldSessions.js'
import { joinCoopSession, readSession, parseSessionState, sweepStaleCoopSessions } from '../../_lib/game/coopBoss.js'
import { toErrorResponse } from '../../_lib/game/errors.js'

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  // A co-op session mutates the save, so it collides with every other path that
  // owns the save: an active PvP match and a live world session both win.
  const lock = await assertNotInActiveMatch(env, ch.id)
  if (lock) return lock
  if (await isWorldSessionLive(env, ch.id)) {
    return json({ error: 'character_in_world_session', code: 'CHARACTER_IN_WORLD_SESSION' }, 409)
  }

  await sweepStaleCoopSessions(env)

  try {
    const body = await request.json()
    const bossId = typeof body?.bossId === 'string' ? body.bossId : null
    if (!bossId) return json({ error: 'Missing bossId', code: 'INVALID_COOP_BOSS' }, 400)

    const { sessionId, rejoined } = await joinCoopSession(env, {
      characterId: ch.id,
      identityId: auth.identity.id,
      bossId,
      username: ch.username,
    })

    const row = await readSession(env, sessionId)
    return json({
      ok: true,
      sessionId,
      rejoined,
      state: row ? parseSessionState(row) : null,
      current_tick: row?.current_tick ?? 0,
    })
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
