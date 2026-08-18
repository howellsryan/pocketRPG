// The reveal card is now the whole post-kill UI for an ordinary monster, so its
// queueing rules are gameplay: a cow dies well inside the card's 5s lifetime,
// and a plain queue would show loot from four kills ago while the player is
// already fighting the next one.

import { describe, expect, it } from 'vitest'
import { mergeRevealQueue } from '../src/utils/rewardReveal.js'

const reveal = (over: any = {}) => ({
  id: `r${Math.random()}`,
  title: 'Cow Slain',
  icon: '⚔️',
  mergeKey: 'kill:cow',
  count: 1,
  rev: 0,
  rewards: [{ itemId: 'cowhide', quantity: 1 }],
  levelUps: [],
  ...over,
})

describe('mergeRevealQueue', () => {
  it('folds a repeat kill into the card already showing it', () => {
    const first = reveal()
    const queue = mergeRevealQueue(mergeRevealQueue([], first), reveal())
    expect(queue).toHaveLength(1)
    expect(queue[0].count).toBe(2)
    expect(queue[0].rewards).toEqual([{ itemId: 'cowhide', quantity: 2 }])
  })

  it('bumps rev so the dismiss timer restarts instead of expiring mid-grind', () => {
    const queue = mergeRevealQueue(mergeRevealQueue([], reveal()), reveal())
    expect(queue[0].rev).toBe(1)
    expect(queue[0].id).toBe(queue[0].id)
  })

  it('keeps a different monster on its own card', () => {
    const queue = mergeRevealQueue(mergeRevealQueue([], reveal()), reveal({ mergeKey: 'kill:goblin', title: 'Goblin Slain' }))
    expect(queue.map(r => r.mergeKey)).toEqual(['kill:cow', 'kill:goblin'])
  })

  it('merges into a card still waiting behind another, keeping its place in line', () => {
    const queue = [reveal({ mergeKey: null, title: 'Clue Complete' }), reveal()]
    const merged = mergeRevealQueue(queue, reveal())
    expect(merged.map(r => r.title)).toEqual(['Clue Complete', 'Cow Slain'])
    expect(merged[1].count).toBe(2)
  })

  it('never merges a keyless reveal — a clue and a quest are separate moments', () => {
    const clue = reveal({ mergeKey: null, title: 'Clue Complete' })
    const quest = reveal({ mergeKey: null, title: 'Quest Complete' })
    expect(mergeRevealQueue(mergeRevealQueue([], clue), quest)).toHaveLength(2)
  })

  it('sums a merged card by item and by skill separately', () => {
    const a = reveal({ rewards: [{ itemId: 'bones', quantity: 1 }, { skill: 'slayer', xp: 20 }] })
    const b = reveal({ rewards: [{ itemId: 'bones', quantity: 2 }, { skill: 'slayer', xp: 5 }, { itemId: 'coins', quantity: 9 }] })
    const [card] = mergeRevealQueue(mergeRevealQueue([], a), b)
    expect(card.rewards).toEqual([
      { itemId: 'bones', quantity: 3 },
      { skill: 'slayer', xp: 25 },
      { itemId: 'coins', quantity: 9 },
    ])
  })

  it('takes the newest title so a merged card names what just died', () => {
    const [card] = mergeRevealQueue(mergeRevealQueue([], reveal()), reveal({ title: 'Cow Slain', icon: '🐄' }))
    expect(card.icon).toBe('🐄')
  })

  it('keeps a merged card purple once any absorbed kill was epic', () => {
    const first = mergeRevealQueue([], reveal({ epic: true }))
    const merged = mergeRevealQueue(first, reveal({ epic: false }))
    expect(merged[0].epic).toBe(true)
  })

  it('leaves an all-ordinary merged card gold', () => {
    const first = mergeRevealQueue([], reveal({ epic: false }))
    const merged = mergeRevealQueue(first, reveal({ epic: false }))
    expect(merged[0].epic).toBe(false)
  })

  it('does not mutate the queue it was handed', () => {
    const first = reveal()
    const queue = [first]
    mergeRevealQueue(queue, reveal())
    expect(queue[0].count).toBe(1)
    expect(first.rewards).toEqual([{ itemId: 'cowhide', quantity: 1 }])
  })
})
