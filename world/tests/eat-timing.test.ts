// Item 3 (P0): §4 eat timing. A normal food and a combo food each gate on their
// own 3-tick cooldown — one of each may land the same tick, never faster. Before
// this, the world's eat ran instantly outside the tick loop, letting a client
// heal many times per tick and out-tank any boss.
import { describe, expect, it } from 'vitest'
import { resolveEatTiming } from '../shared/itemActions'
import { EAT_TICK_COST } from '../../src/utils/constants.js'

describe('resolveEatTiming (world eat cooldown)', () => {
  it('blocks a second normal-food eat until EAT_TICK_COST ticks have passed', () => {
    const first = resolveEatTiming(10, false, 0, 0)
    expect(first.allowed).toBe(true)
    expect(first.eatReadyTick).toBe(10 + EAT_TICK_COST)

    // Every tick inside the window is refused.
    for (let t = 11; t < 10 + EAT_TICK_COST; t++) {
      expect(resolveEatTiming(t, false, first.eatReadyTick, first.comboReadyTick).allowed).toBe(false)
    }
    // The exact ready tick allows it again.
    expect(resolveEatTiming(10 + EAT_TICK_COST, false, first.eatReadyTick, first.comboReadyTick).allowed).toBe(true)
  })

  it('lets a combo item be used the same tick as a normal food (independent cooldowns)', () => {
    const ate = resolveEatTiming(5, false, 0, 0)
    expect(ate.allowed).toBe(true)
    // A combo item on the SAME tick is still allowed — separate track.
    const combo = resolveEatTiming(5, true, ate.eatReadyTick, ate.comboReadyTick)
    expect(combo.allowed).toBe(true)
    expect(combo.comboReadyTick).toBe(5 + EAT_TICK_COST)
    // ...but a second combo item that same tick is blocked.
    expect(resolveEatTiming(5, true, combo.eatReadyTick, combo.comboReadyTick).allowed).toBe(false)
    // ...and the normal-food track is unaffected by the combo use.
    expect(resolveEatTiming(5 + EAT_TICK_COST, false, combo.eatReadyTick, combo.comboReadyTick).allowed).toBe(true)
  })

  it('collapses the old spam exploit: many eats on one tick yield exactly one heal', () => {
    let eatReady = 0
    let comboReady = 0
    let heals = 0
    // Simulate 9 eat attempts on a single tick (the old 15 msg/s soft limit).
    for (let i = 0; i < 9; i++) {
      const r = resolveEatTiming(0, false, eatReady, comboReady)
      if (r.allowed) { heals++; eatReady = r.eatReadyTick; comboReady = r.comboReadyTick }
    }
    expect(heals).toBe(1)
  })
})
