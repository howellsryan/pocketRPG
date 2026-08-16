import { requireAuth, json } from '../../_lib/auth.js'
import { getOwnedCharacter } from '../../_lib/character.js'
import { utcDayKey, nextResetMs } from '../../_lib/game/dailyTasks.js'
import { applyDailyTaskEvents } from '../../_lib/game/dailyTaskProgress.js'

// Batched daily-task progress from the idle client: the same game events
// recordGameEvent matches locally, replayed here so progress survives a reload
// and composes with progress the open world wrote while the client was gone.
// Deliberately client-trusted, in the same band as /api/save's XP (§14) — the
// completion call this replaces was already unverified, so nothing new is
// trusted; the credit grant itself stays atomic and idempotent.
export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  let body = {}
  try { body = await request.json() } catch { body = {} }

  // A client whose tab has been open across midnight UTC would otherwise write
  // yesterday's progress onto today's rows.
  const dateKey = utcDayKey()
  if (typeof body?.date === 'string' && body.date !== dateKey) {
    return json({ error: 'Stale task date', code: 'DAILY_TASKS_ROLLED_OVER', date: dateKey, resetInMs: nextResetMs() }, 409)
  }

  const result = await applyDailyTaskEvents(env, {
    characterId: ch.id,
    identityId: auth.identity.id,
    events: body?.events,
  })

  return json({ ok: true, resetInMs: nextResetMs(), ...result })
}
