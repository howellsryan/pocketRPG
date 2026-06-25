import { describe, it, expect } from 'vitest'
import { selectDailyTasks, COMPLEXITY_ORDER_SERVER } from '../functions/_lib/game/dailyTasks.js'
import pool from '../src/data/dailyTasks.json'

describe('selectDailyTasks', () => {
  it('returns exactly one task per tier', () => {
    const tasks = selectDailyTasks('char-1', '2026-01-01', pool)
    expect(tasks.length).toBe(COMPLEXITY_ORDER_SERVER.length)
    for (const tier of COMPLEXITY_ORDER_SERVER) {
      const matching = tasks.filter(t => t.tier === tier)
      expect(matching.length, `tier ${tier}`).toBe(1)
    }
  })

  it('is deterministic for the same (characterId, dateKey)', () => {
    const a = selectDailyTasks('char-42', '2026-06-01', pool)
    const b = selectDailyTasks('char-42', '2026-06-01', pool)
    expect(a.map(t => t.taskId)).toEqual(b.map(t => t.taskId))
  })

  it('produces different tasks for different dates', () => {
    const day1 = selectDailyTasks('char-42', '2026-06-01', pool)
    const day2 = selectDailyTasks('char-42', '2026-06-02', pool)
    // May theoretically clash on a single tier but extremely unlikely across all 5
    const ids1 = day1.map(t => t.taskId).join(',')
    const ids2 = day2.map(t => t.taskId).join(',')
    expect(ids1).not.toBe(ids2)
  })

  it('produces different tasks for different characterIds on the same date', () => {
    const c1 = selectDailyTasks('char-1', '2026-06-01', pool)
    const c2 = selectDailyTasks('char-2', '2026-06-01', pool)
    const ids1 = c1.map(t => t.taskId).join(',')
    const ids2 = c2.map(t => t.taskId).join(',')
    expect(ids1).not.toBe(ids2)
  })

  it('each task carries a valid taskId from the pool', () => {
    const poolIds = new Set(pool.map(t => t.id))
    const tasks = selectDailyTasks('char-99', '2026-03-15', pool)
    for (const task of tasks) {
      expect(poolIds, `unknown id "${task.taskId}"`).toContain(task.taskId)
    }
  })

  it('slots are numbered 0..4', () => {
    const tasks = selectDailyTasks('char-7', '2026-04-20', pool)
    expect(tasks.map(t => t.slot)).toEqual([0, 1, 2, 3, 4])
  })
})
