export const PVP_SPECIAL_ATTACK_LABELS = {
  double_hit: '⚔️⚔️ Puncture',
  zero_defence: '🎯 Sever',
  stun: '🪱 Energy Drain',
  judgement: '⚡ The Judgement',
  healing_blade: '✨ Healing Blade',
  freeze: '❄️ Ice Cleave',
  warstrike: '💥 Warstrike',
  smash: '🔨 Smash',
  lightning: "⚡ Lumina Lightning",
  snapshot: '🏹🏹 Snapshot',
  pebble_shot: '🎯 Pebble Shot',
  shove: '🗡️ Shove',
  toxic_siphon: '🎋 Toxic Siphon',
  slice_and_dice: '🦀 Slice and Dice',
  lunge: '🔰 The Block',
  triple_hit: '🪨🪨🪨 Quake',
  descent_of_darkness: '🏹🏹 Descent of Darkness',
  overpower: '🔨 Overpower',
  soul_leech: '🩸 Soul Leech',
  gale_shot: '💨 Gale Shot',
  molten_crush: '🌋 Molten Crush',
  volley: '🌿🌿🌿 Volley',
}

export const SUPPORTED_PVP_SPECIAL_ATTACK_TYPES = new Set(Object.keys(PVP_SPECIAL_ATTACK_LABELS))

export function clampPvpSpecialEnergy(value, fallback = 100) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(100, Math.floor(parsed)))
}

export function getEquippedPvpSpecialAttack(combatant, itemsData) {
  const weaponEntry = combatant?.equipment?.weapon
  const weapon = weaponEntry ? itemsData?.[weaponEntry.itemId] : null
  const specialAttack = weapon?.specialAttack || null
  if (!weapon || !specialAttack) return null
  return {
    weapon,
    weaponId: weapon.id || weaponEntry.itemId,
    weaponName: weapon.name || weapon.id || weaponEntry.itemId,
    type: specialAttack.type || 'special',
    energyCost: Math.max(0, Number(specialAttack.energyCost) || 0),
    specialAttack,
  }
}

export function getPvpSpecialAttackLabel(type, fallback = '⚡ Special Attack') {
  return PVP_SPECIAL_ATTACK_LABELS[type] || fallback
}

export function hasEnoughPvpSpecialEnergy(combatant, itemsData) {
  const equipped = getEquippedPvpSpecialAttack(combatant, itemsData)
  if (!equipped) return false
  return clampPvpSpecialEnergy(combatant?.specialAttackEnergy, 0) >= equipped.energyCost
}

export function buildPvpSpecialAttackMeta({ attacker, weapon, spec, energyBefore, energyAfter, hits, totalDamage, extra = {} }) {
  const type = spec?.type || 'special'
  const cleanHits = Array.isArray(hits) ? hits.map(h => Math.max(0, Math.floor(Number(h) || 0))) : []
  return {
    type,
    label: getPvpSpecialAttackLabel(type),
    weaponId: weapon?.id || attacker?.equipment?.weapon?.itemId || null,
    weaponName: weapon?.name || weapon?.id || attacker?.equipment?.weapon?.itemId || 'Special weapon',
    energyCost: Math.max(0, Number(spec?.energyCost) || 0),
    energyBefore: clampPvpSpecialEnergy(energyBefore, 0),
    energyAfter: clampPvpSpecialEnergy(energyAfter, 0),
    hits: cleanHits,
    totalDamage: Math.max(0, Math.floor(Number(totalDamage) || 0)),
    ...extra,
  }
}
