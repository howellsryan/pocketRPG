import { describe, expect, it } from 'vitest'
import { resolveSlayerTaskKill, doesSlayerTaskMatchMonster } from '../src/engine/slayerTasks.js'

describe('resolveSlayerTaskKill', () => {
  it('does nothing when the killed monster is not on task', () => {
    const task = { monsterId: 'goblin', monstersRemaining: 3, pointsOnComplete: 4 }
    const result = resolveSlayerTaskKill(task, 'cow', 1)
    expect(result.onTask).toBe(false)
    expect(result.completed).toBe(false)
    expect(result.task).toEqual(task)
    expect(result.killsApplied).toBe(0)
    expect(result.pointsAwarded).toBe(0)
  })

  it('decrements an active task without awarding points before completion', () => {
    const task = { monsterId: 'goblin', monstersRemaining: 3, pointsOnComplete: 4 }
    const result = resolveSlayerTaskKill(task, 'goblin', 1)
    expect(result.onTask).toBe(true)
    expect(result.completed).toBe(false)
    expect(result.task?.monstersRemaining).toBe(2)
    expect(result.killsApplied).toBe(1)
    expect(result.pointsAwarded).toBe(0)
  })

  it('awards points exactly once when the final kill completes the task', () => {
    const task = { monsterId: 'goblin', monstersRemaining: 1, pointsOnComplete: 4 }
    const result = resolveSlayerTaskKill(task, 'goblin', 1)
    expect(result.onTask).toBe(true)
    expect(result.completed).toBe(true)
    expect(result.task).toBe(null)
    expect(result.killsApplied).toBe(1)
    expect(result.pointsAwarded).toBe(4)
  })

  it('caps applied kills to remaining task count during idle overkill', () => {
    const task = { monsterId: 'goblin', monstersRemaining: 2, pointsOnComplete: 4 }
    const result = resolveSlayerTaskKill(task, 'goblin', 10)
    expect(result.onTask).toBe(true)
    expect(result.completed).toBe(true)
    expect(result.task).toBe(null)
    expect(result.killsApplied).toBe(2)
    expect(result.pointsAwarded).toBe(4)
  })

  it('completes zero-point tasks without awarding points', () => {
    const task = { monsterId: 'chicken', monstersRemaining: 1, pointsOnComplete: 0 }
    const result = resolveSlayerTaskKill(task, 'chicken', 1)
    expect(result.completed).toBe(true)
    expect(result.task).toBe(null)
    expect(result.killsApplied).toBe(1)
    expect(result.pointsAwarded).toBe(0)
  })

  it('normalises invalid kill counts without changing the task', () => {
    const task = { monsterId: 'goblin', monstersRemaining: 3, pointsOnComplete: 4 }
    const result = resolveSlayerTaskKill(task, 'goblin', -10)
    expect(result.onTask).toBe(true)
    expect(result.completed).toBe(false)
    expect(result.task).toEqual(task)
    expect(result.killsApplied).toBe(0)
    expect(result.pointsAwarded).toBe(0)
  })

  it('does not award points when resolving a null task after completion', () => {
    const completed = resolveSlayerTaskKill({ monsterId: 'goblin', monstersRemaining: 1, pointsOnComplete: 15 }, 'goblin', 1)
    expect(completed.completed).toBe(true)
    expect(completed.pointsAwarded).toBe(15)
    const rerun = resolveSlayerTaskKill(completed.task, 'goblin', 1)
    expect(rerun.completed).toBe(false)
    expect(rerun.pointsAwarded).toBe(0)
  })

})


describe('doesSlayerTaskMatchMonster', () => {
  it('treats Nagadoth kings as equivalent for slayer task matching', () => {
    expect(doesSlayerTaskMatchMonster('dagganoth_rex', 'dagganoth_prime')).toBe(true)
    expect(doesSlayerTaskMatchMonster('dagganoth_rex', 'dagganoth_supreme')).toBe(true)
    expect(doesSlayerTaskMatchMonster('dagganoth_prime', 'dagganoth_supreme')).toBe(true)
  })



  it('matches nagadoth kings task id to any king', () => {
    expect(doesSlayerTaskMatchMonster('dagganoth_kings', 'dagganoth_rex')).toBe(true)
    expect(doesSlayerTaskMatchMonster('dagganoth_kings', 'dagganoth_prime')).toBe(true)
    expect(doesSlayerTaskMatchMonster('dagganoth_kings', 'dagganoth_supreme')).toBe(true)
  })

  it('does not treat unrelated monsters as equivalent', () => {
    expect(doesSlayerTaskMatchMonster('dagganoth_rex', 'kraken')).toBe(false)
  })
})
