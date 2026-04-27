import { requireAuth, json } from '../../../../_lib/auth.js'
import { getOwnedCharacter } from '../../../../_lib/pvp.js'

// Forfeit is represented as a normal intent consumed by the tick endpoint.
// We set tick_number = current_tick so the next /tick call resolves it
// immediately under the regular terminal + loot transfer path.
export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  const matchId = parseInt(params.id, 10)
  if (!Number.isFinite(matchId)) return json({ error: 'Invalid match id' }, 400)

  const match = await env.DB.prepare(
    `SELECT id, status, current_tick
       FROM pvp_matches
      WHERE id = ?
        AND (character_a = ? OR character_b = ?)`
  ).bind(matchId, ch.id, ch.id).first()

  if (!match) return json({ error: 'match_not_found' }, 404)
  if (match.status !== 'active') return json({ error: 'match_not_active' }, 409)

  const maxSeqRow = await env.DB.prepare(
    'SELECT COALESCE(MAX(character_seq), 0) AS max_seq FROM pvp_intents WHERE match_id = ? AND character_id = ?'
  ).bind(matchId, ch.id).first()
  const nextSeq = (maxSeqRow?.max_seq || 0) + 1
  const now = Date.now()

  await env.DB.prepare(
    `INSERT INTO pvp_intents (match_id, character_id, tick_number, character_seq, action_json, created_at, applied)
     VALUES (?, ?, ?, ?, ?, ?, 0)`
  ).bind(matchId, ch.id, match.current_tick, nextSeq, JSON.stringify({ type: 'forfeit' }), now).run()

  return json({ ok: true, queued: 'forfeit', tick_number: match.current_tick })
}
