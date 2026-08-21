import prayersData from '../data/prayers.json'
import itemsData from '../data/items.json'
import { getActivePotionBoosts } from './consumables.js'
import { getPrayerMagicDamageBonus } from './prayerCombatBonuses.js'

const PVP_MODIFIERS_PROTECTION_PRAYER_IDS = new Set([
  'protection_from_magic',
  'protection_from_missiles',
  'protection_from_melee',
])

function isProtectionPrayer(prayer) {
  return prayer?.bonusType === 'protection' || PVP_MODIFIERS_PROTECTION_PRAYER_IDS.has(prayer?.id)
}

function getPrayerMultipliers(prayerId) {
  const out = {
    attack: 1.0,
    strength: 1.0,
    defence: 1.0,
    ranged: 1.0,
    rangedStrength: 1.0,
    magic: 1.0,
  }
  const prayer = prayersData?.[prayerId]
  if (!prayer || isProtectionPrayer(prayer)) return out

  if (prayer.bonusType === 'stat') {
    const mult = 1 + ((Number(prayer.boostPercent) || 0) / 100)
    if (prayer.stat === 'attack') out.attack = mult
    if (prayer.stat === 'strength') out.strength = mult
    if (prayer.stat === 'defence') out.defence = mult
    if (prayer.stat === 'ranged') {
      out.ranged = mult
      out.rangedStrength = mult
    }
    if (prayer.stat === 'magic') out.magic = mult
    return out
  }

  if (prayer.bonusType === 'multi_stat' && prayer.stats) {
    const stats = prayer.stats
    if (stats.attack != null) out.attack = 1 + (Number(stats.attack) / 100)
    if (stats.strength != null) out.strength = 1 + (Number(stats.strength) / 100)
    if (stats.defence != null) out.defence = 1 + (Number(stats.defence) / 100)
    if (stats.ranged != null) out.ranged = 1 + (Number(stats.ranged) / 100)
    if (stats.ranged_strength != null) out.rangedStrength = 1 + (Number(stats.ranged_strength) / 100)
    if (stats.magic != null) out.magic = 1 + (Number(stats.magic) / 100)
  }
  return out
}

export function getPvpCombatModifiers(combatant) {
  const prayer = getPrayerMultipliers(combatant?.activeCombatPrayer)
  const potions = getActivePotionBoosts(combatant?.activePotions, itemsData)
  // Percentage points, not a multiplier like the entries above — it is added
  // alongside worn magic damage rather than scaling a level.
  const magicDamagePercent = getPrayerMagicDamageBonus([combatant?.activeCombatPrayer], prayersData)
  return { prayer, potions, magicDamagePercent }
}
