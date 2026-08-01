import { describe, expect, it } from 'vitest'
import { lootLabel } from '../shared/lootLabel'
import { spawnDrops } from '../server/loot'

describe('lootLabel', () => {
  it('shows the count on a stack so a big coin pile is worth the walk', () => {
    expect(lootLabel('Coins', 12000)).toBe('Coins (12,000)')
  })

  it('leaves a single item unadorned', () => {
    expect(lootLabel('Dragon Scimitar', 1)).toBe('Dragon Scimitar')
  })

  it('never labels a non-stackable pile with a count, because the server never makes one', () => {
    // The two halves of the same rule: spawnDrops splits, so every label the
    // client builds for a non-stackable is a qty of 1.
    const piles = spawnDrops([{ itemId: 'shark', quantity: 4 }], 0, 0, '1', 0)
    expect(piles).toHaveLength(4)
    expect(piles.map((p) => lootLabel('Shark', p.qty))).toEqual(['Shark', 'Shark', 'Shark', 'Shark'])
  })
})
