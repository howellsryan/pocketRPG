export const OTHER_BONUS_LABELS = {
  meleeStrength: 'Melee Strength',
  rangedStrength: 'Ranged Strength',
  magicDamage: 'Magic Damage %',
  meleeDamage: 'Melee Damage %',
  rangedDamage: 'Ranged Damage %',
  fishingXpPercent: 'Fishing XP Boost %',
  herbYieldPercent: 'Herb Yield Boost %',
  runecraftYieldPercent: 'Rune Yield Boost %',
  essenceYieldPercent: 'Essence Yield Boost %',
  smithingYieldPercent: 'Smithing Yield Boost %',
  prayer: 'Prayer Bonus',
  miningLevel: 'Mining Level',
  woodcuttingLevel: 'Woodcutting Level',
  antiDragon: 'Anti-Dragonfire',
  barrowsDharokBonus: "Dravok's Set Effect",
  barrowsGuthanBonus: "Gorath's Set Effect",
  barrowsAhrimBonus: "Morvyn's Set Effect",
  barrowsKarilBonus: "Kaelor's Set Effect",
  barrowsToragBonus: "Torvek's Set Effect",
  barrowsVeracBonus: "Verin's Set Effect",
  slayerTaskAccuracyPercent: 'Slayer Task Accuracy',
  slayerTaskDamagePercent: 'Slayer Task Damage',
  damageReductionChance: 'Damage Block Chance',
  damageReductionPercent: 'Damage Blocked',
  prayerDrainReduction: 'Prayer Drain Reduction'
}

export const OTHER_BONUS_PERCENT_KEYS = new Set(['magicDamage', 'meleeDamage', 'rangedDamage', 'fishingXpPercent', 'herbYieldPercent', 'runecraftYieldPercent', 'essenceYieldPercent', 'smithingYieldPercent', 'slayerTaskAccuracyPercent', 'slayerTaskDamagePercent', 'damageReductionChance', 'damageReductionPercent', 'prayerDrainReduction'])

/**
 * Label for a conditional, element-only magic damage bonus (`spellRuneDamage`)
 * — "Magic Damage (Fire spells)". The element is derived from the rune id, so a
 * book keyed on any rune labels itself with no table to extend here.
 */
export function spellRuneDamageLabel(runeId) {
  const element = String(runeId || '').replace(/_rune$/, '').replace(/_/g, ' ').trim()
  if (!element) return 'Magic Damage %'
  return `Magic Damage (${element.charAt(0).toUpperCase() + element.slice(1)} spells)`
}
