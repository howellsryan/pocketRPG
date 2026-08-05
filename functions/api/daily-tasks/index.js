import { requireAuth, json } from '../../_lib/auth.js'
import { getOwnedCharacter } from '../../_lib/character.js'
import { utcDayKey, nextResetMs, ensureDailyTasks } from '../../_lib/game/dailyTasks.js'

// /api/bootstrap returns this same payload as its `dailyTasks` field, issuance
// included — the credit grant stays in ./complete.js either way (§14).
export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
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
