/**
 * Expected damage-per-second for a hypothetical loadout, and the target models
 * to measure it against.
 *
 * Every number here is the ANALYTICAL twin of one branch of
 * `processCombatTick`'s player attack (src/engine/combat.js): same effective
 * levels, same rolls, same multipliers, same order of flooring — with the
 * random roll replaced by its expectation. It composes the same primitives the
 * fight does (formulas.js, equipment.js, combatSetBonuses.js,
 * slayerCombatBonuses.js) rather than restating them, because a gear
 * recommendation that disagrees with the fight is worse than none. When a
 * combat branch changes, change the matching branch here; `tests/dpsCalculator
 * .test.ts` pins the two together by simulating swings against this estimate.
 *
 * Deliberately NOT modelled, and reported as `notes` so an answer built on this
 * never overstates its precision:
 *   - enchanted bolt procs (ruby/diamond/dragonstone/onyx) — each rewrites the
 *     damage roll rather than scaling it, so ammo ranks on raw ranged strength;
 *   - the Dharok multiplier, which is 1 at full HP and only grows as the player
 *     takes damage;
 *   - special attacks, which are manual and energy-limited (§7).
 *
 * Pure logic, no UI imports.
 */

import {
  effectiveStrength, effectiveAttack, effectiveRanged, effectiveMagic,
  wornMeleeMaxHit, wornRangedMaxHit, magicMaxHit,
  maxAttackRoll, maxDefenceRoll, monsterMagicDefenceRoll, hitChance,
  getMeleeStyleBonuses, getRangedStyleBonus,
} from './formulas.js'
import {
  getEquipmentBonuses, getAttackSpeed, getMeleeAttackStyle,
  getEffectiveWornMagicDamage, getSpellRuneMagicDamage,
  getRangedAmmoRequirementFailure,
} from './equipment.js'
import { getCombatSetMultipliers } from './combatSetBonuses.js'
import { getSlayerTaskEquipmentBonuses } from './slayerCombatBonuses.js'
import { poweredStaffMagicBaseDamage } from './combatPrimitives.js'
import { monsterDamageMultiplier } from './monsterDamageRules.js'
import { monsterMaxHit } from './monsterMaxHit.js'
import { applyForm, isMultiForm } from './bossForms.js'
import { TICK_DURATION } from '../utils/constants.js'

// Read inside the function, never into a top-level const: in the concatenated
// single-file build a module-eval read of another module's export lands in its
// temporal dead zone whenever the import is bundled later (§12).
const secondsPerTick = () => TICK_DURATION / 1000

export const COMBAT_STYLES = ['melee', 'ranged', 'magic']

// Stances the optimiser is allowed to pick from, per style. Defensive melee and
// longrange are omitted: both trade the DPS this module ranks on for defence,
// so they can never win and only cost search time.
export const STANCES_BY_STYLE = {
  melee: ['aggressive', 'accurate', 'controlled'],
  ranged: ['rapid', 'accurate'],
  magic: [null],
}

// Barrows sets, whose combat effects live in combat.js rather than
// COMBAT_SETS. Only the two that change damage output are listed — Ahrim drains
// the target's strength, Torag stuns it and Guthan heals the player, none of
// which move the player's own DPS.
const VERAC_SET = ['verin_s_helm', 'verin_s_brassard', 'verin_s_plateskirt', 'verin_s_flail']
const KARIL_SET = ['kaelor_s_coif', 'kaelor_s_leathertop', 'kaelor_s_leatherskirt', 'kaelor_s_crossbow']

function wearsAll(equipment, itemIds) {
  const worn = new Set(Object.values(equipment || {}).filter(Boolean).map((e) => e.itemId))
  return itemIds.every((id) => worn.has(id))
}

/** Mean of `randInt(1, max(1, maxHit))` — the roll combat.js makes on a hit. */
function meanRoll(maxHit) {
  return (1 + Math.max(1, maxHit)) / 2
}

function weaponOf(equipment, itemsData) {
  const entry = equipment?.weapon
  return entry?.itemId ? itemsData?.[entry.itemId] || null : null
}

/**
 * One target the player's swings land on: the flattened defensive profile a
 * combat branch reads. `weight` lets a multi-form boss average its forms and a
 * phased boss weight them by the health each phase actually holds.
 */
function makeTarget(monster, { weight = 1, formKey = null } = {}) {
  return {
    id: monster.id,
    name: monster.name || monster.id,
    formKey,
    weight,
    hitpoints: Number(monster.hitpoints) || 0,
    defenceLevel: Number(monster.stats?.defence) || 1,
    magicLevel: Number(monster.stats?.magic) || 1,
    defenceBonus: { ...(monster.defenceBonus || {}) },
    immunity: monster.immunity || null,
    isDragon: !!monster.isDragon,
    resistance: monster.resistance || null,
    attackStyle: monster.attackStyle || null,
    maxHit: monsterMaxHit(monster),
  }
}

/**
 * Every defensive profile a monster presents, as the fight builds them. A
 * multi-form boss rotates through its forms, so a single-form reading of a
 * boss whose magic form has no magic defence is not an estimate — it is the
 * wrong number for most of the fight. Forms are resolved through the engine's
 * own `applyForm` so an inherited (unauthored) defence block behaves here
 * exactly as it does mid-fight.
 */
export function monsterTargets(monster) {
  if (!monster) return []
  if (!isMultiForm(monster)) return [makeTarget(monster)]

  const keys = Object.keys(monster.forms)
  const phaseHP = keys.map((k) => Number(monster.forms[k]?.phaseHP) || 0)
  const totalPhaseHP = phaseHP.reduce((a, b) => a + b, 0)
  return keys.map((key, i) => {
    const copy = {
      ...monster,
      stats: { ...(monster.stats || {}) },
      defenceBonus: { ...(monster.defenceBonus || {}) },
    }
    const form = applyForm(copy, key)
    // Weight by the health a phase actually holds when the boss is phased;
    // otherwise every form is equally likely on the rotation.
    const weight = totalPhaseHP > 0 ? (phaseHP[i] || 0) / totalPhaseHP : 1 / keys.length
    return makeTarget({ ...copy, immunity: form?.immunity || null }, { weight, formKey: key })
  }).filter((t) => t.weight > 0)
}

/**
 * The stand-in target used when the player names no monster: the mean
 * defensive profile of the monsters a character of this combat level would
 * realistically be fighting. A synthetic dummy would rank gear against nothing
 * the player ever meets; averaging real monsters keeps magic honest, since its
 * defence roll is 70% of a monster's Magic level and bosses vary wildly there.
 */
export function referenceTarget(monstersData, combatLevel) {
  const pool = Object.entries(monstersData || {})
    .map(([id, m]) => ({ id, ...m }))
    .filter((m) => !m.boss && Number(m.hitpoints) > 0
      && Number(m.combatLevel) >= combatLevel * 0.5
      && Number(m.combatLevel) <= combatLevel * 2)
  const sample = pool.length ? pool : Object.entries(monstersData || {})
    .map(([id, m]) => ({ id, ...m })).filter((m) => Number(m.hitpoints) > 0)
  if (!sample.length) {
    return { name: 'a typical monster', sampleSize: 0, targets: [makeTarget({ id: 'dummy', name: 'Training dummy', hitpoints: 100, stats: { defence: 1, magic: 1 }, defenceBonus: {} })] }
  }

  const mean = (fn) => Math.round(sample.reduce((s, m) => s + fn(m), 0) / sample.length)
  const dummy = {
    id: '__reference__',
    name: 'a typical monster at your combat level',
    hitpoints: mean((m) => Number(m.hitpoints) || 0),
    stats: { defence: mean((m) => Number(m.stats?.defence) || 1), magic: mean((m) => Number(m.stats?.magic) || 1) },
    defenceBonus: {
      stab: mean((m) => Number(m.defenceBonus?.stab) || 0),
      slash: mean((m) => Number(m.defenceBonus?.slash) || 0),
      crush: mean((m) => Number(m.defenceBonus?.crush) || 0),
      magic: mean((m) => Number(m.defenceBonus?.magic) || 0),
      ranged: mean((m) => Number(m.defenceBonus?.ranged) || 0),
    },
  }
  return { name: dummy.name, sampleSize: sample.length, targets: [makeTarget(dummy)] }
}

/**
 * Can this loadout swing at all? A ranged weapon with no compatible ammo and a
 * magic setup with neither a powered staff nor a spell both produce zero
 * damage in combat.js (they early-return the tick), so they must score 0 here
 * rather than the damage their bonuses imply.
 */
export function loadoutBlockedReason({ style, equipment, itemsData, spell }) {
  const weapon = weaponOf(equipment, itemsData)
  if (style === 'ranged') {
    if (!weapon || weapon.attackStyle !== 'ranged') return 'no_ranged_weapon'
    if (!weapon.scaleCharged && getRangedAmmoRequirementFailure(equipment, itemsData)) return 'no_ammo'
  }
  if (style === 'magic') {
    if (!weapon || weapon.attackStyle !== 'magic') return 'no_magic_weapon'
    if (!weapon.poweredStaff && !spell) return 'no_spell'
  }
  // A magic weapon is deliberately NOT blocked from the melee branch: with no
  // spell selected, combat.js swings a staff as melee on its melee bonuses, and
  // reading that setup as zero damage would misreport what the player is
  // actually doing. The optimiser never proposes it — `weaponStyleOf` keeps
  // staves out of the melee weapon pool.
  if (style === 'melee' && weapon?.attackStyle === 'ranged') return 'wrong_weapon_style'
  return null
}

/**
 * Expected DPS for one loadout against one target profile.
 *
 * `levels` is a flat map of combat levels ALREADY boosted by prayer/potions —
 * the caller applies those through the engine's own `applyPrayerBonuses` so
 * this stays a pure function of the stats it is handed, exactly as
 * `processCombatTick` is of `boostedPlayerStats`.
 */
export function estimateDps({
  style,
  stance = null,
  spell = null,
  levels,
  equipment,
  itemsData,
  target,
  slayerTask = null,
  monsterId = null,
}) {
  const blocked = loadoutBlockedReason({ style, equipment, itemsData, spell })
  if (blocked) return { dps: 0, maxHit: 0, accuracy: 0, attackSpeedTicks: 0, blocked }
  if (target.immunity && target.immunity === style) {
    return { dps: 0, maxHit: 0, accuracy: 0, attackSpeedTicks: getAttackSpeed(equipment, itemsData), immune: true }
  }

  const bonuses = getEquipmentBonuses(equipment, itemsData)
  const setMult = getCombatSetMultipliers(equipment)
  const slayer = getSlayerTaskEquipmentBonuses({ equipment, itemsData, slayerTask, monsterId })
  const weapon = weaponOf(equipment, itemsData)
  let speed = getAttackSpeed(equipment, itemsData)

  let maxHit = 0
  let accuracy = 0
  let expected = 0
  let attackBonus = 0

  if (style === 'melee') {
    const styleBonuses = getMeleeStyleBonuses(stance)
    const weaponStyle = getMeleeAttackStyle(equipment, itemsData)
    attackBonus = bonuses.attackBonus[weaponStyle] || 0
    const effStr = effectiveStrength(levels.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
    maxHit = Math.floor(wornMeleeMaxHit(effStr, bonuses.otherBonus) * setMult.meleeDamage)
    maxHit = Math.floor(maxHit * (1 + slayer.damagePercent / 100))
    const effAtk = effectiveAttack(levels.attack, 0, 1.0, styleBonuses.attackStyleBonus)
    const atkRoll = Math.floor(maxAttackRoll(effAtk, attackBonus) * setMult.meleeAccuracy * (1 + slayer.accuracyPercent / 100))
    const defRoll = maxDefenceRoll(target.defenceLevel, target.defenceBonus[weaponStyle] || 0)
    accuracy = hitChance(atkRoll, defRoll)
    // Verac's flail: a 25% guaranteed hit on top of the normal roll.
    if (wearsAll(equipment, VERAC_SET)) accuracy += 0.25 * (1 - accuracy)
    expected = accuracy * meanRoll(maxHit)
    // Scythe passive: two extra rolls at 50% and 25% max hit, but only once the
    // first swing has connected.
    if (weapon?.scythePassive) {
      const extra = accuracy * meanRoll(Math.floor(maxHit * 0.5)) + accuracy * meanRoll(Math.floor(maxHit * 0.25))
      expected += accuracy * extra
    }
  } else if (style === 'ranged') {
    const styleBonus = getRangedStyleBonus(stance)
    attackBonus = bonuses.attackBonus.ranged || 0
    const effRng = effectiveRanged(levels.ranged, 0, 1.0, styleBonus)
    maxHit = Math.floor(wornRangedMaxHit(effRng, bonuses.otherBonus) * setMult.rangedDamage)
    let atkRoll = Math.floor(maxAttackRoll(effRng, attackBonus) * setMult.rangedAccuracy * (1 + slayer.accuracyPercent / 100))
    if (weapon?.dragonHunter && target.isDragon) {
      atkRoll = Math.floor(atkRoll * 1.3)
      maxHit = Math.floor(maxHit * 1.3)
    }
    if (weapon?.scalesWithMagic) {
      const M = Math.min(250, Math.max(1, target.magicLevel))
      const accInner = Math.floor(3 * M / 10) - 100
      const dmgInner = Math.floor(3 * M / 10) - 140
      const accMult = Math.min(140, Math.max(0, 140 + Math.floor((3 * M - 10) / 100) - Math.floor(accInner * accInner / 100))) / 100
      const dmgMult = Math.min(250, Math.max(0, 250 + Math.floor((3 * M - 14) / 100) - Math.floor(dmgInner * dmgInner / 100))) / 100
      atkRoll = Math.floor(atkRoll * accMult)
      maxHit = Math.floor(maxHit * dmgMult)
    }
    const defRoll = maxDefenceRoll(target.defenceLevel, target.defenceBonus.ranged || 0)
    accuracy = hitChance(atkRoll, defRoll)
    maxHit = Math.floor(maxHit * (1 + slayer.damagePercent / 100))
    expected = accuracy * meanRoll(maxHit)
    // Karil's crossbow: 25% chance of a second shot, rolled independently.
    if (wearsAll(equipment, KARIL_SET)) expected += 0.25 * accuracy * meanRoll(maxHit)
    if (stance === 'rapid') speed = Math.max(1, speed - 1)
  } else {
    attackBonus = bonuses.attackBonus.magic || 0
    const effMag = effectiveMagic(levels.magic)
    const atkRoll = Math.floor(maxAttackRoll(effMag, attackBonus) * setMult.magicAccuracy * (1 + slayer.accuracyPercent / 100))
    const defRoll = monsterMagicDefenceRoll(target.magicLevel, target.defenceLevel, target.defenceBonus.magic || 0)
    accuracy = hitChance(atkRoll, defRoll)
    const wornMagicDamage = getEffectiveWornMagicDamage(bonuses.otherBonus.magicDamage, equipment, itemsData)
    if (weapon?.poweredStaff) {
      const base = poweredStaffMagicBaseDamage(levels.magic, weapon)
      maxHit = Math.floor(magicMaxHit(base, wornMagicDamage + setMult.magicDamageBonusFlat) * (1 + slayer.damagePercent / 100))
    } else {
      const runeDamage = getSpellRuneMagicDamage(equipment, itemsData, spell)
      maxHit = Math.floor(magicMaxHit(spell.baseDamage, wornMagicDamage + setMult.magicDamageBonusFlat + runeDamage) * (1 + slayer.damagePercent / 100))
    }
    expected = accuracy * meanRoll(maxHit)
  }

  // Per-monster resistance (e.g. the Corporeal Horror halving every hit not
  // dealt with a spear) scales the landed hit, so it scales the expectation.
  expected *= monsterDamageMultiplier(target, weapon)

  const intervalSeconds = speed * secondsPerTick()
  return {
    dps: expected / intervalSeconds,
    damagePerSwing: expected,
    maxHit,
    accuracy,
    attackBonus,
    attackSpeedTicks: speed,
    intervalSeconds,
  }
}

/**
 * DPS across every form a monster rotates through, weighted as
 * `monsterTargets` weights them. This — not the opening form — is the number a
 * "which style should I bring" answer has to be built on.
 */
export function estimateDpsVsTargets(targets, params) {
  let dps = 0
  let maxHit = 0
  let accuracy = 0
  let totalWeight = 0
  let immuneWeight = 0
  let speed = 0
  for (const target of targets) {
    const r = estimateDps({ ...params, target })
    const w = target.weight || 1
    dps += r.dps * w
    accuracy += (r.accuracy || 0) * w
    maxHit = Math.max(maxHit, r.maxHit || 0)
    if (r.immune) immuneWeight += w
    speed = Math.max(speed, r.attackSpeedTicks || 0)
    totalWeight += w
  }
  if (!totalWeight) return { dps: 0, maxHit: 0, accuracy: 0, attackSpeedTicks: 0 }
  return {
    dps: dps / totalWeight,
    maxHit,
    accuracy: accuracy / totalWeight,
    attackSpeedTicks: speed,
    immuneShare: immuneWeight / totalWeight,
  }
}

/** Seconds to clear a target's health bar at this DPS. Null when it can't be. */
export function timeToKill(hitpoints, dps) {
  if (!(dps > 0) || !(hitpoints > 0)) return null
  return hitpoints / dps
}

export const DPS_MODEL_NOTES = [
  'Enchanted bolt effects are not modelled — ranged ammo is ranked on ranged strength.',
  "Dharok's damage bonus is not modelled; it is 1x at full health.",
  'Special attacks are excluded — they are manual and limited by special energy.',
]
