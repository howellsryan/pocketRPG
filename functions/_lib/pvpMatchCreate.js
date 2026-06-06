// Shared match-creation logic used by both the human accept path
// (invitations/[id]/accept.js) and the bot auto-accept path
// (invitations/index.js when to_character.is_bot is set).
//
// The caller is responsible for all pre-flight checks (CB band, account
// type, active-match guard) BEFORE calling createMatch. This module only
// handles the atomic DB writes and state construction.

import { createPvpState } from '../../src/engine/pvpEngine.js'
import { buildCombatantFromSave, readCharacterSave } from './pvpMatch.js'
import { applyPvpRankToCombatant, readCharacterPvpRank } from './pvpRanks.js'
import { buildBotSavePayload, getBotTemplate } from './pvpBot.js'

const CB_BAND      = 10
const STALE_SAVE_MS = 15_000

// Build a combatant from a live DB save row.
async function loadCombatantFromDB(env, characterId, username) {
  const save = await readCharacterSave(env, characterId)
  if (!save) return { error: 'missing_save_data' }
  return { save, combatant: buildCombatantFromSave({ characterId, username, savePayload: save.payload }) }
}

// Build a combatant from a bot template (no staleness check).
function loadBotCombatant(characterId, username, templateId) {
  const template = getBotTemplate(templateId)
  if (!template) return { error: 'bot_template_not_found' }
  const payload   = buildBotSavePayload(template)
  const combatant = buildCombatantFromSave({ characterId, username, savePayload: payload })
  // Mark the combatant so the tick handler can identify it for AI injection.
  combatant.isBot = true
  return { combatant }
}

/**
 * Create an active PvP match between fromChar and toChar.
 *
 * @param {object} env         - Cloudflare env (env.DB)
 * @param {object} fromChar    - { id, username, is_bot?, bot_template_id? }
 * @param {object} toChar      - { id, username, is_bot?, bot_template_id? }
 * @param {number} now         - Date.now()
 * @param {object} [opts]
 * @param {number} [opts.invitationId] - if set, mark that invitation accepted
 *
 * Returns: { ok: true, matchId } | { error: string, status: number }
 */
export async function createMatch(env, fromChar, toChar, now, opts = {}) {
  // Load combatants — bots use template payload; humans use live save.
  let fromResult, toResult

  if (fromChar.is_bot) {
    fromResult = loadBotCombatant(fromChar.id, fromChar.username, fromChar.bot_template_id)
  } else {
    fromResult = await loadCombatantFromDB(env, fromChar.id, fromChar.username)
    if (fromResult.error) return { error: fromResult.error, status: 409 }
    if (now - fromResult.save.updatedAt > STALE_SAVE_MS) {
      return { error: 'stale_save', forCharacters: [fromChar.id], status: 409 }
    }
  }

  if (toChar.is_bot) {
    toResult = loadBotCombatant(toChar.id, toChar.username, toChar.bot_template_id)
  } else {
    toResult = await loadCombatantFromDB(env, toChar.id, toChar.username)
    if (toResult.error) return { error: toResult.error, status: 409 }
    if (now - toResult.save.updatedAt > STALE_SAVE_MS) {
      return { error: 'stale_save', forCharacters: [toChar.id], status: 409 }
    }
  }

  if (fromResult.error) return { error: fromResult.error, status: 409 }
  if (toResult.error)   return { error: toResult.error,   status: 409 }

  const [fromRank, toRank] = await Promise.all([
    readCharacterPvpRank(env, fromChar.id),
    readCharacterPvpRank(env, toChar.id),
  ])

  const aCombatant = applyPvpRankToCombatant(fromResult.combatant, fromRank)
  const bCombatant = applyPvpRankToCombatant(toResult.combatant,   toRank)
  const state      = createPvpState(aCombatant, bCombatant, now, Math.floor(Math.random() * 2_147_483_647))

  try {
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
      fromChar.id, toChar.id, now, JSON.stringify(state), now,
      fromChar.id, toChar.id, fromChar.id, toChar.id,
    ).run()

    if (insertRes.meta.changes !== 1) {
      return { error: 'character_in_active_match', status: 409 }
    }

    const matchId = insertRes.meta.last_row_id

    const lockRows = await env.DB.prepare(
      `UPDATE characters SET active_match_id = ?
        WHERE id IN (?, ?) AND active_match_id IS NULL`
    ).bind(matchId, fromChar.id, toChar.id).run()

    if (lockRows.meta.changes !== 2) {
      await env.DB.prepare(
        "UPDATE pvp_matches SET status = 'aborted', ended_at = ? WHERE id = ? AND status = 'active'"
      ).bind(now, matchId).run()
      return { error: 'character_in_active_match', status: 409 }
    }

    if (opts.invitationId) {
      await env.DB.prepare(
        `UPDATE pvp_invitations SET status = 'accepted', responded_at = ?, match_id = ?
          WHERE id = ? AND status = 'pending'`
      ).bind(now, matchId, opts.invitationId).run()
    }

    // Remove both sides from the waiting room (bots aren't in the table, so
    // this is a harmless no-op for the bot side).
    await env.DB.prepare(
      'DELETE FROM pvp_waiting_room WHERE character_id IN (?, ?)'
    ).bind(fromChar.id, toChar.id).run()

    return { ok: true, matchId }
  } catch (err) {
    console.error('[pvpMatchCreate] match creation failed:', err?.message || err)
    return { error: 'match_creation_failed', status: 500 }
  }
}
