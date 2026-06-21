import { describe, it, expect } from 'vitest'
import {
  getMaxPrayerPoints,
  getPrayerDrainPerMinute,
  getActivePrayerDrainPerTick,
  getPrayerRestoreFromPotion,
  applyPrayerDrainTick,
  restorePrayerPoints,
  PRAYER_TICKS_PER_MINUTE,
  PRAYER_RESTORE_AMOUNTS,
} from '../src/engine/prayerDrain.js'
import prayers from '../src/data/prayers.json'

const prayersData = prayers as Record<string, any>

describe('prayerDrain — pool + rates', () => {
  it('max pool equals the Prayer level (clamped to >= 1)', () => {
    expect(getMaxPrayerPoints(99)).toBe(99)
    expect(getMaxPrayerPoints(1)).toBe(1)
    expect(getMaxPrayerPoints(0)).toBe(1)
    expect(getMaxPrayerPoints(undefined as any)).toBe(1)
  })

  it('higher-tier prayers drain faster than lower ones', () => {
    const thick = getPrayerDrainPerMinute('thick_skin', prayersData)       // +5%
    const steel = getPrayerDrainPerMinute('steel_skin', prayersData)       // +15%
    const piety = getPrayerDrainPerMinute('piety', prayersData)            // overhead
    expect(thick).toBeGreaterThan(0)
    expect(steel).toBeGreaterThan(thick)
    expect(piety).toBeGreaterThan(steel)
  })

  it('sums active prayers into a per-tick rate', () => {
    const perMin = getPrayerDrainPerMinute('protection_from_melee', prayersData)
      + getPrayerDrainPerMinute('piety', prayersData)
    const perTick = getActivePrayerDrainPerTick(['protection_from_melee', 'piety'], prayersData)
    expect(perTick).toBeCloseTo(perMin / PRAYER_TICKS_PER_MINUTE, 6)
  })
})

describe('prayerDrain — drain tick', () => {
  it('drains the pool and switches prayers off when it empties', () => {
    const state: any = {
      prayerPoints: 2,
      maxPrayerPoints: 99,
      prayerDrainAccumulator: 0,
      activeCombatPrayer: 'piety',
      activeProtectionPrayer: 'protection_from_melee',
    }
    let depleted = false
    // Piety (40/min) + Protect Melee (20/min) = 60/min = 0.6/tick → empties ~4 ticks.
    for (let i = 0; i < 200 && !depleted; i++) depleted = applyPrayerDrainTick(state, prayersData)
    expect(state.prayerPoints).toBe(0)
    expect(state.activeCombatPrayer).toBe(null)
    expect(state.activeProtectionPrayer).toBe(null)
    expect(depleted).toBe(true)
  })

  it('is a no-op when no prayers are active', () => {
    const state: any = { prayerPoints: 50, maxPrayerPoints: 99, activeCombatPrayer: null, activeProtectionPrayer: null }
    expect(applyPrayerDrainTick(state, prayersData)).toBe(false)
    expect(state.prayerPoints).toBe(50)
  })

  it('is a no-op until prayerPoints is a number (idle sim is untouched)', () => {
    const state: any = { activeCombatPrayer: 'piety' }
    expect(applyPrayerDrainTick(state, prayersData)).toBe(false)
  })
})

describe('prayerDrain — restore', () => {
  it('reports restore amounts for restore potions only', () => {
    expect(getPrayerRestoreFromPotion({ type: 'potion', effect: 'prayer' })).toBe(20)
    expect(getPrayerRestoreFromPotion({ type: 'potion', effect: 'super_restore' })).toBe(22)
    expect(getPrayerRestoreFromPotion({ type: 'potion', effect: 'attack' })).toBe(0)
    expect(getPrayerRestoreFromPotion({ type: 'food' })).toBe(0)
    expect(PRAYER_RESTORE_AMOUNTS.prayer).toBe(20)
    expect(PRAYER_RESTORE_AMOUNTS.super_restore).toBe(22)
  })

  it('restores points capped at the max', () => {
    const state: any = { prayerPoints: 10, maxPrayerPoints: 25 }
    expect(restorePrayerPoints(state, 20)).toBe(15) // capped at 25
    expect(state.prayerPoints).toBe(25)
  })
})
