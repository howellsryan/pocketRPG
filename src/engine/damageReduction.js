/**
 * Worn damage-reduction perks — pure logic, shared by PvE combat, the idle
 * simulation and PvP so one shield behaves identically everywhere.
 *
 * Perks are scalar `otherBonus` keys because `getEquipmentBonuses` sums
 * otherBonus values numerically — an object value there would corrupt the sum.
 * They are authored as 0-100 percentages so the equipment screen can render
 * them like any other bonus; the clamping and the conversion to fractions
 * happen here, after that summing.
 */

/** @returns {{chance:number, percent:number}|null} */
export function getDamageReductionPerk(bonuses) {
  const other = bonuses?.otherBonus
  if (!other) return null
  const chance = Math.max(0, Math.min(100, Number(other.damageReductionChance) || 0)) / 100
  const percent = Math.max(0, Math.min(100, Number(other.damageReductionPercent) || 0))
  if (chance <= 0 || percent <= 0) return null
  return { chance, percent }
}

/** Roll the perk once and reduce a single incoming hit. */
export function applyDamageReduction(damage, perk, random = Math.random) {
  const dmg = Math.max(0, Math.floor(Number(damage) || 0))
  if (!perk || dmg <= 0) return dmg
  if (random() >= perk.chance) return dmg
  return Math.max(0, dmg - Math.floor(dmg * perk.percent / 100))
}

/**
 * Long-run multiplier for a perk, for average-damage models (the idle sim)
 * that never roll individual hits.
 */
export function expectedDamageMultiplier(perk) {
  if (!perk) return 1
  return 1 - (perk.chance * perk.percent / 100)
}

/**
 * Reduce a whole swing: one proc roll, applied to every hit of a multi-hit
 * special so the reported total stays the sum of its parts.
 * @returns {{damage:number, hits:number[]|null, reduced:boolean}}
 */
export function applySwingDamageReduction(damage, hits, perk, random = Math.random) {
  const total = Math.max(0, Math.floor(Number(damage) || 0))
  if (!perk || total <= 0) return { damage: total, hits: hits || null, reduced: false }
  if (random() >= perk.chance) return { damage: total, hits: hits || null, reduced: false }
  const cut = (n) => {
    const v = Math.max(0, Math.floor(Number(n) || 0))
    return Math.max(0, v - Math.floor(v * perk.percent / 100))
  }
  if (Array.isArray(hits)) {
    const nextHits = hits.map(cut)
    return { damage: nextHits.reduce((sum, h) => sum + h, 0), hits: nextHits, reduced: true }
  }
  return { damage: cut(total), hits: null, reduced: true }
}

/** Prayer-drain multiplier from worn gear (Vigil sigil shield); reduction caps at 90%. */
export function getPrayerDrainMultiplier(bonuses) {
  const reduction = Math.max(0, Math.min(90, Number(bonuses?.otherBonus?.prayerDrainReduction) || 0))
  return 1 - reduction / 100
}
