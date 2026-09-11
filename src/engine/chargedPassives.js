const MELEE_STYLES = new Set(['melee', 'stab', 'slash', 'crush'])

export function chargedArmourRecoil(equipment, itemsData, attackStyle, damage) {
  if (!(Number(damage) > 0) || !MELEE_STYLES.has(attackStyle)) return null
  for (const [slot, entry] of Object.entries(equipment || {})) {
    if (!entry?.itemId || !(Number(entry.charges) > 0) || entry.active === false) continue
    const item = itemsData?.[entry.itemId]
    if (item?.chargedPassive !== 'melee_recoil') continue
    return { damage: 1, slot, itemId: entry.itemId, consumeCharges: 1 }
  }
  return null
}
