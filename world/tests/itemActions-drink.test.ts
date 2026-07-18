// Item 8 (P1): potion drinking. resolveDrink is the pure gate + effect the DO
// calls — proves potions register timed buffs, prayer potions refill the pool,
// the combo cooldown paces repeat drinks, and non-potions are refused.
import { describe, expect, it } from 'vitest'
import { resolveDrink, type DrinkActor } from '../shared/itemActions'

function actor(over: Partial<DrinkActor> = {}): DrinkActor {
  return { hp: 50, maxHP: 99, activePotions: {}, prayerPoints: 10, maxPrayerPoints: 40, ...over }
}

describe('resolveDrink', () => {
  it('registers a timed stat buff for a boost potion', () => {
    const a = actor()
    const r = resolveDrink(a, 'super_strength', 100, 0, 0)
    expect(r.allowed).toBe(true)
    expect(a.activePotions.super_strength).toBeGreaterThan(0)
  })

  it('refills the prayer pool from a prayer potion, capped at the max', () => {
    const a = actor({ prayerPoints: 30, maxPrayerPoints: 40 })
    const r = resolveDrink(a, 'prayer_potion', 100, 0, 0)
    if (!r.allowed) throw new Error('expected allowed')
    // Prayer potion restores 20 but the pool caps at 40, so only +10 lands.
    expect(r.result.prayerRestored).toBe(10)
    expect(a.prayerPoints).toBe(40)
  })

  it('runs on the combo cooldown: a repeat drink is blocked until the track is ready', () => {
    const first = resolveDrink(actor(), 'strength_potion', 100, 0, 0)
    if (!first.allowed) throw new Error('expected allowed')
    const blocked = resolveDrink(actor(), 'strength_potion', 100, first.eatReadyTick, first.comboReadyTick)
    expect(blocked.allowed).toBe(false)
    const ready = resolveDrink(actor(), 'strength_potion', first.comboReadyTick, first.eatReadyTick, first.comboReadyTick)
    expect(ready.allowed).toBe(true)
  })

  it('refuses a non-potion item', () => {
    expect(resolveDrink(actor(), 'bronze_arrow', 100, 0, 0).allowed).toBe(false)
  })
})
