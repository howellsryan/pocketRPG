/**
 * Canonical world-combat section ordering, shared by the mobile
 * (CombatMobileSelect) and desktop (CombatScreen) pickers so the two
 * never drift apart. Categories/raids not listed fall to the end,
 * preserving their relative (data-declaration) order.
 */

export const COMBAT_CATEGORY_ORDER = [
  'training', 'slayer', 'dragons_lair', 'sunken_crypts', 'ashveil_highlands',
  'ironhold_fortress', 'verdant_wilds', 'wilderness', 'dagganoth_kings',
  'bossing', 'venomcoil_matriarch', 'blighted_gauntlet', 'fight_caves',
]

export const COMBAT_RAID_ORDER = ['cryptbound_champions', 'vaults_of_xyren', 'crimson_night_theatre']

export function orderBy(order, keyOf) {
  return (a, b) => {
    const ia = order.indexOf(keyOf(a))
    const ib = order.indexOf(keyOf(b))
    return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib)
  }
}
