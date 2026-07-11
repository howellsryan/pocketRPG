// INVARIANT (CLAUDE.md §4): combo consumables (every potion + food flagged
// combo:true, e.g. Karam) use a SEPARATE combo cooldown — one combo item may be
// used the same tick as one normal food and never delays the next attack.
// Normal food obeys the eat delay. Source of truth: src/engine/consumables.js.
import { describe, it, expect } from 'vitest'
import { isComboConsumable, isNormalFood } from '../../src/engine/consumables.js'

const potion = { type: 'potion' }
const brew = { type: 'potion', wipesPotions: true }
const karam = { type: 'food', combo: true }
const shrimp = { type: 'food' }

describe('combo-consumable classification', () => {
  it('treats every potion (and brew) as a combo consumable', () => {
    expect(isComboConsumable(potion)).toBe(true)
    expect(isComboConsumable(brew)).toBe(true)
  })
  it('treats combo-flagged food (Karam) as combo, but normal food as not', () => {
    expect(isComboConsumable(karam)).toBe(true)
    expect(isComboConsumable(shrimp)).toBe(false)
  })
  it('normal-food and combo classifications are mutually exclusive per item', () => {
    expect(isNormalFood(shrimp)).toBe(true)
    expect(isNormalFood(karam)).toBe(false)   // combo food is not normal food
    expect(isComboConsumable(shrimp)).toBe(false)
  })
  it('is null-safe', () => {
    expect(isComboConsumable(null as any)).toBe(false)
    expect(isNormalFood(undefined as any)).toBe(false)
  })
})
