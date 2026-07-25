import { requireAuth, json } from '../../_lib/auth.js'
import { getOwnedCharacter } from '../../_lib/pvp.js'
import {
  COOP_BOSS_IDS,
  activeSessionIdFor,
  coopBossSummary,
  listAllOpenSessions,
  pruneCoopExhaust,
  sweepStaleCoopSessions,
} from '../../_lib/game/coopBoss.js'

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  await sweepStaleCoopSessions(env)
  await pruneCoopExhaust(env)

  const now = Date.now()
  // One query for every boss's rooms, reading the denormalised HP columns. The
  // per-boss loop this replaces was 25 queries that each pulled state_json —
  // every member's full inventory — to render two numbers.
  const sessionsByBoss = await listAllOpenSessions(env, COOP_BOSS_IDS, now)
  const bosses = []
  for (const bossId of COOP_BOSS_IDS) {
    const summary = coopBossSummary(bossId)
    if (!summary) continue
    bosses.push({ ...summary, sessions: sessionsByBoss.get(bossId) || [] })
  }

  return json({ ok: true, bosses, activeSessionId: await activeSessionIdFor(env, ch.id) })
}
