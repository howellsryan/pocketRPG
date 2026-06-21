// Clue reward rolling + completion timing. rollClueRewards uses RNG, so the
// tests pin structural invariants (valid item refs, merged stacks, count range)
// rather than exact draws; getClueCompletionTicks is deterministic.

import { describe, it, expect } from 'vitest'
import { rollClueRewards, getClueCompletionTicks } from '../src/engine/clueScrolls.js'
import cluesData from '../src/data/clues.json'
import itemsData from '../src/data/items.json'

const items = itemsData as Record<string, unknown>
const clues = cluesData as Record<string, { rewards: Array<{ itemId: string; weight: number; quantity: number }> }>

describe('getClueCompletionTicks', () => {
  it('maps each tier to its tick cost', () => {
    expect(getClueCompletionTicks('medium')).toBe(500)
    expect(getClueCompletionTicks('hard')).toBe(1500)
    expect(getClueCompletionTicks('elite')).toBe(3000)
    expect(getClueCompletionTicks('master')).toBe(6000)
  })

  it('falls back to 500 for an unknown tier', () => {
    expect(getClueCompletionTicks('mystery' as any)).toBe(500)
  })
})

describe('rollClueRewards', () => {
  it('returns an empty array for an unknown clue level', () => {
    expect(rollClueRewards('nonexistent')).toEqual([])
  })

  it('produces 1-4 reward entries, all valid items, with merged stacks', () => {
    const levels = Object.keys(clues)
    expect(levels.length).toBeGreaterThan(0)

    for (const level of levels) {
      for (let i = 0; i < 50; i++) {
        const rewards = rollClueRewards(level)
        expect(rewards.length).toBeGreaterThanOrEqual(1)
        expect(rewards.length).toBeLessThanOrEqual(4)

        const seen = new Set<string>()
        for (const r of rewards) {
          // Each itemId appears once (duplicate draws merge into quantity).
          expect(seen.has(r.itemId)).toBe(false)
          seen.add(r.itemId)
          expect(r.quantity).toBeGreaterThan(0)
          expect(items[r.itemId], `clue ${level} rolled missing item "${r.itemId}"`).toBeDefined()
        }
      }
    }
  })
})

describe('clues.json data contract', () => {
  it('every reward references a real item', () => {
    for (const [level, data] of Object.entries(clues)) {
      for (const reward of data.rewards) {
        expect(items[reward.itemId], `clue ${level} lists missing item "${reward.itemId}"`).toBeDefined()
        expect(reward.weight).toBeGreaterThan(0)
      }
    }
  })
})
