import { describe, it, expect } from 'vitest'
import {
  isSkillMaxed,
  isMaxedTotal,
  isQuestComplete,
  isMinigameItemUnlocked,
  isUnlockOwned,
} from '../src/utils/completion.js'
import { MAX_TOTAL_LEVEL } from '../src/utils/constants.js'

describe('isSkillMaxed', () => {
  it('is true only at level 99 or above', () => {
    expect(isSkillMaxed(98)).toBe(false)
    expect(isSkillMaxed(99)).toBe(true)
    expect(isSkillMaxed(100)).toBe(true)
  })

  it('coerces string levels and handles missing input', () => {
    expect(isSkillMaxed('99')).toBe(true)
    expect(isSkillMaxed('98')).toBe(false)
    expect(isSkillMaxed(undefined)).toBe(false)
  })
})

describe('isMaxedTotal', () => {
  it('caps at 2376 (24 skills × 99)', () => {
    expect(MAX_TOTAL_LEVEL).toBe(2376)
  })

  it('is true only at the total-level cap or above', () => {
    expect(isMaxedTotal(2375)).toBe(false)
    expect(isMaxedTotal(2376)).toBe(true)
    expect(isMaxedTotal(2377)).toBe(true)
  })

  it('coerces strings and handles missing input', () => {
    expect(isMaxedTotal('2376')).toBe(true)
    expect(isMaxedTotal('2375')).toBe(false)
    expect(isMaxedTotal(undefined)).toBe(false)
  })
})

describe('isQuestComplete', () => {
  it('reflects set membership', () => {
    const done = new Set(['cooks_assistant'])
    expect(isQuestComplete(done, 'cooks_assistant')).toBe(true)
    expect(isQuestComplete(done, 'dragon_slayer')).toBe(false)
  })

  it('is safe when the set is missing', () => {
    expect(isQuestComplete(null, 'cooks_assistant')).toBe(false)
    expect(isQuestComplete(undefined, 'cooks_assistant')).toBe(false)
  })
})

describe('isMinigameItemUnlocked', () => {
  it('reflects set membership', () => {
    const unlocked = new Set(['fighter_body'])
    expect(isMinigameItemUnlocked(unlocked, 'fighter_body')).toBe(true)
    expect(isMinigameItemUnlocked(unlocked, 'fighter_torso')).toBe(false)
  })

  it('is safe when the set is missing', () => {
    expect(isMinigameItemUnlocked(null, 'fighter_body')).toBe(false)
  })
})

describe('isUnlockOwned', () => {
  it('requires a strict true flag', () => {
    expect(isUnlockOwned({ doubleSlayerXp: true }, 'doubleSlayerXp')).toBe(true)
    expect(isUnlockOwned({ doubleSlayerXp: false }, 'doubleSlayerXp')).toBe(false)
    expect(isUnlockOwned({ doubleSlayerXp: 1 }, 'doubleSlayerXp')).toBe(false)
    expect(isUnlockOwned({}, 'doubleSlayerXp')).toBe(false)
  })

  it('is safe when unlocks are missing', () => {
    expect(isUnlockOwned(null, 'doubleSlayerXp')).toBe(false)
    expect(isUnlockOwned(undefined, 'doubleSlayerXp')).toBe(false)
  })
})
