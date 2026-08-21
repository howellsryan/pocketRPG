import { describe, it, expect } from 'vitest'
import { applyPrayerBonuses, applyPotionBonuses } from '../src/engine/combat.js'
import { buildBoostedPlayerStats } from '../src/engine/idleSupplies.js'

// Live (processCombatTick) and idle (simulateIdleCombat) must combine a
// potion's flat boost with a prayer's percentage boost in the SAME order —
// otherwise the two paths compute different effective stats for an
// identically-configured player, and idle XP/hr silently diverges from what
// live combat would actually do.
describe('prayer + potion boost ordering — live and idle agree, highest-boost order', () => {
  const prayersData: any = {
    piety: { id: 'piety', bonusType: 'multi_stat', stats: { attack: 20, strength: 23, defence: 25 }, level: 70 },
  }
  const potionItem: any = { id: 'super_strength', type: 'potion', effect: 'strength', boost: 19 }
  const baseStats = { attack: 80, strength: 80, defence: 80, ranged: 1, magic: 1 }

  it('idleSupplies.buildBoostedPlayerStats matches combat.js applying potion then prayer', () => {
    let live = applyPotionBonuses(baseStats, potionItem)
    live = applyPrayerBonuses(live, 'piety', prayersData)

    const idle = buildBoostedPlayerStats(baseStats, potionItem, 'piety', prayersData)

    expect(idle).toEqual(live)
  })

  it('potion-then-prayer yields a strictly higher boost than prayer-then-potion', () => {
    const potionFirst = applyPrayerBonuses(applyPotionBonuses(baseStats, potionItem), 'piety', prayersData)
    const prayerFirst = applyPotionBonuses(applyPrayerBonuses(baseStats, 'piety', prayersData), potionItem)

    expect(potionFirst.strength).toBeGreaterThan(prayerFirst.strength)
    expect(buildBoostedPlayerStats(baseStats, potionItem, 'piety', prayersData).strength).toBe(potionFirst.strength)
  })
})
