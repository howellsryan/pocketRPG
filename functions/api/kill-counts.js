import { requireAuth, json } from '../_lib/auth.js'
import { getOwnedCharacter } from '../_lib/character.js'
import { killCountsStatement, mapKillCounts } from '../_lib/game/characterReads.js'

// Server-authoritative boss/raid kill counts live in the kill_counts table
// (migration 0019), written only by the action completion endpoints. This
// endpoint is read-only: the client fetches counts on boot and displays them.
// /api/bootstrap returns this same payload as its `killCounts` field.
export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  return json({ entries: mapKillCounts(await killCountsStatement(env, ch.id).all()) })
}
