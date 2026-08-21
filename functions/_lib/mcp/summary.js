import itemsData from '../../../src/data/items.json' assert { type: 'json' }
import { getLevelFromXP } from '../../../src/engine/experience.js'
import { combatLevelFromStats } from '../../../src/engine/combatLevel.js'
import { getEquipmentBonuses, getCombatType, getAttackSpeed, getEffectiveWornMagicDamage } from '../../../src/engine/equipment.js'
import { getCombatSetMultipliers } from '../../../src/engine/combatSetBonuses.js'
import {
  effectiveStrength, wornMeleeMaxHit, effectiveRanged, wornRangedMaxHit, magicMaxHit, getMeleeStyleBonuses,
} from '../../../src/engine/formulas.js'
import { poweredStaffMagicBaseDamage } from '../../../src/engine/combatPrimitives.js'

// Best-case max hits for the current stats + worn gear, reusing the exact live
// combat formulas (combat.js). Melee is the aggressive-stance peak (+3 strength
// style); ranged/magic style bonuses don't change the max. Magic is only
// well-defined for a powered staff (no selected spell here), so it's null
// otherwise and the model should explain it depends on the equipped spell.
//
// UNBUFFED, and uniformly so across all three styles: no prayer and no potion
// is assumed, because a character sheet has no fight to read one off. That is
// a real gap against what the player would hit — Piety, Rigour and Augury all
// raise these, and Augury raises the magic number twice over (its level boost
// buys accuracy, its magicDamagePercent raises the max hit itself). The payload
// says so in `maxHitsBasis` rather than guessing a prayer; `analyze_dps` is the
// tool that picks one and models it.
function computeMaxHits(stats, equipment) {
  const lvl = (skill) => getLevelFromXP(Number(stats?.[skill]?.xp || 0))
  const bonuses = getEquipmentBonuses(equipment, itemsData)
  const setMult = getCombatSetMultipliers(equipment)

  const effStr = effectiveStrength(lvl('strength'), 0, 1.0, getMeleeStyleBonuses('aggressive').strengthStyleBonus)
  const melee = Math.floor(wornMeleeMaxHit(effStr, bonuses.otherBonus) * setMult.meleeDamage)

  const effRng = effectiveRanged(lvl('ranged'), 0, 1.0, 0)
  const ranged = Math.floor(wornRangedMaxHit(effRng, bonuses.otherBonus) * setMult.rangedDamage)

  let magic = null
  const weaponId = equipment?.weapon?.itemId ?? equipment?.weapon?.id
  const weapon = weaponId ? itemsData[weaponId] : null
  if (weapon?.poweredStaff) {
    const baseDamage = poweredStaffMagicBaseDamage(lvl('magic'), weapon)
    const wornMagicDamage = getEffectiveWornMagicDamage(bonuses.otherBonus.magicDamage, equipment, itemsData)
    magic = Math.floor(magicMaxHit(baseDamage, wornMagicDamage + setMult.magicDamageBonusFlat))
  }

  return { melee, ranged, magic }
}

// Compresses the (potentially large) raw save blob into a model-friendly view:
// coins, per-skill level + XP, total level/XP, combat level, current HP/prayer,
// worn equipment + aggregated bonuses, best-case max hits, inventory contents
// and bank size. Pure — exercised directly by the regression test.
export function summarizeSave(saveData) {
  const state = typeof saveData === 'string' ? JSON.parse(saveData) : (saveData || {})

  const skills = {}
  let totalLevel = 0
  let totalXp = 0
  for (const [name, s] of Object.entries(state.stats || {})) {
    const xp = Number(s?.xp || 0)
    const level = getLevelFromXP(xp)
    skills[name] = { level, xp }
    totalLevel += level
    totalXp += xp
  }

  const inventory = (state.inventory || [])
    .filter(Boolean)
    .map((slot) => ({ itemId: slot.itemId ?? slot.id, quantity: slot.quantity ?? 1, noted: !!slot.noted }))

  const rawEquipment = state.equipment || {}
  const equipment = {}
  for (const [slot, item] of Object.entries(rawEquipment)) {
    if (item) equipment[slot] = { itemId: item.itemId ?? item.id, quantity: item.quantity ?? 1 }
  }

  const dungeoneeringTokens = Number.isFinite(Number(state.settings?.dungeoneeringTokens))
    ? Math.floor(Number(state.settings.dungeoneeringTokens))
    : (Number.isFinite(Number(state.dungeoneeringTokens)) ? Math.floor(Number(state.dungeoneeringTokens)) : 0)

  return {
    coins: state.coins ?? 0,
    combatStance: state.settings?.combatStance ?? null,
    combatLevel: combatLevelFromStats(state.stats || {}),
    combatType: getCombatType(rawEquipment, itemsData),
    attackSpeedTicks: getAttackSpeed(rawEquipment, itemsData),
    currentHP: state.player?.currentHP ?? null,
    prayerPoints: state.player?.prayer ?? null,
    prayerPointsMax: getLevelFromXP(Number(state.stats?.prayer?.xp || 0)),
    dungeoneeringTokens,
    totalLevel,
    totalXp,
    skills,
    equipment,
    equipmentBonuses: getEquipmentBonuses(rawEquipment, itemsData),
    maxHits: computeMaxHits(state.stats || {}, rawEquipment),
    maxHitsBasis: 'Worn gear and current levels only — no prayer or potion is applied. Prayers and boosts raise these in a real fight (Augury also adds +5% magic damage on top of its level boost). Use analyze_dps for buffed numbers.',
    inventory,
    inventoryUsed: inventory.length,
    inventoryCapacity: 28,
    bankUniqueItems: state.bank ? Object.keys(state.bank).length : 0,
  }
}

// Full bank listing (id + name + quantity), optionally filtered by a
// case-insensitive substring over item id/name. Kept out of summarizeSave so
// get_character_state stays compact; served by the get_bank tool.
export function bankItems(saveData, { query, limit } = {}) {
  const state = typeof saveData === 'string' ? JSON.parse(saveData) : (saveData || {})
  const bank = state.bank && typeof state.bank === 'object' ? state.bank : {}
  const q = (query || '').trim().toLowerCase()
  const cap = Math.min(Math.max(1, Math.floor(Number(limit) || 200)), 200)

  const all = Object.entries(bank).map(([itemId, entry]) => ({
    itemId,
    name: itemsData[itemId]?.name || itemId,
    quantity: typeof entry === 'number' ? Math.floor(entry) : Math.floor(Number(entry?.quantity) || 0),
  }))
  const filtered = q
    ? all.filter((it) => it.itemId.toLowerCase().includes(q) || it.name.toLowerCase().includes(q))
    : all

  return { total: filtered.length, returned: Math.min(filtered.length, cap), items: filtered.slice(0, cap) }
}
