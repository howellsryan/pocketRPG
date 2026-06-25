import { requireAuth, json } from '../../_lib/auth.js'
import { utcDayKey, nextResetMs, ensureDailyTasks } from '../../_lib/game/dailyTasks.js'

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

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await resolveCharacterId(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  const dateKey = utcDayKey()
  const rows = await ensureDailyTasks(env, ch.id, dateKey)

  return json({
    date: dateKey,
    resetInMs: nextResetMs(),
    tasks: rows.map(r => ({
      slot: r.slot,
      taskId: r.task_id,
      tier: r.tier,
      target: r.target,
      progress: r.progress,
      completed: !!r.completed_at,
    })),
  })
}
