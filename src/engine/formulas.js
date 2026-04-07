import { randInt } from '../utils/helpers.js'

/**
 * Calculate effective strength level for max hit
 */
export function effectiveStrength(strengthLevel, potionBonus = 0, prayerMult = 1.0, styleBonus = 0) {
  return Math.floor((strengthLevel + potionBonus) * prayerMult) + styleBonus + 8
}

/**
 * Calculate melee max hit
 */
export function meleeMaxHit(effectiveStr, equipmentStrengthBonus, gearMult = 1.0) {
  const base = Math.floor(0.5 + effectiveStr * (equipmentStrengthBonus + 64) / 640)
  return Math.floor(base * gearMult)
}

/**
 * Calculate effective attack level for accuracy
 */
export function effectiveAttack(attackLevel, potionBonus = 0, prayerMult = 1.0, styleBonus = 0) {
  return Math.floor((attackLevel + potionBonus) * prayerMult) + styleBonus + 8
}

/**
 * Calculate max attack roll
 */
export function maxAttackRoll(effectiveAtk, equipmentAttackBonus) {
  return effectiveAtk * (equipmentAttackBonus + 64)
}

/**
 * Calculate max defence roll (monster or player)
 */
export function maxDefenceRoll(defenceLevel, styleDefenceBonus) {
  return (defenceLevel + 9) * (styleDefenceBonus + 64)
}

/**
 * Calculate hit chance (accuracy) from attack and defence rolls
 */
export function hitChance(atkRoll, defRoll) {
  if (atkRoll > defRoll) {
    return 1 - (defRoll + 2) / (2 * (atkRoll + 1))
  } else {
    return atkRoll / (2 * (defRoll + 1))
  }
}

/**
 * Roll damage for an attack
 * Returns 0 for miss, 1-maxHit for hit
 */
export function rollDamage(accuracy, maxHit) {
  if (Math.random() < accuracy) {
    return randInt(1, Math.max(1, maxHit))
  }
  return 0
}

// ── Ranged ──

export function effectiveRanged(rangedLevel, potionBonus = 0, prayerMult = 1.0, styleBonus = 0) {
  return Math.floor((rangedLevel + potionBonus) * prayerMult) + styleBonus + 8
}

export function rangedMaxHit(effectiveRng, rangedStrengthBonus) {
  return Math.floor(0.5 + effectiveRng * (rangedStrengthBonus + 64) / 640)
}

// ── Magic ──

export function effectiveMagic(magicLevel, potionBonus = 0, prayerMult = 1.0, styleBonus = 0) {
  return Math.floor((magicLevel + potionBonus) * prayerMult) + styleBonus + 8
}

/**
 * Monster magic defence roll (70% Magic + 30% Defence)
 */
export function monsterMagicDefenceRoll(monsterMagicLevel, monsterDefenceLevel, magicDefenceBonus) {
  const effectiveDef = Math.floor(monsterMagicLevel * 0.7) + Math.floor(monsterDefenceLevel * 0.3) + 9
  return effectiveDef * (magicDefenceBonus + 64)
}

/**
 * Magic max hit (spell-based + equipment bonus)
 */
export function magicMaxHit(spellBaseDamage, magicDamageBonus = 0) {
  return Math.floor(spellBaseDamage * (1 + magicDamageBonus / 100))
}

// ── Style bonuses ──

/**
 * Get style bonuses for melee stances
 */
export function getMeleeStyleBonuses(stance) {
  switch (stance) {
    case 'accurate':    return { attackStyleBonus: 3, strengthStyleBonus: 0, defenceStyleBonus: 0 }
    case 'aggressive':  return { attackStyleBonus: 0, strengthStyleBonus: 3, defenceStyleBonus: 0 }
    case 'controlled':  return { attackStyleBonus: 1, strengthStyleBonus: 1, defenceStyleBonus: 1 }
    case 'defensive':   return { attackStyleBonus: 0, strengthStyleBonus: 0, defenceStyleBonus: 3 }
    default:            return { attackStyleBonus: 0, strengthStyleBonus: 0, defenceStyleBonus: 0 }
  }
}

/**
 * Get XP skill for melee stance
 */
export function getMeleeXPSkill(stance) {
  switch (stance) {
    case 'accurate':   return 'attack'
    case 'aggressive':  return 'strength'
    case 'defensive':   return 'defence'
    case 'controlled':  return ['attack', 'strength', 'defence'] // split evenly
    default:            return 'attack'
  }
}

/**
 * Get ranged style bonus
 */
export function getRangedStyleBonus(stance) {
  switch (stance) {
    case 'accurate':   return 3
    case 'rapid':      return 0
    case 'longrange':  return 3
    default:           return 0
  }
}

/**
 * Calculate potion bonus
 */
export function getPotionBonus(potionType, baseLevel) {
  switch (potionType) {
    case 'attack_potion':     return 3 + Math.floor(baseLevel * 0.10)
    case 'strength_potion':   return 3 + Math.floor(baseLevel * 0.10)
    case 'defence_potion':    return 3 + Math.floor(baseLevel * 0.10)
    case 'ranging_potion':    return 4 + Math.floor(baseLevel * 0.10)
    case 'super_attack':      return 5 + Math.floor(baseLevel * 0.15)
    case 'super_strength':    return 5 + Math.floor(baseLevel * 0.15)
    case 'super_defence':     return 5 + Math.floor(baseLevel * 0.15)
    default:                  return 0
  }
}
