import { describe, it, expect } from 'vitest'
import { getPvpHealAmount, isPvpFoodItem } from '../src/engine/pvpFood.js'

describe('pvpFood helpers', () => {
  it('prefers canonical heals field for PvP food checks', () => {
    expect(getPvpHealAmount({ heals: 20 })).toBe(20)
    expect(isPvpFoodItem({ heals: 20 })).toBe(true)
  })

  it('supports legacy heal field for backward compatibility', () => {
    expect(getPvpHealAmount({ heal: 12 })).toBe(12)
    expect(isPvpFoodItem({ heal: 12 })).toBe(true)
  })

  it('returns non-food for zero/invalid values', () => {
    expect(getPvpHealAmount({})).toBe(0)
    expect(getPvpHealAmount({ heals: 'abc' })).toBe(0)
    expect(isPvpFoodItem({ heals: 0 })).toBe(false)
  })
})
