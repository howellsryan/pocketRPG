/**
 * Combat-style icon + boost amount for a prayer.
 *
 * Used by the combat screen's prayer panel and the idle combat setup
 * modal so both surfaces share one icon vocabulary:
 *   attack   → ⚔️
 *   strength → 💪
 *   defence  → 🛡️
 *   ranged   → 🏹
 *   magic    → 🔮
 *
 * Returns `{ icon, boostPercent }` when the prayer can be reformatted as
 * "+X% <icon>", or `null` to fall back to the prayer's bespoke emoji.
 *
 * Single-stat (`bonusType: 'stat'`) prayers below level 45 always
 * reformat. Multi-stat prayers reformat when they have a clear primary
 * style:
 *   - magic key            → magic
 *   - ranged or ranged_strength → ranged (max of the two values)
 *   - strength             → strength (the headline melee-damage stat)
 */
export function getPrayerStyleIcon(prayer) {
  if (!prayer) return null

  const STYLE_ICON = {
    attack: '⚔️',     // ⚔️
    strength: '💪',   // 💪
    defence: '🛡️', // 🛡️
    ranged: '🏹',     // 🏹
    magic: '🔮'       // 🔮
  }

  if (prayer.bonusType === 'stat' && prayer.level < 45) {
    const icon = STYLE_ICON[prayer.stat]
    if (!icon) return null
    return { icon, boostPercent: prayer.boostPercent }
  }

  if (prayer.bonusType === 'multi_stat' && prayer.stats) {
    if (prayer.stats.magic != null) {
      return { icon: STYLE_ICON.magic, boostPercent: prayer.stats.magic }
    }
    if (prayer.stats.ranged != null || prayer.stats.ranged_strength != null) {
      return {
        icon: STYLE_ICON.ranged,
        boostPercent: Math.max(prayer.stats.ranged ?? 0, prayer.stats.ranged_strength ?? 0)
      }
    }
    if (prayer.stats.strength != null) {
      return { icon: STYLE_ICON.strength, boostPercent: prayer.stats.strength }
    }
  }

  return null
}
