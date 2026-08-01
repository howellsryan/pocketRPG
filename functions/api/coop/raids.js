import { requireAuth, json } from '../../_lib/auth.js'
import { getOwnedCharacter } from '../../_lib/character.js'
import { activeSessionIdFor, sweepStaleCoopSessions } from '../../_lib/game/coopBoss.js'
import { activeRaidPartyFor, coopRaidCatalogue, listOpenRaidParties } from '../../_lib/game/coopRaid.js'

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  // Same reason the boss picker sweeps: an abandoned room holds save locks, and
  // this reads first and only writes when something is actually stale.
  await sweepStaleCoopSessions(env)

  const partiesByRaid = await listOpenRaidParties(env)
  const raids = coopRaidCatalogue().map((raid) => ({
    ...raid,
    parties: partiesByRaid.get(raid.raidId) || [],
  }))

  return json({
    ok: true,
    raids,
    activeSessionId: await activeSessionIdFor(env, ch.id),
    activeParty: await activeRaidPartyFor(env, ch.id),
  })
}
