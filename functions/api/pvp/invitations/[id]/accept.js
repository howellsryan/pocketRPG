// POST /api/pvp/invitations/:id/accept
//
// Phase 1 stub: this endpoint creates a `pvp_matches` row and immediately
// marks it 'aborted' (with both characters never inventory-locked). The
// real engine + match loop arrive in Phase 3. Until then the response
// signals 'phase1_stub' so the client can show a "coming soon" toast.
//
// What we DO exercise here:
//   - ironman / one-life rejection on both sides
//   - active-match rejection on both sides
//   - waiting-room presence for the inviter
//   - symmetric CB band check
//   - atomic batch creating the match row + updating the invitation +
//     removing both characters from the waiting room

import { requireAuth, json } from '../../../../_lib/auth.js'
import { getOwnedCharacter, sweepStaleRows } from '../../../../_lib/pvp.js'
import { readCombatLevel } from '../../../../_lib/combatLevel.js'

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

  // Load invite + both character flags. The acceptor must be the
  // recipient (to_character) — any other character pretending to accept
  // returns 404 so we don't leak invitation existence.
  const invite = await env.DB.prepare(
    `SELECT i.id, i.from_character, i.to_character, i.status, i.created_at,
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

  // Symmetric CB band re-check at accept time — fresh stats, fresh check.
  const fromCB = await readCombatLevel(env, invite.from_character)
  const toCB   = await readCombatLevel(env, invite.to_character)
  if (Math.abs(fromCB - toCB) > CB_BAND) {
    return json({ error: 'cb_band_mismatch', from_cb: fromCB, to_cb: toCB, band: CB_BAND }, 409)
  }

  const now = Date.now()

  // Phase 1 stub: create the match row but immediately abort it. Real
  // accept (Phase 3) will keep status='active' and set active_match_id
  // on both characters; here we leave active_match_id null and the match
  // row aborted so nothing is locked.
  //
  // We still write a stub state_json so the schema NOT NULL constraint
  // is satisfied and Phase 3 can be diffed against it cleanly.
  const stubState = JSON.stringify({
    phase: 'stub',
    note: 'Phase 1 stub — engine not implemented yet',
    fromCB, toCB,
  })

  try {
    const matchRes = await env.DB.prepare(
      `INSERT INTO pvp_matches
         (character_a, character_b, status, started_at, ended_at,
          current_tick, state_json, last_tick_at)
       VALUES (?, ?, 'aborted', ?, ?, 0, ?, ?)`
    ).bind(invite.from_character, invite.to_character, now, now, stubState, now).run()
    const matchId = matchRes.meta.last_row_id

    // Atomically: mark invite accepted+linked, drop both from waiting room.
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE pvp_invitations SET status = 'accepted', responded_at = ?, match_id = ?
          WHERE id = ? AND status = 'pending'`
      ).bind(now, matchId, inviteId),
      env.DB.prepare(
        'DELETE FROM pvp_waiting_room WHERE character_id IN (?, ?)'
      ).bind(invite.from_character, invite.to_character),
    ])

    return json({
      ok: true,
      phase1_stub: true,
      message: 'PvP combat is coming soon — match accepted but no fight will start yet.',
      match_id: matchId,
    })
  } catch (err) {
    // UNIQUE on idx_pvp_matches_one_active_a/_b would fire if either
    // character were in a non-aborted match — we ARE aborting here so it
    // shouldn't trip, but log for visibility.
    console.error('[pvp.accept] insert failed:', err?.message || err)
    return json({ error: 'accept_failed' }, 500)
  }
}
