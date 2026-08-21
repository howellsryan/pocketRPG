/**
 * Combat bonuses a prayer grants beyond its level boost.
 *
 * `stat` / `multi_stat` prayers raise effective levels (applyPrayerBonuses in
 * combat.js), which for magic buys accuracy only — a spell's max hit is a
 * function of the spell's own base damage and magic-damage percentage points,
 * with no level term. `magicDamagePercent` is how a prayer reaches that second
 * number, so a magic prayer can raise damage the way Piety's strength boost
 * does for melee.
 *
 * The value is percentage POINTS added alongside worn magic damage, void's flat
 * bonus and a spell's rune bonus — deliberately outside
 * getEffectiveWornMagicDamage, for the same reason getSpellRuneMagicDamage is:
 * a prayer is not a worn passive, so a weapon's magic-damage multiplier and cap
 * must not scale it.
 */
export function getPrayerMagicDamageBonus(prayerIds, prayersData) {
  if (!prayersData || typeof prayersData !== 'object') return 0
  const ids = Array.isArray(prayerIds) ? prayerIds : [prayerIds]
  let bonus = 0
  for (const id of ids) {
    if (!id) continue
    const value = Number(prayersData[id]?.magicDamagePercent)
    if (Number.isFinite(value) && value > 0) bonus += value
  }
  return bonus
}
