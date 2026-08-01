import { requireAuth, json } from '../../../_lib/auth.js'
import { getOwnedCharacter } from '../../../_lib/character.js'
import { readSession, parseSessionState, parseCoopSessionId } from '../../../_lib/game/coopBoss.js'
import { projectStateForMember } from '../../../_lib/game/coopProjection.js'

/** Last-checkpointed view of a fight, for a client rejoining before its first
 * poll lands. The live copy is the room's; this is the D1 mirror. */
export async function onRequestGet({ request, env, params }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  const sessionId = parseCoopSessionId(params.id)
  if (sessionId === null) return json({ error: 'Invalid session id' }, 400)

  const row = await readSession(env, sessionId)
  if (!row) return json({ error: 'coop_session_not_found' }, 404)

  const state = parseSessionState(row)
  if (!state?.members?.[String(ch.id)]) return json({ error: 'not_a_member' }, 403)

  return json({
    ok: true,
    sessionId,
    bossId: row.boss_id,
    status: row.status,
    // Projected, never raw: the state carries every member's pack, worn gear,
    // skill levels and quest list, and none of that is anyone else's business.
    state: projectStateForMember(state, ch.id),
    current_tick: row.current_tick,
    last_tick_at: row.last_tick_at,
  })
}
