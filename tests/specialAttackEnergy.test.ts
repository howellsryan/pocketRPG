import { describe, expect, it } from 'vitest'
import {
  resolveSpecialEnergyCost,
  canAffordSpecialAttack,
  formatSpecialEnergyCostLabel,
} from '../src/engine/specialAttackEnergy.js'

describe('flat-cost specials (existing behavior, byte-identical)', () => {
  it('resolveSpecialEnergyCost returns the flat energyCost regardless of current energy', () => {
    expect(resolveSpecialEnergyCost({ energyCost: 50 }, 100)).toBe(50)
    expect(resolveSpecialEnergyCost({ energyCost: 50 }, 40)).toBe(50)
  })

  it('canAffordSpecialAttack matches the old currentEnergy >= energyCost check', () => {
    expect(canAffordSpecialAttack({ energyCost: 50 }, 50)).toBe(true)
    expect(canAffordSpecialAttack({ energyCost: 50 }, 40)).toBe(false)
    expect(canAffordSpecialAttack({ energyCost: 0 }, 0)).toBe(true)
  })

  it('treats a missing energyCost as 0', () => {
    expect(resolveSpecialEnergyCost({}, 100)).toBe(0)
    expect(canAffordSpecialAttack({}, 0)).toBe(true)
  })
})

describe('percent-cost specials (energyCostPercent)', () => {
  it('spends a ceiled percentage of current energy', () => {
    expect(resolveSpecialEnergyCost({ energyCostPercent: 50 }, 100)).toBe(50)
    expect(resolveSpecialEnergyCost({ energyCostPercent: 50 }, 41)).toBe(21) // ceil(20.5) = 21
  })

  it('floors the cost at 1 so a tiny energy pool still pays something', () => {
    expect(resolveSpecialEnergyCost({ energyCostPercent: 10 }, 3)).toBe(1) // ceil(0.3) = 1, min 1
  })

  it('never charges more than the energy currently on hand', () => {
    expect(resolveSpecialEnergyCost({ energyCostPercent: 150 }, 10)).toBe(10)
  })

  it('canAffordSpecialAttack allows any percent-cost special as long as energy > 0', () => {
    expect(canAffordSpecialAttack({ energyCostPercent: 50 }, 1)).toBe(true)
    expect(canAffordSpecialAttack({ energyCostPercent: 50 }, 0)).toBe(false)
  })

  it('treats negative/NaN current energy as 0', () => {
    expect(resolveSpecialEnergyCost({ energyCostPercent: 50 }, -5)).toBe(0)
    expect(canAffordSpecialAttack({ energyCostPercent: 50 }, NaN)).toBe(false)
  })
})

describe('formatSpecialEnergyCostLabel', () => {
  it('labels a percent-cost special by its percent-of-current phrasing', () => {
    expect(formatSpecialEnergyCostLabel({ energyCostPercent: 50 })).toBe('50% of current energy')
  })

  it('labels a flat-cost special using its numeric energyCost', () => {
    expect(formatSpecialEnergyCostLabel({ energyCost: 50 })).toBe('50% cost')
  })
})
