import { describe, expect, it } from 'vitest'
import { getEffectiveToolActionTicks } from '../src/engine/skilling.js'

const maxedWoodcuttingStats = {
  woodcutting: { xp: 13_034_431 },
} as any

const makeInventory = (itemId: string) => [
  { itemId, quantity: 1 },
  ...Array(27).fill(null),
] as any

const axeItems = {
  bronze_axe: {
    id: 'bronze_axe',
    name: 'Bronze axe',
    toolFor: 'woodcutting',
    requirements: { woodcutting: 1 },
  },
  iron_axe: {
    id: 'iron_axe',
    name: 'Iron axe',
    toolFor: 'woodcutting',
    requirements: { woodcutting: 1 },
  },
  rune_axe: {
    id: 'rune_axe',
    name: 'Rune axe',
    toolFor: 'woodcutting',
    requirements: { woodcutting: 41 },
  },
  crystal_axe: {
    id: 'crystal_axe',
    name: 'Crystal axe',
    toolFor: 'woodcutting',
    requirements: { woodcutting: 71 },
  },
  third_age_axe: {
    id: 'third_age_axe',
    name: 'Third-age axe',
    toolFor: 'woodcutting',
    requirements: { woodcutting: 61 },
  },
} as any

describe('woodcutting axe effective action ticks', () => {
  it('keeps bronze at the base action time', () => {
    expect(getEffectiveToolActionTicks(
      'woodcutting',
      4,
      {},
      axeItems,
      maxedWoodcuttingStats,
      makeInventory('bronze_axe'),
    )).toBe(4)
  })

  it('makes iron faster than bronze but slower than rune on low-tick trees', () => {
    const bronzeTicks = getEffectiveToolActionTicks(
      'woodcutting',
      4,
      {},
      axeItems,
      maxedWoodcuttingStats,
      makeInventory('bronze_axe'),
    )

    const ironTicks = getEffectiveToolActionTicks(
      'woodcutting',
      4,
      {},
      axeItems,
      maxedWoodcuttingStats,
      makeInventory('iron_axe'),
    )

    const runeTicks = getEffectiveToolActionTicks(
      'woodcutting',
      4,
      {},
      axeItems,
      maxedWoodcuttingStats,
      makeInventory('rune_axe'),
    )

    expect(ironTicks).toBeLessThan(bronzeTicks)
    expect(runeTicks).toBeLessThan(ironTicks)
  })

  it('makes crystal and third-age axes halve normal 4-tick tree actions', () => {
    expect(getEffectiveToolActionTicks(
      'woodcutting',
      4,
      {},
      axeItems,
      maxedWoodcuttingStats,
      makeInventory('crystal_axe'),
    )).toBe(2)

    expect(getEffectiveToolActionTicks(
      'woodcutting',
      4,
      {},
      axeItems,
      maxedWoodcuttingStats,
      makeInventory('third_age_axe'),
    )).toBe(2)
  })

  it('makes crystal and third-age axes the fastest on high-tick tree actions', () => {
    const runeTicks = getEffectiveToolActionTicks(
      'woodcutting',
      9,
      {},
      axeItems,
      maxedWoodcuttingStats,
      makeInventory('rune_axe'),
    )

    const crystalTicks = getEffectiveToolActionTicks(
      'woodcutting',
      9,
      {},
      axeItems,
      maxedWoodcuttingStats,
      makeInventory('crystal_axe'),
    )

    const thirdAgeTicks = getEffectiveToolActionTicks(
      'woodcutting',
      9,
      {},
      axeItems,
      maxedWoodcuttingStats,
      makeInventory('third_age_axe'),
    )

    expect(crystalTicks).toBe(4)
    expect(thirdAgeTicks).toBe(4)
    expect(crystalTicks).toBeLessThan(runeTicks)
    expect(thirdAgeTicks).toBeLessThan(runeTicks)
  })
})
