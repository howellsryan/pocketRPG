import { describe, it, expect } from 'vitest'
import {
  detectLevelUps,
  detectCountIncreases,
  detectSetGrowth,
  didNumberIncrease,
  isCriticalDrop,
  hasCriticalDrop,
} from '../src/cloud/criticalSavePolicy.js'

describe('criticalSavePolicy', () => {
  it('detectLevelUps ignores xp-only changes without a level-up', () => {
    const previous = { attack: 10 }
    const next = { attack: { level: 10, xp: 1200 } }
    expect(detectLevelUps(previous, next)).toEqual([])
  })

  it('detectLevelUps returns single and multiple level-up events', () => {
    expect(detectLevelUps({ attack: 10 }, { attack: { level: 11 } })).toEqual([
      { skill: 'attack', previousLevel: 10, nextLevel: 11 },
    ])
    expect(detectLevelUps({ attack: 10, strength: 20 }, { attack: { level: 11 }, strength: { level: 21 } })).toHaveLength(2)
  })

  it('detectLevelUps does not treat first-seen levels as level-ups', () => {
    expect(detectLevelUps({}, { attack: { level: 11 } })).toEqual([])
  })

  it('detectCountIncreases only reports upward changes', () => {
    expect(detectCountIncreases({ dragon: 1 }, { dragon: 2 })).toEqual([{ id: 'dragon', previousCount: 1, nextCount: 2 }])
    expect(detectCountIncreases({ dragon: 2 }, { dragon: 2 })).toEqual([])
    expect(detectCountIncreases({ dragon: 2 }, { dragon: 1 })).toEqual([])
    expect(detectCountIncreases({ dragon: 2 }, {})).toEqual([])
  })

  it('detectSetGrowth tracks newly added entries only', () => {
    expect(detectSetGrowth(new Set(['q1']), new Set(['q1', 'q2']))).toEqual(['q2'])
    expect(detectSetGrowth(new Set(['money_purse']), new Set(['money_purse', 'master_rejuvenation']))).toEqual(['master_rejuvenation'])
    expect(detectSetGrowth(new Set(['q1']), new Set(['q1']))).toEqual([])
  })

  it('didNumberIncrease returns true only for increases', () => {
    expect(didNumberIncrease(10, 11)).toBe(true)
    expect(didNumberIncrease(10, 10)).toBe(false)
    expect(didNumberIncrease(10, 9)).toBe(false)
  })

  it('critical drop checks respect chance threshold and metadata flags', () => {
    const monster = {
      drops: [
        { itemId: 'bones', chance: 1 },
        { itemId: 'herb', chance: 0.02 },
        { itemId: 'pet', chance: 0.005 },
      ],
    }
    expect(isCriticalDrop({ itemId: 'bones' }, monster, {})).toBe(false)
    expect(isCriticalDrop({ itemId: 'herb' }, monster, {})).toBe(false)
    expect(isCriticalDrop({ itemId: 'pet' }, monster, {})).toBe(true)
    expect(isCriticalDrop({ itemId: 'flagged' }, null, { flagged: { criticalSave: true } })).toBe(true)
  })

  it('hasCriticalDrop is tolerant of missing metadata', () => {
    expect(hasCriticalDrop([{ itemId: 'unknown' }], null, {})).toBe(false)
    expect(() => hasCriticalDrop([{ id: 'unknown' }], { drops: [{ id: 'unknown', chance: 0.005 }] }, {})).not.toThrow()
  })
})
