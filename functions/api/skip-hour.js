import { requireAuth, json } from '../_lib/auth.js'
import { assertNotInActiveMatch } from '../_lib/pvp.js'

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const characterId = parseInt(request.headers.get('X-Character-Id') || '0', 10)
  if (!characterId) {
    return json({ error: 'Missing X-Character-Id header' }, 400)
  }

  try {
    // Verify character exists and belongs to authenticated user, and check credits in one query
    const character = await env.DB.prepare(
      'SELECT id, credits FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
    ).bind(characterId, auth.identity.id).first()

    if (!character) {
      return json({ error: 'Character not found' }, 404)
    }

    // PvP inventory lock: skip-hour mutates idle state, must wait for match end.
    const lock = await assertNotInActiveMatch(env, characterId)
    if (lock) return lock

    // Verify character has at least 1 credit
    if ((character.credits ?? 0) < 1) {
      return json({ error: 'Insufficient credits' }, 402)
    }

    // Atomically deduct 1 credit
    await env.DB.prepare(
      'UPDATE characters SET credits = credits - 1 WHERE id = ?'
    ).bind(characterId).run()

    return json({ ok: true, credits_remaining: (character.credits ?? 0) - 1 })
  } catch (err) {
    console.error('[PocketRPG] Skip hour error:', err)
    return json({ error: 'Server error processing skip' }, 500)
  }
}
