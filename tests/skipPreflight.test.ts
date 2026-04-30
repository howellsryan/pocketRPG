import { describe, it, expect } from 'vitest'
import { SKIP_HOUR_MS, getSkipPreflight, isChargeableSkipOutcome } from '../src/engine/skipPreflight.js'

const baseCtx: any = { inventory: [], bank: {}, equipment: {}, stats: {}, itemsData: {}, questQueue: [] }

describe('skipPreflight', () => {
  it('validates clue with one scroll', () => {
    const task = { type: 'gather', gatherTask: { isClue: true, requiresItem: 'clue_scroll_medium', ticks: 500 } }
    const pre = getSkipPreflight(task as any, { ...baseCtx, bank: { clue_scroll_medium: { quantity: 1 } } }, SKIP_HOUR_MS)
    expect(pre.canSkip).toBe(true)
    expect(pre.actionCount).toBe(1)
  })
  it('rejects exhausted clues', () => {
    const task = { type: 'gather', gatherTask: { isClue: true, requiresItem: 'clue_scroll_medium', ticks: 500 } }
    const pre = getSkipPreflight(task as any, baseCtx, SKIP_HOUR_MS)
    expect(pre.canSkip).toBe(false)
    expect(pre.shouldStopTask).toBe(true)
  })
  it('caps clues by hour/actions', () => {
    const task = { type: 'gather', gatherTask: { isClue: true, requiresItem: 'clue_scroll_medium', ticks: 500 } }
    const pre = getSkipPreflight(task as any, { ...baseCtx, bank: { clue_scroll_medium: { quantity: 99 } } }, SKIP_HOUR_MS)
    expect(pre.actionCount).toBe(12)
  })
  it('rejects no-op outcomes', () => {
    expect(isChargeableSkipOutcome({ type: 'gather', gatherTask: { isClue: true } } as any, { actions: 0 })).toBe(false)
    expect(isChargeableSkipOutcome({ type: 'combat' } as any, { monstersKilled: 0 })).toBe(false)
  })
  it('accepts productive outcomes', () => {
    expect(isChargeableSkipOutcome({ type: 'skill' } as any, { actions: 1 })).toBe(true)
    expect(isChargeableSkipOutcome({ type: 'quest' } as any, { questCascade: true, elapsedMsUsed: 10 })).toBe(true)
  })
})
