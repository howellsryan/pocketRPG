import { requireAuth, json } from '../../../../_lib/auth.js'
import { getOwnedCharacter, sweepStaleRows } from '../../../../_lib/pvp.js'
import { readOwnedActiveMatch } from '../../../../_lib/pvpMatch.js'

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  const matchId = parseInt(params.id, 10)
  if (!Number.isFinite(matchId)) return json({ error: 'Invalid match id' }, 400)

  await sweepStaleRows(env)

  const found = await readOwnedActiveMatch(env, matchId, ch.id)
  if (found.error) return json({ error: found.error }, found.status)
  if (found.row.status !== 'active') return json({ error: 'match_not_active' }, 409)

  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const tickNumber = parseInt(body?.tick_number, 10)
  if (!Number.isFinite(tickNumber) || tickNumber < 0 || tickNumber > (found.row.current_tick + 1)) {
    return json({ error: 'invalid_tick_number' }, 400)
  }
  if (!body?.action || typeof body.action !== 'object') {
    return json({ error: 'invalid_action' }, 400)
  }

  const maxSeqRow = await env.DB.prepare(
    'SELECT COALESCE(MAX(character_seq), 0) AS max_seq FROM pvp_intents WHERE match_id = ? AND character_id = ?'
  ).bind(matchId, ch.id).first()
  const nextSeq = (maxSeqRow?.max_seq || 0) + 1
  const now = Date.now()

  const insert = await env.DB.prepare(
    `INSERT INTO pvp_intents (match_id, character_id, tick_number, character_seq, action_json, created_at, applied)
     VALUES (?, ?, ?, ?, ?, ?, 0)`
  ).bind(matchId, ch.id, tickNumber, nextSeq, JSON.stringify(body.action), now).run()

  return json({
    ok: true,
    intent: {
      id: insert.meta.last_row_id,
      match_id: matchId,
      character_id: ch.id,
      tick_number: tickNumber,
      character_seq: nextSeq,
      created_at: now,
    },
  }, 201)
}
