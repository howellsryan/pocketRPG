import { requireAuth, json } from '../../../_lib/auth.js'
import { getOwnedCharacter } from '../../../_lib/pvp.js'
import { readSession, parseSessionState } from '../../../_lib/game/coopBoss.js'

export async function onRequestGet({ request, env, params }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  const sessionId = parseInt(params.id, 10)
  if (!Number.isFinite(sessionId)) return json({ error: 'Invalid session id' }, 400)

  const row = await readSession(env, sessionId)
  if (!row) return json({ error: 'coop_session_not_found' }, 404)

  const state = parseSessionState(row)
  if (!state?.members?.[String(ch.id)]) return json({ error: 'not_a_member' }, 403)

  return json({
    ok: true,
    sessionId,
    bossId: row.boss_id,
    status: row.status,
    state,
    current_tick: row.current_tick,
    last_tick_at: row.last_tick_at,
  })
}
