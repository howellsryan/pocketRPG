// Symmetric attack/defence rollers for PvP combat.
//
// These are pure functions that take an attacker and defender Combatant
// and return a hit result. They compose the building blocks already in
// formulas.js (effectiveAttack, maxAttackRoll, hitChance, rollDamage)
// with the new effectiveDefence/playerDefenceRoll added in Phase 2A.
//
// PvE uses its own engine (src/engine/combat.js) untouched; that engine
// already inlines these calculations against monster shapes. Phase 2B's
// pvpEngine.js will compose these rollers into a symmetric tick.
//
// Each roller returns:
//   {
//     hit: boolean,           // true if the swing connected (damage > 0 OR a 0-roll on a hit)
//     damage: number,         // raw rolled damage before HP cap
//     accuracy: number,       // computed hit chance for logs / debug
//     maxHit: number,         // max possible damage for this swing
//     attackRoll: number,     // for debugging / replay
//     defenceRoll: number,
//   }
//
// Random rolls go through formulas.js's rollDamage (Math.random under the
// hood) so behaviour matches existing PvE tests for free.

import {
  effectiveStrength, effectiveAttack, effectiveRanged, effectiveMagic,
  meleeMaxHit, rangedMaxHit, magicMaxHit,
  maxAttackRoll, hitChance, rollDamage,
  getMeleeStyleBonuses, getRangedStyleBonus,
  effectiveDefence, playerDefenceRoll,
} from './formulas.js'
import { getEquipmentBonuses, getAttackStyle, getEffectiveWornMagicDamage } from './equipment.js'
import { getCombatSetMultipliers } from './combatSetBonuses.js'
import { getPvpCombatModifiers } from './pvpCombatModifiers.js'
import { hasRequiredRunes, getRunesToConsume } from './runes.js'

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Resolve an attacker's "weapon style" for melee: the bonus key on
 * defender.equipment defenceBonus that matches the attacker's swing.
 * Mirrors getAttackStyle() — duplicated for clarity at call sites.
 */
function attackStyleFor(attackerEquipment, itemsData) {
  return getAttackStyle(attackerEquipment, itemsData)
}

/**
 * Resolve the defender's equipment defence bonus for a given attack style.
 * Returns 0 if the slot is empty or the style key is missing.
 */
function defenderDefenceBonus(defenderEquipment, style, itemsData) {
  const bonuses = getEquipmentBonuses(defenderEquipment, itemsData)
  return bonuses.defenceBonus[style] || 0
}

// ── Melee ───────────────────────────────────────────────────────────────

/**
 * Roll a melee attack. Both sides use player formulas (effectiveAttack /
 * effectiveDefence) — this is the symmetric calculation the asymmetric
 * PvE engine doesn't expose directly.
 *
 * The attacker's stance contributes attack and strength bonuses; the
 * defender's stance contributes their defence bonus. Prayer/potion-
 * boosted stat values must already be baked into combatant.stats by the
 * caller (the engine applies these per-tick before calling here).
 */
export function rollMeleeAttack(attacker, defender, itemsData) {
  const atkBonuses = getEquipmentBonuses(attacker.equipment, itemsData)
  const style = attackStyleFor(attacker.equipment, itemsData)
  const atkStance = getMeleeStyleBonuses(attacker.stance)
  const defStance = getMeleeStyleBonuses(defender.stance)
  const atkMods = getPvpCombatModifiers(attacker)
  const voidMult = getCombatSetMultipliers(attacker.equipment)
  const defMods = getPvpCombatModifiers(defender)

  const effStr = effectiveStrength(
    attacker.stats.strength,
    atkMods.potions.strength,
    atkMods.prayer.strength,
    atkStance.strengthStyleBonus,
  )
  const maxHit = Math.floor(meleeMaxHit(effStr, atkBonuses.otherBonus.meleeStrength) * voidMult.meleeDamage)

  const effAtk = effectiveAttack(
    attacker.stats.attack,
    atkMods.potions.attack,
    atkMods.prayer.attack,
    atkStance.attackStyleBonus,
  )
  const atkRoll = Math.floor(maxAttackRoll(effAtk, (atkBonuses.attackBonus[style] || 0) + voidMult.accuracyFlat) * voidMult.meleeAccuracy)

  const effDef = effectiveDefence(
    defender.stats.defence,
    defMods.potions.defence,
    defMods.prayer.defence,
    defStance.defenceStyleBonus,
  )
  const defRoll = playerDefenceRoll(effDef, defenderDefenceBonus(defender.equipment, style, itemsData))

  const accuracy = hitChance(atkRoll, defRoll)
  const damage = rollDamage(accuracy, maxHit)
  return {
    hit: damage > 0,
    damage,
    accuracy,
    maxHit,
    attackRoll: atkRoll,
    defenceRoll: defRoll,
    style,
  }
}

// ── Ranged ──────────────────────────────────────────────────────────────

export function rollRangedAttack(attacker, defender, itemsData) {
  const atkBonuses = getEquipmentBonuses(attacker.equipment, itemsData)
  const defStance = getMeleeStyleBonuses(defender.stance)
  const styleBonus = getRangedStyleBonus(attacker.stance)
  const atkMods = getPvpCombatModifiers(attacker)
  const voidMult = getCombatSetMultipliers(attacker.equipment)
  const defMods = getPvpCombatModifiers(defender)

  const effRngAttack = effectiveRanged(attacker.stats.ranged, atkMods.potions.ranged, atkMods.prayer.ranged, styleBonus)
  const effRngStrength = effectiveRanged(attacker.stats.ranged, atkMods.potions.ranged, atkMods.prayer.rangedStrength, styleBonus)
  const maxHit = Math.floor(rangedMaxHit(effRngStrength, atkBonuses.otherBonus.rangedStrength) * voidMult.rangedDamage)

  const atkRoll = Math.floor(maxAttackRoll(effRngAttack, (atkBonuses.attackBonus.ranged || 0) + voidMult.accuracyFlat) * voidMult.rangedAccuracy)

  const effDef = effectiveDefence(
    defender.stats.defence,
    defMods.potions.defence,
    defMods.prayer.defence,
    defStance.defenceStyleBonus,
  )
  const defRoll = playerDefenceRoll(effDef, defenderDefenceBonus(defender.equipment, 'ranged', itemsData))

  const accuracy = hitChance(atkRoll, defRoll)
  const damage = rollDamage(accuracy, maxHit)
  return {
    hit: damage > 0,
    damage,
    accuracy,
    maxHit,
    attackRoll: atkRoll,
    defenceRoll: defRoll,
    style: 'ranged',
  }
}

// ── Magic ───────────────────────────────────────────────────────────────

/**
 * Magic attack roll. Defender's magic defence is the PocketRPG-style mix of
 * 70% magic level + 30% defence level for monsters; for players, PocketRPG
 * uses 100% magic level. We use the player formula here since both sides
 * are players.
 *
 * Either pass `spell` (object with baseDamage, baseXP, runeReq) for a
 * standard spell cast, or pass it as null when using a powered staff —
 * in which case the caller is expected to provide a maxHit override
 * since powered staves scale differently.
 */
export function rollMagicAttack(attacker, defender, itemsData, opts = {}) {
  const { spell = attacker.spell, maxHitOverride = null } = opts
  const atkBonuses = getEquipmentBonuses(attacker.equipment, itemsData)
  const defBonuses = getEquipmentBonuses(defender.equipment, itemsData)
  const atkMods = getPvpCombatModifiers(attacker)
  const voidMult = getCombatSetMultipliers(attacker.equipment)
  const defMods = getPvpCombatModifiers(defender)

  const effMag = effectiveMagic(attacker.stats.magic, atkMods.potions.magic, atkMods.prayer.magic)
  const atkRoll = Math.floor(maxAttackRoll(effMag, (atkBonuses.attackBonus.magic || 0) + voidMult.accuracyFlat) * voidMult.magicAccuracy)

  // Player magic defence: effective magic level + magic defence equipment.
  // We use effectiveDefence(magicLevel) — for player vs player, magic
  // defence is dominated by the magic level itself, not the defence stat.
  // (PocketRPG PvP: magic def = 70% magic + 30% defence. We follow that here
  // because it's the well-tested formula and it preserves the feel.)
  const effectiveDefenceLevel = Math.floor((defender.stats.defence + defMods.potions.defence) * defMods.prayer.defence)
  const playerMagicDefLevel = Math.floor(defender.stats.magic * 0.7) + Math.floor(effectiveDefenceLevel * 0.3)
  const effMagDef = effectiveDefence(playerMagicDefLevel)
  const defRoll = playerDefenceRoll(effMagDef, defBonuses.defenceBonus.magic || 0)

  const wornMagicDamage = getEffectiveWornMagicDamage(atkBonuses.otherBonus.magicDamage, attacker.equipment, itemsData)
  let maxHit
  if (typeof maxHitOverride === 'number') {
    maxHit = magicMaxHit(maxHitOverride, wornMagicDamage + voidMult.magicDamageBonusFlat)
  } else if (spell) {
    maxHit = magicMaxHit(spell.baseDamage, wornMagicDamage + voidMult.magicDamageBonusFlat)
  } else {
    // No spell, no override — caller is misusing the API. Bail with 0.
    return { hit: false, damage: 0, accuracy: 0, maxHit: 0, attackRoll: atkRoll, defenceRoll: defRoll, style: 'magic' }
  }

  const accuracy = hitChance(atkRoll, defRoll)
  const damage = rollDamage(accuracy, maxHit)
  return {
    hit: damage > 0,
    damage,
    accuracy,
    maxHit,
    attackRoll: atkRoll,
    defenceRoll: defRoll,
    style: 'magic',
  }
}

/**
 * Powered-staff base damage from magic level. Mirrors the PvE powered-staff
 * branch in combat.js (base at L75, +1 per 3 magic levels): floor(mag/3)+9.
 * Kept here so PvE and PvP share the same scaling for staves like the
 * Trident / Sanguinesti.
 */
export function poweredStaffMagicBaseDamage(magicLevel) {
  return Math.max(1, Math.floor((Number(magicLevel) || 1) / 3) + 9)
}

function zeroMagicSwing() {
  return { hit: false, damage: 0, accuracy: 0, maxHit: 0, attackRoll: 0, defenceRoll: 0, style: 'magic' }
}

/**
 * Resolve a full magic swing for a combatant, mirroring the PvE magic
 * branches (powered staff → spell → no cast). Shared by pvpEngine so PvP
 * magic obeys the same rune/powered-staff rules as PvE.
 *
 * Returns { swing, runesToConsume, blocked, reason }:
 *  - powered staff: maxHit scaled from magic level, no runes consumed.
 *  - standard spell with runes: a normal cast plus the runes to consume.
 *  - standard spell but out of runes, or no spell selected: blocked (0 dmg).
 *
 * Pure: it never mutates the combatant. The caller (pvpEngine) is
 * responsible for actually removing `runesToConsume` from the inventory.
 */
export function resolveMagicSwing(attacker, defender, itemsData) {
  const weaponEntry = attacker?.equipment?.weapon
  const weapon = weaponEntry ? itemsData?.[weaponEntry.itemId] : null

  // Powered staff path (e.g. Trident): no spell, no runes — scale with magic.
  if (weapon?.poweredStaff) {
    const mods = getPvpCombatModifiers(attacker)
    const boostedMagic = Math.floor(((attacker?.stats?.magic || 1) + (mods.potions.magic || 0)) * (mods.prayer.magic || 1))
    const maxHitOverride = poweredStaffMagicBaseDamage(boostedMagic)
    return { swing: rollMagicAttack(attacker, defender, itemsData, { maxHitOverride }), runesToConsume: null, blocked: false }
  }

  const spell = attacker?.spell
  if (!spell || typeof spell.baseDamage !== 'number') {
    return { swing: zeroMagicSwing(), runesToConsume: null, blocked: true, reason: 'no_spell' }
  }
  // PvP rune sourcing matches PvE: an equipped elemental staff supplies its
  // element rune for free, and all other runes must be carried in the caster's
  // INVENTORY (bank is never consulted in combat — the {} below). The staff's
  // rune is excluded from both the availability check and the consume set.
  if (!hasRequiredRunes(spell.runeReq, attacker.inventory || [], {}, attacker.equipment, itemsData)) {
    return { swing: zeroMagicSwing(), runesToConsume: null, blocked: true, reason: 'no_runes', spellId: spell.id }
  }

  const swing = rollMagicAttack(attacker, defender, itemsData, { spell })
  const runesToConsume = spell.runeReq ? getRunesToConsume(spell.runeReq, attacker.equipment, itemsData) : null
  return { swing, runesToConsume, blocked: false }
}
