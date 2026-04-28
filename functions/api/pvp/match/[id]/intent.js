import { requireAuth, json } from '../../../../_lib/auth.js'
import { getOwnedCharacter, sweepStaleRows } from '../../../../_lib/pvp.js'
import { readOwnedActiveMatch, itemsData } from '../../../../_lib/pvpMatch.js'
import { isPvpFoodItem } from '../../../../../src/engine/pvpFood.js'
import { isPvpCombatPotion } from '../../../../../src/engine/pvpPotions.js'
import spellsData from '../../../../../src/data/spells.json' assert { type: 'json' }
import prayersData from '../../../../../src/data/prayers.json' assert { type: 'json' }

const VALID_STANCES = new Set(['accurate', 'aggressive', 'defensive', 'controlled', 'rapid', 'longrange'])
const PROTECTION_PRAYER_IDS = new Set(['protection_from_magic', 'protection_from_missiles', 'protection_from_melee'])

function getItemCount(inventory, itemId) {
  let count = 0
  for (const slot of inventory || []) {
    if (slot?.itemId === itemId) count += slot.quantity || 1
  }
  return count
}

function hasRequiredRunes(inventory, runeReq) {
  if (!runeReq || typeof runeReq !== 'object') return true
  for (const [runeId, req] of Object.entries(runeReq)) {
    if (getItemCount(inventory, runeId) < (req || 0)) return false
  }
  return true
}

export function validateIntentAction(state, characterId, action) {
  const combatant = state?.combatants?.[String(characterId)]
  if (!combatant || !action || typeof action !== 'object') {
    return { ok: false, error: 'invalid_action' }
  }

  if (action.type === 'forfeit' || action.type === 'queue_special') return { ok: true }

  if (action.type === 'change_stance') {
    return VALID_STANCES.has(action.stance)
      ? { ok: true }
      : { ok: false, error: 'invalid_stance' }
  }

  if (action.type === 'change_combat_spell') {
    const spell = spellsData?.[action.spellId]
    if (!spell) return { ok: false, error: 'invalid_spell' }
    if (!hasRequiredRunes(combatant.inventory, spell.runeReq)) {
      return { ok: false, error: 'insufficient_runes' }
    }
    return { ok: true }
  }

  if (action.type === 'toggle_prayer') {
    if (typeof action.prayerId !== 'string') {
      return { ok: false, error: 'invalid_prayer' }
    }
    const prayer = prayersData?.[action.prayerId]
    if (!prayer) return { ok: false, error: 'invalid_prayer' }
    if (prayer.bonusType === 'protection' || PROTECTION_PRAYER_IDS.has(action.prayerId)) {
      return { ok: false, error: 'protection_prayer_disabled' }
    }
    if ((combatant?.stats?.prayer || 1) < (prayer.level || 1)) {
      return { ok: false, error: 'insufficient_prayer_level' }
    }
    return { ok: true }
  }

  if (action.type === 'equip' || action.type === 'eat' || action.type === 'drink_potion') {
    const i = action.inventorySlot
    if (!Number.isInteger(i) || i < 0 || i >= (combatant.inventory?.length || 0)) {
      return { ok: false, error: 'invalid_inventory_slot' }
    }
    const slot = combatant.inventory[i]
    if (!slot) return { ok: false, error: 'empty_inventory_slot' }
    const item = itemsData?.[slot.itemId]
    if (!item) return { ok: false, error: 'unknown_item' }
    if (action.type === 'equip') return item.slot ? { ok: true } : { ok: false, error: 'item_not_equippable' }
    if (action.type === 'eat') return isPvpFoodItem(item) ? { ok: true } : { ok: false, error: 'item_not_food' }
    return isPvpCombatPotion(item) ? { ok: true } : { ok: false, error: 'item_not_potion' }
  }

  if (action.type === 'unequip') {
    const slot = action.equipmentSlot
    if (!slot || !combatant.equipment?.[slot]) {
      return { ok: false, error: 'invalid_equipment_slot' }
    }
    return { ok: true }
  }

  return { ok: false, error: 'unsupported_action' }
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  const matchId = parseInt(params.id, 10)
  if (!Number.isFinite(matchId)) return json({ error: 'Invalid match id' }, 400)

  await sweepStaleRows(env)

  const found = await readOwnedActiveMatch(env, matchId, ch.id)
  if (found.error) return json({ error: found.error }, found.status)
  if (found.row.status !== 'active') return json({ error: 'match_not_active' }, 409)
  let state
  try {
    state = JSON.parse(found.row.state_json)
  } catch {
    return json({ error: 'invalid_match_state' }, 500)
  }

  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const tickNumber = parseInt(body?.tick_number, 10)
  if (!Number.isFinite(tickNumber) || tickNumber < 0 || tickNumber > (found.row.current_tick + 1)) {
    return json({ error: 'invalid_tick_number' }, 400)
  }
  if (!body?.action || typeof body.action !== 'object') {
    return json({ error: 'invalid_action' }, 400)
  }
  const checked = validateIntentAction(state, ch.id, body.action)
  if (!checked.ok) return json({ error: checked.error }, 400)

  const maxSeqRow = await env.DB.prepare(
    'SELECT COALESCE(MAX(character_seq), 0) AS max_seq FROM pvp_intents WHERE match_id = ? AND character_id = ?'
  ).bind(matchId, ch.id).first()
  const nextSeq = (maxSeqRow?.max_seq || 0) + 1
  const now = Date.now()

  const insert = await env.DB.prepare(
    `INSERT INTO pvp_intents (match_id, character_id, tick_number, character_seq, action_json, created_at, applied)
     VALUES (?, ?, ?, ?, ?, ?, 0)`
  ).bind(matchId, ch.id, tickNumber, nextSeq, JSON.stringify(body.action), now).run()

  return json({
    ok: true,
    intent: {
      id: insert.meta.last_row_id,
      match_id: matchId,
      character_id: ch.id,
      tick_number: tickNumber,
      character_seq: nextSeq,
      created_at: now,
    },
  }, 201)
}
