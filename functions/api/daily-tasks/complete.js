import { requireAuth, json } from '../../_lib/auth.js'
import { claimDailyTaskCredit } from '../../_lib/game/dailyTaskProgress.js'

async function resolveCharacterId(request, env, identityId) {
  const headerId = request.headers.get('X-Character-Id')
  const id = parseInt(headerId || '0', 10)
  if (!id) return { error: 'Missing X-Character-Id header', status: 400 }
  const row = await env.DB.prepare(
    'SELECT id FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
  ).bind(id, identityId).first()
  if (!row) return { error: 'Character not found', status: 404 }
  return { id }
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await resolveCharacterId(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)


  let body = {}
  try { body = await request.json() } catch { body = {} }

  const { taskId, slot, date } = body
  if (!taskId || slot === undefined || slot === null || !date) {
    return json({ error: 'Missing required fields: taskId, slot, date' }, 400)
  }

  // Atomic: flip credited=0→1, set progress=target, record completion time and
  // pay the credit. Shared with the progress endpoint and the world's flush, so
  // whichever of them reaches the target first is the one that pays.
  const claim = await claimDailyTaskCredit(env, {
    characterId: ch.id,
    identityId: auth.identity.id,
    dateKey: date,
    slot,
    taskId,
  })

  if (claim.creditsGranted === 0) {
    // Already credited or no such issued task — idempotent no-op
    return json({ ok: true, alreadyCompleted: true, creditsGranted: 0 })
  }

  return json({ ok: true, taskId, creditsGranted: 1, credits: claim.credits ?? 0 })
}
