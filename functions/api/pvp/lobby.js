// PvP Lobby — merged poll endpoint.
//
// GET /api/pvp/lobby
//
// One round-trip that the lobby modal polls in place of the three separate
// calls it used to make every tick (POST /waiting heartbeat + GET /waiting +
// GET /invitations). It:
//   1. heartbeats the caller's waiting-room row (last_seen_at upsert), so the
//      30s sweep doesn't GC them while the modal is open,
//   2. returns the CB-banded waiting list, pending invitations, and the
//      caller's active_match_id in a single response.
//
// Collapsing 3 requests → 1 is the bulk of the PvP request-volume reduction.
// Lobby data is non-authoritative display state — invite-send / accept still
// re-validate server-side, so a slightly stale list here changes nothing.

import { requireAuth, json } from '../../_lib/auth.js'
import { getOwnedCharacter, sweepStaleRows } from '../../_lib/pvp.js'
import { readCombatLevel } from '../../_lib/combatLevel.js'
import { buildWaitingList, buildInvitationLists } from '../../_lib/pvpLobby.js'

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  if (ch.isIronman || ch.isOneLife) {
    return json({ error: 'pvp_not_allowed_for_account_type' }, 403)
  }

  // If a match is already active, the client belongs on the combat screen.
  // Surface the id (same as the invitations GET) so the poll loop routes there,
  // and skip the heartbeat + list work entirely — no point advertising a
  // player who's mid-match.
  const activeRow = await env.DB.prepare(
    'SELECT active_match_id FROM characters WHERE id = ?'
  ).bind(ch.id).first()
  if (activeRow?.active_match_id) {
    return json({ active_match_id: activeRow.active_match_id })
  }

  await sweepStaleRows(env)

  const combatLevel = await readCombatLevel(env, ch.id)
  const now = Date.now()

  // Heartbeat: same upsert as POST /api/pvp/waiting. Folding it into the poll
  // GET removes the separate per-tick heartbeat POST.
  await env.DB.prepare(
    `INSERT INTO pvp_waiting_room (character_id, combat_level, joined_at, last_seen_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(character_id) DO UPDATE SET
       combat_level  = excluded.combat_level,
       last_seen_at  = excluded.last_seen_at`
  ).bind(ch.id, combatLevel, now, now).run()

  const [waiting, invitations] = await Promise.all([
    buildWaitingList(env, ch.id, combatLevel),
    buildInvitationLists(env, ch.id),
  ])

  return json({
    my_combat_level: combatLevel,
    band: waiting.band,
    waiting: waiting.waiting,
    incoming: invitations.incoming,
    outgoing: invitations.outgoing,
    active_match_id: null,
  })
}
