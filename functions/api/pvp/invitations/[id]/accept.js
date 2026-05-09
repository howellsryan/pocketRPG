// POST /api/pvp/invitations/:id/accept
//
// Phase 3: real match creation.
//
// Atomic flow:
//   - validate pending invitation + account restrictions + CB band
//   - require both saves to be fresh (<= 15s old)
//   - build canonical initial PvP state from both save snapshots
//   - INSERT active pvp_matches row
//   - set both characters.active_match_id to the new match
//   - mark invitation accepted and remove both waiting-room rows

import { requireAuth, json } from '../../../../_lib/auth.js'
import { getOwnedCharacter, sweepStaleRows } from '../../../../_lib/pvp.js'
import { readCombatLevel } from '../../../../_lib/combatLevel.js'
import { createPvpState } from '../../../../../src/engine/pvpEngine.js'
import { buildCombatantFromSave, readCharacterSave } from '../../../../_lib/pvpMatch.js'
import { applyPvpRankToCombatant, readCharacterPvpRank } from '../../../../_lib/pvpRanks.js'

const CB_BAND = 10
const STALE_SAVE_MS = 15_000

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

  if (ch.active_match_id) {
    console.log('[PocketRPG][PvP] accept idempotent already_in_match:', { characterId: ch.id, matchId: ch.active_match_id })
    return json({ ok: true, already_in_match: true, match_id: ch.active_match_id })
  }

  const inviteAnyStatus = await env.DB.prepare(
    `SELECT i.id, i.from_character, i.to_character, i.status, i.match_id,
            ca.username AS from_username,
            cb.username AS to_username,
            ca.is_ironman AS from_ironman, ca.is_one_life AS from_one_life,
            ca.active_match_id AS from_active_match,
            cb.is_ironman AS to_ironman, cb.is_one_life AS to_one_life,
            cb.active_match_id AS to_active_match
       FROM pvp_invitations i
       JOIN characters ca ON ca.id = i.from_character
       JOIN characters cb ON cb.id = i.to_character
      WHERE i.id = ? AND i.to_character = ?`
  ).bind(inviteId, ch.id).first()

  if (!inviteAnyStatus) return json({ error: 'Invitation not found' }, 404)
  if (inviteAnyStatus.status === 'accepted' && inviteAnyStatus.match_id) {
    console.log('[PocketRPG][PvP] accept idempotent already_accepted:', { invitationId: inviteId, matchId: inviteAnyStatus.match_id })
    return json({ ok: true, already_accepted: true, match_id: inviteAnyStatus.match_id })
  }

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

  if (!invite) return json({ error: 'invitation_not_pending' }, 409)
  if (invite.from_ironman || invite.from_one_life || invite.to_ironman || invite.to_one_life) {
    return json({ error: 'pvp_not_allowed_for_account_type' }, 403)
  }
  if (invite.from_active_match || invite.to_active_match) {
    const knownMatchId = invite.to_active_match || invite.from_active_match || null
    const sameMatch = invite.from_active_match && invite.to_active_match && invite.from_active_match === invite.to_active_match
    if (sameMatch || invite.to_active_match) {
      console.log('[PocketRPG][PvP] accept fast-path active match:', {
        invitationId: inviteId,
        fromCharacter: invite.from_character,
        toCharacter: invite.to_character,
        matchId: knownMatchId,
      })
      return json({ ok: true, already_in_match: true, match_id: knownMatchId })
    }
    return json({ error: 'character_in_active_match', match_id: knownMatchId }, 409)
  }

  const fromCB = await readCombatLevel(env, invite.from_character)
  const toCB = await readCombatLevel(env, invite.to_character)
  if (Math.abs(fromCB - toCB) > CB_BAND) {
    return json({ error: 'cb_band_mismatch', from_cb: fromCB, to_cb: toCB, band: CB_BAND }, 409)
  }

  const fromSave = await readCharacterSave(env, invite.from_character)
  const toSave = await readCharacterSave(env, invite.to_character)
  if (!fromSave || !toSave) {
    return json({ error: 'missing_save_blob' }, 409)
  }

  const now = Date.now()
  const staleCharacters = []
  if (now - fromSave.updatedAt > STALE_SAVE_MS) staleCharacters.push(invite.from_character)
  if (now - toSave.updatedAt > STALE_SAVE_MS) staleCharacters.push(invite.to_character)
  if (staleCharacters.length) {
    console.log('[PocketRPG][PvP] accept stale save:', {
      invitationId: inviteId,
      staleCharacters,
      now,
      fromUpdatedAt: fromSave.updatedAt,
      toUpdatedAt: toSave.updatedAt,
    })
    return json({
      error: 'stale_save',
      forCharacters: staleCharacters,
      server_now: now,
      stale_save_ms: STALE_SAVE_MS,
      from_updated_at: fromSave.updatedAt,
      to_updated_at: toSave.updatedAt,
    }, 409)
  }

  const [fromRank, toRank] = await Promise.all([
    readCharacterPvpRank(env, invite.from_character),
    readCharacterPvpRank(env, invite.to_character),
  ])

  const aCombatant = applyPvpRankToCombatant(buildCombatantFromSave({
    characterId: invite.from_character,
    username: invite.from_username,
    savePayload: fromSave.payload,
  }), fromRank)
  const bCombatant = applyPvpRankToCombatant(buildCombatantFromSave({
    characterId: invite.to_character,
    username: invite.to_username,
    savePayload: toSave.payload,
  }), toRank)
  const state = createPvpState(aCombatant, bCombatant, now, Math.floor(Math.random() * 2_147_483_647))

  try {
    // One-active-match invariant across BOTH columns (character_a and
    // character_b). The partial unique indexes are per-column, so we
    // enforce the cross-column rule here at write time too.
    const insertRes = await env.DB.prepare(
      `INSERT INTO pvp_matches
         (character_a, character_b, status, started_at, current_tick, state_json, last_tick_at)
       SELECT ?, ?, 'active', ?, 0, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM pvp_matches
          WHERE status = 'active'
            AND (character_a IN (?, ?) OR character_b IN (?, ?))
       )`
    ).bind(
      invite.from_character,
      invite.to_character,
      now,
      JSON.stringify(state),
      now,
      invite.from_character,
      invite.to_character,
      invite.from_character,
      invite.to_character,
    ).run()

    if (insertRes.meta.changes !== 1) {
      return json({ error: 'character_in_active_match' }, 409)
    }

    const matchId = insertRes.meta.last_row_id
    console.log('[PocketRPG][PvP] accept created match:', { invitationId: inviteId, matchId })

    const lockRows = await env.DB.prepare(
      `UPDATE characters SET active_match_id = ?
        WHERE id IN (?, ?) AND active_match_id IS NULL`
    ).bind(matchId, invite.from_character, invite.to_character).run()
    if (lockRows.meta.changes !== 2) {
      await env.DB.prepare(
        "UPDATE pvp_matches SET status = 'aborted', ended_at = ? WHERE id = ? AND status = 'active'"
      ).bind(now, matchId).run()
      return json({ error: 'character_in_active_match', match_id: matchId }, 409)
    }

    const inviteUpdate = await env.DB.prepare(
      `UPDATE pvp_invitations SET status = 'accepted', responded_at = ?, match_id = ?
        WHERE id = ? AND status = 'pending'`
    ).bind(now, matchId, inviteId).run()
    if (inviteUpdate.meta.changes !== 1) {
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE pvp_matches SET status = 'aborted', ended_at = ? WHERE id = ? AND status = 'active'"
        ).bind(now, matchId),
        env.DB.prepare(
          'UPDATE characters SET active_match_id = NULL WHERE id IN (?, ?) AND active_match_id = ?'
        ).bind(invite.from_character, invite.to_character, matchId),
      ])
      return json({ error: 'invitation_not_pending' }, 409)
    }

    await env.DB.prepare(
      'DELETE FROM pvp_waiting_room WHERE character_id IN (?, ?)'
    ).bind(invite.from_character, invite.to_character).run()

    return json({ ok: true, match_id: matchId })
  } catch (err) {
    console.error('[pvp.accept] match creation failed:', err?.message || err)
    return json({ error: 'accept_failed' }, 500)
  }
}
