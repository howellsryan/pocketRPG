// PvP Waiting Room
//
// POST   /api/pvp/waiting   join + heartbeat
// DELETE /api/pvp/waiting   leave
// GET    /api/pvp/waiting   list players currently waiting
//
// Visibility rule: caller sees only opponents within their combat level
// ±10 inclusive. The same check is enforced again on invite-send so a
// stale lobby snapshot can't be exploited to invite outside the band.
//
// Ironman / one-life characters are blocked entirely from the lobby.

import { requireAuth, json } from '../../_lib/auth.js'
import { getOwnedCharacter, sweepStaleRows, assertNotInActiveMatch } from '../../_lib/pvp.js'
import { readCombatLevel } from '../../_lib/combatLevel.js'
import { buildWaitingList } from '../../_lib/pvpLobby.js'

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  if (ch.isIronman || ch.isOneLife) {
    return json({ error: 'pvp_not_allowed_for_account_type' }, 403)
  }

  // Already in a match? Reject — the client should be on the combat
  // screen, not the lobby.
  const lock = await assertNotInActiveMatch(env, ch.id)
  if (lock) return lock

  // Best-effort sweep so the lobby list this caller will read next is fresh.
  await sweepStaleRows(env)

  const combatLevel = await readCombatLevel(env, ch.id)
  const now = Date.now()

  // Upsert: joining and heartbeating are the same operation.
  await env.DB.prepare(
    `INSERT INTO pvp_waiting_room (character_id, combat_level, joined_at, last_seen_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(character_id) DO UPDATE SET
       combat_level  = excluded.combat_level,
       last_seen_at  = excluded.last_seen_at`
  ).bind(ch.id, combatLevel, now, now).run()

  return json({ ok: true, combat_level: combatLevel, last_seen_at: now })
}

export async function onRequestDelete({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  await env.DB.prepare(
    'DELETE FROM pvp_waiting_room WHERE character_id = ?'
  ).bind(ch.id).run()

  return json({ ok: true })
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  if (ch.isIronman || ch.isOneLife) {
    return json({ error: 'pvp_not_allowed_for_account_type' }, 403)
  }

  await sweepStaleRows(env)

  // Caller's CB defines their own visibility band. Refresh it from the
  // save in case stats have changed since join.
  const myCB = await readCombatLevel(env, ch.id)
  const { band, waiting } = await buildWaitingList(env, ch.id, myCB)

  return json({ my_combat_level: myCB, band, waiting })
}
