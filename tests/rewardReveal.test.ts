// The reveal card is now the whole post-kill UI for an ordinary monster, so its
// queueing rules are gameplay: a cow dies well inside the card's 5s lifetime,
// and a plain queue would show loot from four kills ago while the player is
// already fighting the next one.

import { describe, expect, it } from 'vitest'
import { emitQuestCompletionReveal, mergeRevealQueue } from '../src/utils/rewardReveal.js'
import { bankXp } from '../src/engine/xpBank.js'

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

  it('does not mutate the queue it was handed', () => {
    const first = reveal()
    const queue = [first]
    mergeRevealQueue(queue, reveal())
    expect(queue[0].count).toBe(1)
    expect(first.rewards).toEqual([{ itemId: 'cowhide', quantity: 1 }])
  })
})

// A quest's reward card must show the XP the account BANKS, not the XP the
// quest is authored to pay: a Grindman who saw the full figure would watch a
// level fail to arrive that the card had just promised.
describe('emitQuestCompletionReveal — account XP cut', () => {
  // The emit is a window CustomEvent; the suite runs in node, so stand one up
  // for the duration of the call rather than pulling in a DOM environment.
  const captureReveal = (fn: () => void) => {
    const seen: any[] = []
    const prev = (globalThis as any).window
    ;(globalThis as any).window = { dispatchEvent: (ev: any) => { seen.push(ev.detail); return true } }
    try { fn() } finally { (globalThis as any).window = prev }
    return seen
  }

  const quests = [{ id: 'q', name: 'Cook Assistant' }]

  it('halves every skill on the card for a grindman', () => {
    const [card] = captureReveal(() => {
      emitQuestCompletionReveal(quests, { cooking: 500, attack: 301 }, 0, [], { isGrindman: true })
    })
    expect(card.rewards).toEqual([{ skill: 'cooking', xp: 250 }, { skill: 'attack', xp: 150 }])
  })

  it('leaves an ordinary account on the authored figure', () => {
    const [card] = captureReveal(() => {
      emitQuestCompletionReveal(quests, { cooking: 500, attack: 301 }, 0, [])
    })
    expect(card.rewards).toEqual([{ skill: 'cooking', xp: 500 }, { skill: 'attack', xp: 301 }])
  })

  it('never cuts the coins — the mode moves XP and drops, not gold', () => {
    const [card] = captureReveal(() => {
      emitQuestCompletionReveal(quests, {}, 1200, [], { isGrindman: true })
    })
    expect(card.rewards).toEqual([{ itemId: 'coins', quantity: 1200 }])
  })

  it('drops a skill whose halved reward rounds away, rather than promising 0 XP', () => {
    const [card] = captureReveal(() => {
      emitQuestCompletionReveal(quests, { cooking: 1 }, 5, [], { isGrindman: true })
    })
    expect(card.rewards).toEqual([{ itemId: 'coins', quantity: 5 }])
  })

  // The guard that matters: the card and the stats must never drift apart. The
  // display cut and the banking cut are the same function, and this fails the
  // build if either side ever grows its own arithmetic.
  it('shows exactly what bankXp writes into the skill', () => {
    for (const xp of [1, 2, 3, 99, 100, 501, 12_345]) {
      const stats: any = { cooking: { skill: 'cooking', xp: 0, level: 1 } }
      const banked = bankXp(stats, 'cooking', xp, { isGrindman: true })
      const [card] = captureReveal(() => {
        emitQuestCompletionReveal(quests, { cooking: xp }, 0, [], { isGrindman: true })
      })
      expect(card?.rewards?.[0]?.xp ?? 0).toBe(banked)
    }
  })
})
