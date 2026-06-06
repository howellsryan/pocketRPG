// PvP Invitations — list / send.
//
// GET  /api/pvp/invitations   list pending invites for the caller (in + out)
// POST /api/pvp/invitations   send invite { to_character }
//
// Send-side validation:
//   - target must be in the waiting room
//   - target must be within ±10 CB of caller (symmetric — callers can't
//     invite from outside their own band even if a stale lobby snapshot
//     showed someone outside it)
//   - neither side ironman / one-life
//   - neither side already in an active match
//   - not already a pending invite from caller → target

import { requireAuth, json } from '../../../_lib/auth.js'
import { getOwnedCharacter, sweepStaleRows, assertNotInActiveMatch } from '../../../_lib/pvp.js'
import { readCombatLevel } from '../../../_lib/combatLevel.js'
import { itemsData, readCharacterSave, readCombatStatLevels } from '../../../_lib/pvpMatch.js'
import { readCharacterPvpRank } from '../../../_lib/pvpRanks.js'
import { calculatePvpRiskValues } from '../../../../src/engine/pvpRisk.js'
import { createMatch } from '../../../_lib/pvpMatchCreate.js'

const CB_BAND = 10

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)
  await sweepStaleRows(env)

  const activeRow = await env.DB.prepare(
    'SELECT active_match_id FROM characters WHERE id = ?'
  ).bind(ch.id).first()

  // List in/out pending invites with the other character's username + CB
  // for nice rendering. We filter to status='pending' only — declined and
  // accepted rows are bookkeeping for the engine, not user-facing.
  const incoming = await env.DB.prepare(
    `SELECT i.id, i.from_character, i.to_character, i.created_at,
            c.username AS from_username,
            COALESCE(w.combat_level, 0) AS from_combat_level
       FROM pvp_invitations i
       JOIN characters c ON c.id = i.from_character
  LEFT JOIN pvp_waiting_room w ON w.character_id = i.from_character
      WHERE i.to_character = ? AND i.status = 'pending'
   ORDER BY i.created_at ASC`
  ).bind(ch.id).all()

  const outgoing = await env.DB.prepare(
    `SELECT i.id, i.from_character, i.to_character, i.created_at,
            c.username AS to_username,
            COALESCE(w.combat_level, 0) AS to_combat_level
       FROM pvp_invitations i
       JOIN characters c ON c.id = i.to_character
  LEFT JOIN pvp_waiting_room w ON w.character_id = i.to_character
      WHERE i.from_character = ? AND i.status = 'pending'
   ORDER BY i.created_at ASC`
  ).bind(ch.id).all()

  const incomingWithRisk = await Promise.all((incoming.results || []).map(async (row) => {
    try {
      const [save, pvpRank] = await Promise.all([
        readCharacterSave(env, row.from_character),
        readCharacterPvpRank(env, row.from_character),
      ])
      const risk = calculatePvpRiskValues({
        inventory: save?.payload?.inventory,
        equipment: save?.payload?.equipment,
        itemsData,
      })
      return {
        ...row,
        from_inventory_shop_value: risk.inventoryShopValue,
        from_equipment_shop_value: risk.equipmentShopValue,
        from_total_shop_value: risk.totalShopValue,
        from_combat_stats: readCombatStatLevels(save?.payload),
        from_total_pvp_kills: pvpRank.totalPvpKills,
        from_last_updated_total_pvp_kills: pvpRank.lastUpdatedTotalPvpKills,
        from_pvp_rank: pvpRank.rank,
      }
    } catch {
      return {
        ...row,
        from_inventory_shop_value: 0,
        from_equipment_shop_value: 0,
        from_total_shop_value: 0,
        from_combat_stats: readCombatStatLevels(null),
        from_total_pvp_kills: 0,
        from_last_updated_total_pvp_kills: null,
        from_pvp_rank: null,
      }
    }
  }))

  const outgoingWithRisk = await Promise.all((outgoing.results || []).map(async (row) => {
    try {
      const [save, pvpRank] = await Promise.all([
        readCharacterSave(env, row.to_character),
        readCharacterPvpRank(env, row.to_character),
      ])
      const risk = calculatePvpRiskValues({
        inventory: save?.payload?.inventory,
        equipment: save?.payload?.equipment,
        itemsData,
      })
      return {
        ...row,
        to_inventory_shop_value: risk.inventoryShopValue,
        to_equipment_shop_value: risk.equipmentShopValue,
        to_total_shop_value: risk.totalShopValue,
        to_combat_stats: readCombatStatLevels(save?.payload),
        to_total_pvp_kills: pvpRank.totalPvpKills,
        to_last_updated_total_pvp_kills: pvpRank.lastUpdatedTotalPvpKills,
        to_pvp_rank: pvpRank.rank,
      }
    } catch {
      return {
        ...row,
        to_inventory_shop_value: 0,
        to_equipment_shop_value: 0,
        to_total_shop_value: 0,
        to_combat_stats: readCombatStatLevels(null),
        to_total_pvp_kills: 0,
        to_last_updated_total_pvp_kills: null,
        to_pvp_rank: null,
      }
    }
  }))

  return json({
    incoming: incomingWithRisk,
    outgoing: outgoingWithRisk,
    active_match_id: activeRow?.active_match_id || null,
  })
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  if (ch.isIronman || ch.isOneLife) {
    return json({ error: 'pvp_not_allowed_for_account_type' }, 403)
  }

  const lock = await assertNotInActiveMatch(env, ch.id)
  if (lock) return lock

  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const targetId = parseInt(body.to_character, 10)
  if (!Number.isFinite(targetId) || targetId === ch.id) {
    return json({ error: 'Invalid target character' }, 400)
  }

  // Sweep before reading so we don't invite a stale waiting-room ghost.
  await sweepStaleRows(env)

  // Pull target + verify they're a real, alive, non-ironman, non-onelife character.
  const target = await env.DB.prepare(
    `SELECT c.id, c.username, c.is_ironman, c.is_one_life, c.active_match_id,
            c.is_bot, c.bot_template_id,
            w.character_id AS in_waiting,
            w.combat_level AS waiting_cb
       FROM characters c
  LEFT JOIN pvp_waiting_room w ON w.character_id = c.id
      WHERE c.id = ? AND c.deleted_at IS NULL`
  ).bind(targetId).first()

  if (!target) return json({ error: 'Target not found' }, 404)
  if (!target.is_bot && (target.is_ironman || target.is_one_life)) {
    return json({ error: 'pvp_not_allowed_for_account_type' }, 403)
  }
  if (target.active_match_id) {
    return json({ error: 'target_in_active_match' }, 409)
  }

  // Bot auto-accept: bots are never in pvp_waiting_room but are always
  // available (virtual presence). When the target is a bot, skip the pending
  // invitation step and create the match immediately on the bot's behalf.
  if (target.is_bot) {
    const myCB     = await readCombatLevel(env, ch.id)
    const targetCB = await readCombatLevel(env, target.id)
    if (Math.abs(targetCB - myCB) > CB_BAND) {
      return json({ error: 'cb_band_mismatch', my_cb: myCB, target_cb: targetCB, band: CB_BAND }, 409)
    }
    const now    = Date.now()
    const result = await createMatch(
      env,
      { id: ch.id, username: ch.username },
      { id: target.id, username: target.username, is_bot: true, bot_template_id: target.bot_template_id },
      now,
    )
    if (!result.ok) {
      return json({ error: result.error }, result.status || 500)
    }
    return json({ ok: true, auto_accepted: true, match_id: result.matchId }, 201)
  }

  if (!target.in_waiting) {
    return json({ error: 'target_not_in_waiting_room' }, 409)
  }

  // Symmetric CB check: caller's band must include target AND target's
  // band must include caller. We compute both sides server-side.
  const myCB = await readCombatLevel(env, ch.id)
  const targetCB = await readCombatLevel(env, target.id)
  const callerSeesTarget = Math.abs(targetCB - myCB) <= CB_BAND
  const targetSeesCaller = Math.abs(myCB - targetCB) <= CB_BAND  // identical, but explicit
  if (!callerSeesTarget || !targetSeesCaller) {
    return json({
      error: 'cb_band_mismatch',
      my_cb: myCB,
      target_cb: targetCB,
      band: CB_BAND,
    }, 409)
  }

  const now = Date.now()
  try {
    const res = await env.DB.prepare(
      `INSERT INTO pvp_invitations (from_character, to_character, status, created_at)
       VALUES (?, ?, 'pending', ?)`
    ).bind(ch.id, target.id, now).run()
    return json({
      ok: true,
      invitation: {
        id: res.meta.last_row_id,
        from_character: ch.id,
        to_character: target.id,
        status: 'pending',
        created_at: now,
      },
    }, 201)
  } catch (err) {
    // The unique partial index idx_pvp_invitations_pending fires here if
    // an invite from this caller → target is already pending.
    if (String(err.message || err).includes('UNIQUE')) {
      return json({ error: 'invite_already_pending' }, 409)
    }
    throw err
  }
}
