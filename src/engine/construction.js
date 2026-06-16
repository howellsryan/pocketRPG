// Construction content tables, shared between the Construction screen and the
// MCP save intents so the build actions and perk unlocks have a single source
// of truth. Construction is trained by building with planks (instant per-build
// XP that consumes one plank), and two level-gated perks toggle account-wide
// conveniences.

export const BUILDING_ACTIONS = [
  { id: 'build_plank', name: 'Build with Plank', level: 1, ticks: 2, xp: 29, materials: { plank: 1 } },
  { id: 'build_oak_plank', name: 'Build with Oak Plank', level: 15, ticks: 2, xp: 60, materials: { oak_plank: 1 } },
  { id: 'build_teak_plank', name: 'Build with Teak Plank', level: 35, ticks: 2, xp: 90, materials: { teak_plank: 1 } },
  { id: 'build_mahogany_plank', name: 'Build with Mahogany Plank', level: 70, ticks: 2, xp: 140, materials: { mahogany_plank: 1 } },
]

export const UNLOCKABLES = [
  {
    id: 'money_purse',
    name: 'Create Money Purse',
    level: 70,
    description: 'Spend coins directly from your bank when shopping, without withdrawing them first.',
    icon: '👛',
  },
  {
    id: 'master_rejuvenation',
    name: 'Create Master Rejuvenation',
    level: 90,
    description: 'Passively refills your special attack bar to 100% whenever it empties during a fight.',
    icon: '⚡',
  },
]

export function findBuildingAction(id) {
  return BUILDING_ACTIONS.find((a) => a.id === id) || null
}

export function findConstructionPerk(id) {
  return UNLOCKABLES.find((p) => p.id === id) || null
}
