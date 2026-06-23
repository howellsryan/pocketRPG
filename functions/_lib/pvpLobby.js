// Shared lobby read helpers.
//
// The waiting-room list and the invitation lists are read from three
// endpoints: GET /api/pvp/waiting, GET /api/pvp/invitations, and the merged
// GET /api/pvp/lobby (which the client polls). Extracting the row-building
// here keeps those three in lockstep — risk/rank/stat shaping lives in one
// place instead of being copy-pasted per endpoint.

import { itemsData, readCharacterSave, readCombatStatLevels } from './pvpMatch.js'
import { readCharacterPvpRank } from './pvpRanks.js'
import { calculatePvpRiskValues } from '../../src/engine/pvpRisk.js'
import { buildBotSavePayload, getBotTemplate } from './pvpBot.js'

export const CB_BAND = 10

// Build the caller's CB-banded waiting-room list (bots UNIONed in virtually,
// same as the standalone GET /api/pvp/waiting). `myCB` is the caller's combat
// level; band is [myCB - CB_BAND, myCB + CB_BAND].
export async function buildWaitingList(env, characterId, myCB) {
  const lo = myCB - CB_BAND
  const hi = myCB + CB_BAND

  const rows = await env.DB.prepare(
    `SELECT w.character_id, w.combat_level, c.username
       FROM pvp_waiting_room w
       JOIN characters c ON c.id = w.character_id
      WHERE w.character_id != ?
        AND w.combat_level BETWEEN ? AND ?
        AND c.deleted_at IS NULL
        AND COALESCE(c.is_ironman, 0) = 0
        AND COALESCE(c.is_one_life, 0) = 0
        AND c.active_match_id IS NULL
      ORDER BY w.combat_level ASC, w.joined_at ASC`
  ).bind(characterId, lo, hi).all()

  // Bots are never in pvp_waiting_room (no heartbeat client), so we UNION
  // them in virtually. Any bot whose combat_level falls in the caller's band
  // and who is not currently in an active match is always available.
  const botRows = await env.DB.prepare(
    `SELECT c.id AS character_id, c.combat_level, c.username, c.bot_template_id
       FROM characters c
      WHERE c.is_bot = 1
        AND c.deleted_at IS NULL
        AND c.combat_level BETWEEN ? AND ?
        AND c.active_match_id IS NULL`
  ).bind(lo, hi).all()

  const botEntries = (botRows.results || []).map((r) => {
    const template = getBotTemplate(r.bot_template_id)
    const payload  = template ? buildBotSavePayload(template) : null
    const risk = calculatePvpRiskValues({
      inventory: payload?.inventory,
      equipment: payload?.equipment,
      itemsData,
    })
    const statsRaw = readCombatStatLevels(payload)
    return {
      character_id: r.character_id,
      username: r.username,
      combat_level: r.combat_level,
      inventory_shop_value: risk.inventoryShopValue,
      equipment_shop_value: risk.equipmentShopValue,
      total_shop_value: risk.totalShopValue,
      combat_stats: statsRaw,
      total_pvp_kills: 0,
      last_updated_total_pvp_kills: null,
      pvp_rank: null,
      is_bot: true,
    }
  })

  const humanEntries = await Promise.all((rows.results || []).map(async (r) => {
    try {
      const [save, pvpRank] = await Promise.all([
        readCharacterSave(env, r.character_id),
        readCharacterPvpRank(env, r.character_id),
      ])
      const risk = calculatePvpRiskValues({
        inventory: save?.payload?.inventory,
        equipment: save?.payload?.equipment,
        itemsData,
      })
      return {
        character_id: r.character_id,
        username: r.username,
        combat_level: r.combat_level,
        inventory_shop_value: risk.inventoryShopValue,
        equipment_shop_value: risk.equipmentShopValue,
        total_shop_value: risk.totalShopValue,
        combat_stats: readCombatStatLevels(save?.payload),
        total_pvp_kills: pvpRank.totalPvpKills,
        last_updated_total_pvp_kills: pvpRank.lastUpdatedTotalPvpKills,
        pvp_rank: pvpRank.rank,
      }
    } catch {
      return {
        character_id: r.character_id,
        username: r.username,
        combat_level: r.combat_level,
        inventory_shop_value: 0,
        equipment_shop_value: 0,
        total_shop_value: 0,
        combat_stats: readCombatStatLevels(null),
        total_pvp_kills: 0,
        last_updated_total_pvp_kills: null,
        pvp_rank: null,
      }
    }
  }))

  return { band: { lo, hi }, waiting: [...botEntries, ...humanEntries] }
}

// Build the caller's pending incoming + outgoing invitation lists, each row
// decorated with the other character's risk / combat stats / pvp rank. Shared
// by GET /api/pvp/invitations and the merged GET /api/pvp/lobby.
export async function buildInvitationLists(env, characterId) {
  const incoming = await env.DB.prepare(
    `SELECT i.id, i.from_character, i.to_character, i.created_at,
            c.username AS from_username,
            COALESCE(w.combat_level, 0) AS from_combat_level
       FROM pvp_invitations i
       JOIN characters c ON c.id = i.from_character
  LEFT JOIN pvp_waiting_room w ON w.character_id = i.from_character
      WHERE i.to_character = ? AND i.status = 'pending'
   ORDER BY i.created_at ASC`
  ).bind(characterId).all()

  const outgoing = await env.DB.prepare(
    `SELECT i.id, i.from_character, i.to_character, i.created_at,
            c.username AS to_username,
            COALESCE(w.combat_level, 0) AS to_combat_level
       FROM pvp_invitations i
       JOIN characters c ON c.id = i.to_character
  LEFT JOIN pvp_waiting_room w ON w.character_id = i.to_character
      WHERE i.from_character = ? AND i.status = 'pending'
   ORDER BY i.created_at ASC`
  ).bind(characterId).all()

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

  return { incoming: incomingWithRisk, outgoing: outgoingWithRisk }
}
