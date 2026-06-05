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
import { itemsData, readCharacterSave, readCombatStatLevels } from '../../_lib/pvpMatch.js'
import { readCharacterPvpRank } from '../../_lib/pvpRanks.js'
import { calculatePvpRiskValues } from '../../../src/engine/pvpRisk.js'
import { buildBotSavePayload, getBotTemplate } from '../../_lib/pvpBot.js'

const CB_BAND = 10

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
  const lo = myCB - CB_BAND
  const hi = myCB + CB_BAND

  // Join with characters to surface usernames + ironman/onelife filtering
  // and to drop anyone currently in an active match (defence in depth —
  // the unique index on pvp_matches enforces this too).
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
  ).bind(ch.id, lo, hi).all()

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

  return json({
    my_combat_level: myCB,
    band: { lo, hi },
    waiting: [...botEntries, ...await Promise.all((rows.results || []).map(async (r) => {
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
    }))]
  })
}
