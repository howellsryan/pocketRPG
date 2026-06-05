// Shared helpers for PvP endpoints and the inventory-lock guard used by
// non-PvP endpoints (save / idle / purchase / skip-hour).
//
// While a character is in an `active` PvP match, all per-character
// mutations must go through the match server — otherwise the loser could
// dump items, cast spells from a different tab, or buy gear mid-fight.
// `characters.active_match_id` is set on match start and cleared on match
// end. We treat it as the single source of truth for the lock.
//
// Defence in depth: the optimistic guard on `saves.updated_at` in the
// match writeback batch is a second line of defence in case the lock is
// somehow stale.

import { json } from './auth.js'
import { resetBotSave } from './pvpBot.js'

// Returns null if the character is free to mutate, or a Response with a
// 409 'character_in_active_match' body. Endpoints should:
//   const lock = await assertNotInActiveMatch(env, characterId)
//   if (lock) return lock
export async function assertNotInActiveMatch(env, characterId) {
  const row = await env.DB.prepare(
    'SELECT active_match_id FROM characters WHERE id = ?'
  ).bind(characterId).first()
  if (row?.active_match_id) {
    const activeMatch = await env.DB.prepare("SELECT id FROM pvp_matches WHERE id = ? AND status = 'active'").bind(row.active_match_id).first()
    if (activeMatch?.id) {
      return json(
        { error: 'character_in_active_match', match_id: row.active_match_id },
        409,
      )
    }
    await env.DB.prepare('UPDATE characters SET active_match_id = NULL WHERE id = ? AND active_match_id = ?').bind(characterId, row.active_match_id).run()
  }

  // Defence in depth for any stale/null active_match_id rows:
  // enforce "character not present in any active pvp_matches row"
  // across BOTH columns.
  const activeRow = await env.DB.prepare(
    `SELECT id
       FROM pvp_matches
      WHERE status = 'active'
        AND (character_a = ? OR character_b = ?)
      LIMIT 1`
  ).bind(characterId, characterId).first()
  if (activeRow?.id) {
    return json(
      { error: 'character_in_active_match', match_id: activeRow.id },
      409,
    )
  }
  return null
}

// Sweep stale waiting-room rows and timed-out matches. Called from every
// PvP endpoint and from PUT /api/save so cleanup happens on natural
// traffic — Cloudflare Pages Functions have no scheduler.
//
// Thresholds:
//   - Waiting-room heartbeat: 30s. Any row with last_seen_at older than
//     that gets dropped, so closed tabs don't leave ghost entries.
//   - Active match stall: 15s with no tick advance. Such matches are
//     marked 'aborted' and both characters' active_match_id is cleared.
//     No loot transfer for an aborted match — the engine never resolved
//     a winner, so it's safest to leave inventories untouched.
export async function sweepStaleRows(env) {
  const now = Date.now()
  const waitingCutoff = now - 30_000
  const matchCutoff = now - 15_000

  // We avoid env.DB.batch() here because the operations are independent
  // and partial failure is fine — next sweep tries again.
  try {
    await env.DB.prepare(
      'DELETE FROM pvp_waiting_room WHERE last_seen_at < ?'
    ).bind(waitingCutoff).run()
  } catch (e) {
    console.error('[pvp.sweep] waiting cleanup failed:', e?.message || e)
  }

  try {
    // Find stalled active matches first, so we can clear the matching
    // active_match_id columns on characters in the same pass.
    const stalled = await env.DB.prepare(
      `SELECT m.id, m.character_a, m.character_b,
              ca.is_bot AS a_is_bot, cb.is_bot AS b_is_bot
         FROM pvp_matches m
         JOIN characters ca ON ca.id = m.character_a
         JOIN characters cb ON cb.id = m.character_b
        WHERE m.status = 'active' AND m.last_tick_at < ?`
    ).bind(matchCutoff).all()

    for (const m of stalled.results || []) {
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE pvp_matches SET status = 'aborted', ended_at = ? WHERE id = ? AND status = 'active'"
        ).bind(now, m.id),
        env.DB.prepare(
          'UPDATE characters SET active_match_id = NULL WHERE id IN (?, ?) AND active_match_id = ?'
        ).bind(m.character_a, m.character_b, m.id),
      ])
      // Reset any bot involved in the stalled match so it's ready for next fight.
      if (m.a_is_bot) await resetBotSave(env, m.character_a).catch(() => {})
      if (m.b_is_bot) await resetBotSave(env, m.character_b).catch(() => {})
    }
  } catch (e) {
    console.error('[pvp.sweep] match cleanup failed:', e?.message || e)
  }

  // Auto-expire stale pending invitations. Without this the unique
  // partial index on (from_character, to_character) WHERE status='pending'
  // would permanently block re-inviting the same person if the original
  // invite was never accepted or declined.
  try {
    const inviteCutoff = now - 60_000   // 60s pending lifetime
    await env.DB.prepare(
      "UPDATE pvp_invitations SET status = 'expired', responded_at = ? WHERE status = 'pending' AND created_at < ?"
    ).bind(now, inviteCutoff).run()
  } catch (e) {
    console.error('[pvp.sweep] invitation expiry failed:', e?.message || e)
  }

  // Long-tail cleanup of completed/aborted match rows + their intents.
  // Keep retention policy and clear FK-like references before deleting matches.
  try {
    const matchRetention = now - 86_400_000   // 24h
    const intentRetention = now - 3_600_000   // 1h

    // Optional defensive cleanup: if a character lock points at a missing
    // or non-active match, clear it to avoid stale mutation locks.
    await env.DB.prepare(
      `UPDATE characters
          SET active_match_id = NULL
        WHERE active_match_id IS NOT NULL
          AND active_match_id IN (
            SELECT c.active_match_id
              FROM characters c
              LEFT JOIN pvp_matches m ON m.id = c.active_match_id
             WHERE c.active_match_id IS NOT NULL
               AND (m.id IS NULL OR m.status != 'active')
          )`
    ).run()

    await env.DB.batch([
      env.DB.prepare(
        "UPDATE pvp_invitations SET match_id = NULL WHERE match_id IN (SELECT id FROM pvp_matches WHERE status != 'active' AND ended_at IS NOT NULL AND ended_at < ?)"
      ).bind(matchRetention),
      env.DB.prepare(
        "DELETE FROM pvp_intents WHERE match_id IN (SELECT id FROM pvp_matches WHERE status != 'active' AND ended_at IS NOT NULL AND ended_at < ?)"
      ).bind(intentRetention),
      env.DB.prepare(
        "DELETE FROM pvp_matches WHERE status != 'active' AND ended_at IS NOT NULL AND ended_at < ?"
      ).bind(matchRetention),
    ])
  } catch (e) {
    console.error('[pvp.sweep] retention cleanup failed (invites/intents/matches):', e?.message || e)
  }
}

// Resolve a character_id from headers/query, mirroring the pattern used
// in functions/api/save.js. Returns { id } or { error, status }.
export async function getOwnedCharacter(request, env, identityId) {
  const url = new URL(request.url)
  const headerId = request.headers.get('X-Character-Id')
  const queryId = url.searchParams.get('character_id')
  const idStr = headerId || queryId
  if (!idStr) return { error: 'Missing X-Character-Id header', status: 400 }
  const id = parseInt(idStr, 10)
  if (!Number.isFinite(id)) return { error: 'Invalid character id', status: 400 }

  const row = await env.DB.prepare(
    'SELECT id, username, is_ironman, is_one_life FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
  ).bind(id, identityId).first()
  if (!row) return { error: 'Character not found', status: 404 }
  return {
    id: row.id,
    username: row.username,
    isIronman: !!row.is_ironman,
    isOneLife: !!row.is_one_life,
  }
}
