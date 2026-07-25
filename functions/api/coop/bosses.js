import { requireAuth, json } from '../../_lib/auth.js'
import { getOwnedCharacter } from '../../_lib/pvp.js'
import {
  COOP_BOSS_IDS,
  activeSessionIdFor,
  coopBossSummary,
  listOpenSessions,
  sweepStaleCoopSessions,
} from '../../_lib/game/coopBoss.js'

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  await sweepStaleCoopSessions(env)

  const now = Date.now()
  const bosses = []
  for (const bossId of COOP_BOSS_IDS) {
    const summary = coopBossSummary(bossId)
    if (!summary) continue
    bosses.push({ ...summary, sessions: await listOpenSessions(env, bossId, now) })
  }

  return json({ ok: true, bosses, activeSessionId: await activeSessionIdFor(env, ch.id) })
}
