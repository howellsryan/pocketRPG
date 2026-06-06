// POST /api/pvp/invitations/:id/accept
//
// Phase 3: real match creation (human-to-human only — bot invitations are
// auto-accepted immediately in POST /api/pvp/invitations, so this endpoint
// is never reached for a bot target).
//
// Atomic flow:
//   - validate pending invitation + account restrictions + CB band
//   - require both saves to be fresh (<= 15s old)
//   - delegate match creation to shared pvpMatchCreate helper
//   - mark invitation accepted and remove both waiting-room rows

import { requireAuth, json } from '../../../../_lib/auth.js'
import { getOwnedCharacter, sweepStaleRows } from '../../../../_lib/pvp.js'
import { readCombatLevel } from '../../../../_lib/combatLevel.js'
import { createMatch } from '../../../../_lib/pvpMatchCreate.js'

const CB_BAND = 10

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
  const toCB   = await readCombatLevel(env, invite.to_character)
  if (Math.abs(fromCB - toCB) > CB_BAND) {
    return json({ error: 'cb_band_mismatch', from_cb: fromCB, to_cb: toCB, band: CB_BAND }, 409)
  }

  const now    = Date.now()
  const result = await createMatch(
    env,
    { id: invite.from_character, username: invite.from_username },
    { id: invite.to_character,   username: invite.to_username },
    now,
    { invitationId: inviteId },
  )

  if (!result.ok) {
    console.error('[pvp.accept] match creation failed:', result.error)
    return json({ error: result.error }, result.status || 500)
  }

  console.log('[PocketRPG][PvP] accept created match:', { invitationId: inviteId, matchId: result.matchId })
  return json({ ok: true, match_id: result.matchId })
}
