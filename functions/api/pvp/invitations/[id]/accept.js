// POST /api/pvp/invitations/:id/accept
//
// Phase 3: real match creation.
//
// Atomic flow:
//   - validate pending invitation + account restrictions + CB band
//   - require both saves to be fresh (<= 5s old)
//   - build canonical initial PvP state from both save snapshots
//   - INSERT active pvp_matches row
//   - set both characters.active_match_id to the new match
//   - mark invitation accepted and remove both waiting-room rows

import { requireAuth, json } from '../../../../_lib/auth.js'
import { getOwnedCharacter, sweepStaleRows } from '../../../../_lib/pvp.js'
import { readCombatLevel } from '../../../../_lib/combatLevel.js'
import { createPvpState } from '../../../../../src/engine/pvpEngine.js'
import { buildCombatantFromSave, readCharacterSave } from '../../../../_lib/pvpMatch.js'

const CB_BAND = 10
const STALE_SAVE_MS = 5_000

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  if (ch.isIronman || ch.isOneLife) {
    return json({ error: 'pvp_not_allowed_for_account_type' }, 403)
  }

  const inviteId = parseInt(params.id, 10)
  if (!Number.isFinite(inviteId)) return json({ error: 'Invalid invitation id' }, 400)

  await sweepStaleRows(env)

  const invite = await env.DB.prepare(
    `SELECT i.id, i.from_character, i.to_character, i.status,
            ca.username AS from_username,
            cb.username AS to_username,
            ca.is_ironman AS from_ironman, ca.is_one_life AS from_one_life,
            ca.active_match_id AS from_active_match,
            cb.is_ironman AS to_ironman, cb.is_one_life AS to_one_life,
            cb.active_match_id AS to_active_match
       FROM pvp_invitations i
       JOIN characters ca ON ca.id = i.from_character
       JOIN characters cb ON cb.id = i.to_character
      WHERE i.id = ? AND i.to_character = ? AND i.status = 'pending'`
  ).bind(inviteId, ch.id).first()

  if (!invite) return json({ error: 'Invitation not found' }, 404)
  if (invite.from_ironman || invite.from_one_life || invite.to_ironman || invite.to_one_life) {
    return json({ error: 'pvp_not_allowed_for_account_type' }, 403)
  }
  if (invite.from_active_match || invite.to_active_match) {
    return json({ error: 'character_in_active_match' }, 409)
  }

  const fromCB = await readCombatLevel(env, invite.from_character)
  const toCB = await readCombatLevel(env, invite.to_character)
  if (Math.abs(fromCB - toCB) > CB_BAND) {
    return json({ error: 'cb_band_mismatch', from_cb: fromCB, to_cb: toCB, band: CB_BAND }, 409)
  }

  const fromSave = await readCharacterSave(env, invite.from_character)
  const toSave = await readCharacterSave(env, invite.to_character)
  if (!fromSave || !toSave) {
    return json({ error: 'missing_save_data' }, 409)
  }

  const now = Date.now()
  const staleCharacters = []
  if (now - fromSave.updatedAt > STALE_SAVE_MS) staleCharacters.push(invite.from_character)
  if (now - toSave.updatedAt > STALE_SAVE_MS) staleCharacters.push(invite.to_character)
  if (staleCharacters.length) {
    return json({ error: 'stale_save', forCharacters: staleCharacters }, 409)
  }

  const aCombatant = buildCombatantFromSave({
    characterId: invite.from_character,
    username: invite.from_username,
    savePayload: fromSave.payload,
  })
  const bCombatant = buildCombatantFromSave({
    characterId: invite.to_character,
    username: invite.to_username,
    savePayload: toSave.payload,
  })
  const state = createPvpState(aCombatant, bCombatant, now, Math.floor(Math.random() * 2_147_483_647))

  try {
    const insertRes = await env.DB.prepare(
      `INSERT INTO pvp_matches
         (character_a, character_b, status, started_at, current_tick, state_json, last_tick_at)
       VALUES (?, ?, 'active', ?, 0, ?, ?)`
    ).bind(invite.from_character, invite.to_character, now, JSON.stringify(state), now).run()

    const matchId = insertRes.meta.last_row_id

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE characters SET active_match_id = ?
          WHERE id IN (?, ?) AND active_match_id IS NULL`
      ).bind(matchId, invite.from_character, invite.to_character),
      env.DB.prepare(
        `UPDATE pvp_invitations SET status = 'accepted', responded_at = ?, match_id = ?
          WHERE id = ? AND status = 'pending'`
      ).bind(now, matchId, inviteId),
      env.DB.prepare(
        'DELETE FROM pvp_waiting_room WHERE character_id IN (?, ?)'
      ).bind(invite.from_character, invite.to_character),
    ])

    return json({ ok: true, match_id: matchId })
  } catch (err) {
    console.error('[pvp.accept] match creation failed:', err?.message || err)
    return json({ error: 'accept_failed' }, 500)
  }
}
