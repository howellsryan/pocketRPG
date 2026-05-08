import itemsData from '../../src/data/items.json' assert { type: 'json' }
import { buildPlayerCombatant } from '../../src/engine/combatant.js'
import { getLevelFromXP } from '../../src/engine/experience.js'
import { decodeSaveRow } from './saveCodec.js'


const VALID_PVP_STANCES = new Set([
  'accurate',
  'aggressive',
  'defensive',
  'controlled',
  'rapid',
  'longrange',
])

export function normalizePvpCombatStance(value) {
  return VALID_PVP_STANCES.has(value) ? value : 'accurate'
}

async function parseSaveRow(row) {
  const decoded = await decodeSaveRow(row)
  if (!decoded?.save_data) return null
  try {
    const payload = JSON.parse(decoded.save_data)
    return { payload, updatedAt: decoded.updatedAt }
  } catch {
    return null
  }
}

export function buildCombatantFromSave({ characterId, username, savePayload }) {
  return buildPlayerCombatant({
    characterId,
    username,
    stats: savePayload?.stats || {},
    equipment: savePayload?.equipment || {},
    inventory: savePayload?.inventory || [],
    // PvP duels start from a fresh combat snapshot.
    // Do not inherit stale PvE/local currentHP from the cloud save, because
    // a stale 0 HP value can terminally end the match on the first tick.
    stance: normalizePvpCombatStance(savePayload?.settings?.combatStance ?? savePayload?.combatStance),
    spell: null,
    itemsData,
  })
}

export function applyCombatantToSave(savePayload, combatant) {
  const next = { ...(savePayload || {}) }
  next.inventory = Array.isArray(combatant?.inventory)
    ? combatant.inventory.map((s) => (s ? { ...s } : null))
    : []
  next.equipment = Object.fromEntries(
    Object.entries(combatant?.equipment || {}).map(([slot, item]) => [slot, item ? { ...item } : null]),
  )
  if (combatant?.stance) {
    next.settings = {
      ...(next.settings || {}),
      combatStance: normalizePvpCombatStance(combatant.stance),
    }
  }
  if (next.player && typeof next.player === 'object') {
    next.player = {
      ...next.player,
      currentHP: combatant?.hp ?? combatant?.currentHP ?? next.player.currentHP,
    }
  }
  return next
}

export async function readOwnedActiveMatch(env, matchId, characterId) {
  const row = await env.DB.prepare(
    `SELECT id, character_a, character_b, status, current_tick, state_json, last_tick_at,
            winner_character_id, ended_at
       FROM pvp_matches
      WHERE id = ?
        AND (character_a = ? OR character_b = ?)`
  ).bind(matchId, characterId, characterId).first()

  if (!row) return { error: 'match_not_found', status: 404 }
  return { row }
}

export async function readCharacterSave(env, characterId) {
  const row = await env.DB.prepare(
    'SELECT save_data, save_blob, updated_at FROM saves WHERE character_id = ?'
  ).bind(characterId).first()
  const parsed = await parseSaveRow(row)
  if (!parsed) return null
  return parsed
}

export const PVP_COMBAT_STAT_KEYS = [
  'attack',
  'strength',
  'defence',
  'hitpoints',
  'ranged',
  'magic',
  'prayer',
]

function readStatLevel(statValue) {
  if (typeof statValue === 'number') {
    return Number.isFinite(statValue) && statValue > 0 ? Math.floor(statValue) : 1
  }

  const explicit = Number(statValue?.level ?? statValue?.currentLevel ?? statValue?.current_level)
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit)

  const xp = Number(statValue?.xp)
  if (Number.isFinite(xp) && xp >= 0) return getLevelFromXP(xp)

  return 1
}

export function readCombatStatLevels(savePayload) {
  const stats = savePayload?.stats || {}
  const out = {}

  for (const key of PVP_COMBAT_STAT_KEYS) {
    out[key] = readStatLevel(stats[key])
  }

  return out
}

export { itemsData }
