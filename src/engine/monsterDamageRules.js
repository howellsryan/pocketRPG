/**
 * Per-monster damage resistance — pure logic, no UI imports.
 *
 * A monster may declare `resistance: { multiplier, exemptWeaponClass }`: every
 * player hit is scaled by `multiplier` unless the equipped weapon carries the
 * exempt `weaponClass`. Live combat and the idle simulation both route through
 * here so a resisted boss can never be killed twice as fast by idling it.
 */

export function getMonsterResistance(monster) {
  const r = monster?.resistance
  if (!r) return null
  const multiplier = Number(r.multiplier)
  if (!Number.isFinite(multiplier) || multiplier < 0 || multiplier >= 1) return null
  return { multiplier, exemptWeaponClass: r.exemptWeaponClass || null }
}

/**
 * @param {object} monster - monster definition
 * @param {object|null} weapon - the equipped weapon's item definition
 * @returns {number} 1 when unresisted, else the monster's resistance multiplier
 */
export function monsterDamageMultiplier(monster, weapon) {
  const resistance = getMonsterResistance(monster)
  if (!resistance) return 1
  if (resistance.exemptWeaponClass && weapon?.weaponClass === resistance.exemptWeaponClass) return 1
  return resistance.multiplier
}

/** Apply the multiplier to a rolled hit, floored, never turning a hit into a miss. */
export function applyMonsterResistance(damage, monster, weapon) {
  const dmg = Math.max(0, Math.floor(Number(damage) || 0))
  if (dmg <= 0) return 0
  const multiplier = monsterDamageMultiplier(monster, weapon)
  if (multiplier === 1) return dmg
  return Math.max(1, Math.floor(dmg * multiplier))
}
