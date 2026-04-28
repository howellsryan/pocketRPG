import itemsData from '../../src/data/items.json' assert { type: 'json' }
import { buildPlayerCombatant } from '../../src/engine/combatant.js'

function parseSaveRow(row) {
  if (!row?.save_data || typeof row.save_data !== 'string') return null
  try {
    const payload = JSON.parse(row.save_data)
    return { payload, updatedAt: row.updated_at }
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
    currentHP: savePayload?.player?.currentHP,
    maxHP: savePayload?.player?.maxHP,
    stance: 'accurate',
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
    `SELECT id, character_a, character_b, status, current_tick, state_json, last_tick_at
       FROM pvp_matches
      WHERE id = ?
        AND (character_a = ? OR character_b = ?)`
  ).bind(matchId, characterId, characterId).first()

  if (!row) return { error: 'match_not_found', status: 404 }
  return { row }
}

export async function readCharacterSave(env, characterId) {
  const row = await env.DB.prepare(
    'SELECT save_data, updated_at FROM saves WHERE character_id = ?'
  ).bind(characterId).first()
  const parsed = parseSaveRow(row)
  if (!parsed) return null
  return parsed
}

export { itemsData }
