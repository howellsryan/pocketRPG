// PvP Combatant shape and pure builders.
//
// A Combatant is a self-contained snapshot of one player's combat-relevant
// state. Two Combatants + the items lookup are everything pvpEngine needs
// to advance one tick of a fight. The shape deliberately mirrors what
// processCombatTick already reads off `playerStats + equipment + inventory`,
// so the same engine helpers (effectiveStrength, maxAttackRoll, etc.) can
// drive both sides without rewriting.
//
// Phase 2A note: this file does NOT touch combat.js. PvE's existing engine
// keeps its current shape and tests stay green. Phase 2B's pvpEngine.js
// composes Combatants + combatPrimitives.js into the symmetric tick loop.
//
// ──────────────────────────────────────────────────────────────────────
// Combatant shape (JSDoc — pure JS file, no TS)
// ──────────────────────────────────────────────────────────────────────
//
// /** @typedef {{
//   characterId: number,
//   username: string,
//
//   // Base stats from save (skill XP → level)
//   stats: {
//     attack: number, strength: number, defence: number, hitpoints: number,
//     ranged: number, magic: number, prayer: number,
//   },
//   maxHP: number,
//   currentHP: number,
//
//   // 11-slot equipment + 28-slot inventory (mirror of EQUIPMENT_SLOTS / INVENTORY_SIZE)
//   equipment: Record<EquipSlot, EquippedItem | null>,
//   inventory: Array<InventorySlot | null>,
//
//   // Combat configuration
//   combatType: 'melee' | 'ranged' | 'magic',
//   stance: 'accurate' | 'aggressive' | 'controlled' | 'defensive' | 'rapid' | 'longrange',
//   spell: { id: string, baseDamage: number, baseXP: number, runeReq: object } | null,
//
//   // Per-combatant runtime state (mutated each tick by the engine)
//   attackTimer: number,        // ticks until next swing; 0 = ready
//   eatCooldown: number,        // ticks during which no attack can fire
//   potionCooldown: number,     // ticks during which no potion can be drunk
//   activeCombatPrayer: string | null,
//   activeProtectionPrayer: null,  // disabled in v1 — stays null
//   activePotions: Record<string, number>,  // { potionItemId: ticksRemaining }
//   specialAttackEnergy: number,  // 0..100, starts at 100, regenerates in PvP
//   specialAttackRegeneratedAt: number, // server ms timestamp of last regen accounting
//   specialAttackQueued: boolean,
//
//   // Set when a forfeit intent is processed; the engine produces a
//   // terminal {winner, loser, reason: 'forfeit'} on the next tick.
//   forfeited: boolean,
// }} Combatant */
//
// ──────────────────────────────────────────────────────────────────────
// Equipped/Inventory item shapes (mirror existing PvE code)
// ──────────────────────────────────────────────────────────────────────
//
// EquippedItem: { itemId, _twoHanded?: boolean, charges?: number, quantity?: number (ammo only) }
// InventorySlot: { itemId, quantity, charges?, noted?: boolean }
//
// Quantity for non-stackable items is always 1; stackables use real counts.

import { getLevelFromXP } from './experience.js'
import { EQUIPMENT_SLOTS, INVENTORY_SIZE } from '../utils/constants.js'

/** Spec energy at match start. PvP rule: starts at 100 and regenerates during match. */
export const PVP_INITIAL_SPEC_ENERGY = 100

/** Maximum HP for a hitpoints level (10HP at L10, +1 per level). */
export function getMaxHPFromLevel(hitpointsLevel) {
  // Mirrors src/state/gameState.jsx getMaxHP(): hp level == HP itself,
  // with floor of 10 HP at level 10. We just trust the level value;
  // it can never legally fall below 10 because that's the start level.
  return Math.max(10, hitpointsLevel)
}

/**
 * Compute the player's current combat type purely from the equipped weapon.
 * Mirrors src/engine/equipment.js getCombatType — duplicated here so
 * Combatant builders don't pull the equipment.js module's full surface.
 */
export function combatTypeFromEquipment(equipment, itemsData) {
  const weaponEntry = equipment?.weapon
  if (!weaponEntry) return 'melee'
  const weapon = itemsData[weaponEntry.itemId]
  if (!weapon) return 'melee'
  const style = weapon.attackStyle || 'crush'
  if (style === 'ranged') return 'ranged'
  if (style === 'magic') return 'magic'
  return 'melee'
}

/**
 * Build a Combatant from a player's persisted state. Pure: takes already-
 * loaded stats / equipment / inventory and returns a fresh snapshot.
 *
 * The server constructs both combatants from each character's `saves.save_data`
 * at match start (Phase 3). The client constructs its own combatant locally
 * for optimistic UI, but the server's snapshot is authoritative.
 */
export function buildPlayerCombatant({
  characterId, username,
  stats, equipment, inventory,
  currentHP, maxHP,
  stance = 'accurate',
  spell = null,
  combatType,
  itemsData,
}) {
  // Resolve combat type if the caller didn't supply one explicitly.
  const resolvedCombatType = combatType || combatTypeFromEquipment(equipment, itemsData)

  // Normalise stats — everything we expose is a level (not raw XP) so the
  // engine never has to call getLevelFromXP at runtime per tick.
  const lvl = (skill) => {
    const xp = stats?.[skill]?.xp
    if (typeof xp === 'number') return getLevelFromXP(xp)
    if (typeof stats?.[skill]?.level === 'number') return stats[skill].level
    return 1
  }
  const normalised = {
    attack: lvl('attack'),
    strength: lvl('strength'),
    defence: lvl('defence'),
    hitpoints: lvl('hitpoints'),
    ranged: lvl('ranged'),
    magic: lvl('magic'),
    prayer: lvl('prayer'),
  }
  const resolvedMaxHP = maxHP ?? getMaxHPFromLevel(normalised.hitpoints)
  const resolvedCurrentHP = currentHP ?? resolvedMaxHP

  // Defensive copies — the engine will mutate these freely on its own
  // copy of the Combatant; we never want the caller's original arrays
  // to bleed in.
  const equipmentCopy = {}
  for (const slot of EQUIPMENT_SLOTS) {
    equipmentCopy[slot] = equipment?.[slot] ? { ...equipment[slot] } : null
  }
  const invCopy = new Array(INVENTORY_SIZE).fill(null)
  if (Array.isArray(inventory)) {
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const slot = inventory[i]
      if (slot) invCopy[i] = { ...slot }
    }
  }

  return {
    characterId,
    username,
    stats: normalised,
    maxHP: resolvedMaxHP,
    currentHP: resolvedCurrentHP,
    equipment: equipmentCopy,
    inventory: invCopy,
    combatType: resolvedCombatType,
    stance,
    spell,

    // Runtime state. PvP rule: both sides start with attackTimer=0 (no
    // monster-style 1-tick handicap), tiebreaks resolved by lower
    // characterId in the engine.
    attackTimer: 0,
    eatCooldown: 0,
    potionCooldown: 0,
    activeCombatPrayer: null,
    activeProtectionPrayer: null,    // protection prayers disabled in v1
    activePotions: {},
    specialAttackEnergy: PVP_INITIAL_SPEC_ENERGY,
    specialAttackQueued: false,
    forfeited: false,
  }
}

/**
 * Look up the level of a skill on a Combatant. Convenience wrapper to
 * avoid the engine sprinkling combatant.stats[skill] everywhere.
 */
export function getCombatantSkill(combatant, skill) {
  return combatant?.stats?.[skill] ?? 1
}
