import { requireAuth, json } from '../../_lib/auth.js'
import { assertNotInActiveMatch } from '../../_lib/pvp.js'
import { auditLog } from '../../_lib/game/audit.js'

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

  const lock = await assertNotInActiveMatch(env, ch.id)
  if (lock) return lock

  let body = {}
  try { body = await request.json() } catch { body = {} }

  const { taskId, slot, date } = body
  if (!taskId || slot === undefined || slot === null || !date) {
    return json({ error: 'Missing required fields: taskId, slot, date' }, 400)
  }

  const now = Date.now()

  // Atomic: flip credited=0→1, set progress=target, record completion time.
  // credited=0 guard is the idempotency point — concurrent replays get no row.
  const claimed = await env.DB.prepare(`
    UPDATE character_daily_tasks
       SET progress = target, completed_at = ?1, credited = 1
     WHERE character_id = ?2 AND task_date = ?3 AND slot = ?4
       AND task_id = ?5 AND credited = 0
    RETURNING task_id, tier
  `).bind(now, ch.id, date, slot, taskId).first()

  if (!claimed) {
    // Already credited or no such issued task — idempotent no-op
    return json({ ok: true, alreadyCompleted: true, creditsGranted: 0 })
  }

  const grant = await env.DB.prepare(`
    UPDATE characters SET credits = credits + 1
     WHERE id = ?1 AND owner_id = ?2 AND deleted_at IS NULL
    RETURNING credits
  `).bind(ch.id, auth.identity.id).first()

  await auditLog(env, 'daily_task.completed', {
    characterId: ch.id,
    identityId: auth.identity.id,
    taskId,
    tier: claimed.tier,
    credits_remaining: grant?.credits ?? 0,
  }, { swallow: true })

  return json({ ok: true, taskId, creditsGranted: 1, credits: grant?.credits ?? 0 })
}
