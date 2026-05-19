import { describe, expect, it } from 'vitest'
import { resolveSlayerTaskKill, doesSlayerTaskMatchMonster, canFightSlayerMonster } from '../src/engine/slayerTasks.js'

describe('resolveSlayerTaskKill', () => {
  it('does nothing when the killed monster is not on task', () => {
    const task = { monsterId: 'cave_goblin', monstersRemaining: 3, pointsOnComplete: 4 }
    const result = resolveSlayerTaskKill(task, 'pasture_bull', 1)
    expect(result.onTask).toBe(false)
    expect(result.completed).toBe(false)
    expect(result.task).toEqual(task)
    expect(result.killsApplied).toBe(0)
    expect(result.pointsAwarded).toBe(0)
  })

  it('decrements an active task without awarding points before completion', () => {
    const task = { monsterId: 'cave_goblin', monstersRemaining: 3, pointsOnComplete: 4 }
    const result = resolveSlayerTaskKill(task, 'cave_goblin', 1)
    expect(result.onTask).toBe(true)
    expect(result.completed).toBe(false)
    expect(result.task?.monstersRemaining).toBe(2)
    expect(result.killsApplied).toBe(1)
    expect(result.pointsAwarded).toBe(0)
  })

  it('awards points exactly once when the final kill completes the task', () => {
    const task = { monsterId: 'cave_goblin', monstersRemaining: 1, pointsOnComplete: 4 }
    const result = resolveSlayerTaskKill(task, 'cave_goblin', 1)
    expect(result.onTask).toBe(true)
    expect(result.completed).toBe(true)
    expect(result.task).toBe(null)
    expect(result.killsApplied).toBe(1)
    expect(result.pointsAwarded).toBe(4)
  })

  it('caps applied kills to remaining task count during idle overkill', () => {
    const task = { monsterId: 'cave_goblin', monstersRemaining: 2, pointsOnComplete: 4 }
    const result = resolveSlayerTaskKill(task, 'cave_goblin', 10)
    expect(result.onTask).toBe(true)
    expect(result.completed).toBe(true)
    expect(result.task).toBe(null)
    expect(result.killsApplied).toBe(2)
    expect(result.pointsAwarded).toBe(4)
  })

  it('completes zero-point tasks without awarding points', () => {
    const task = { monsterId: 'field_chicken', monstersRemaining: 1, pointsOnComplete: 0 }
    const result = resolveSlayerTaskKill(task, 'field_chicken', 1)
    expect(result.completed).toBe(true)
    expect(result.task).toBe(null)
    expect(result.killsApplied).toBe(1)
    expect(result.pointsAwarded).toBe(0)
  })

  it('normalises invalid kill counts without changing the task', () => {
    const task = { monsterId: 'cave_goblin', monstersRemaining: 3, pointsOnComplete: 4 }
    const result = resolveSlayerTaskKill(task, 'cave_goblin', -10)
    expect(result.onTask).toBe(true)
    expect(result.completed).toBe(false)
    expect(result.task).toEqual(task)
    expect(result.killsApplied).toBe(0)
    expect(result.pointsAwarded).toBe(0)
  })

  it('does not award points when resolving a null task after completion', () => {
    const completed = resolveSlayerTaskKill({ monsterId: 'cave_goblin', monstersRemaining: 1, pointsOnComplete: 15 }, 'cave_goblin', 1)
    expect(completed.completed).toBe(true)
    expect(completed.pointsAwarded).toBe(15)
    const rerun = resolveSlayerTaskKill(completed.task, 'cave_goblin', 1)
    expect(rerun.completed).toBe(false)
    expect(rerun.pointsAwarded).toBe(0)
  })

})


describe('doesSlayerTaskMatchMonster', () => {
  it('treats Nagadoth kings as equivalent for slayer task matching', () => {
    expect(doesSlayerTaskMatchMonster('nagadoth_rex', 'nagadoth_prime')).toBe(true)
    expect(doesSlayerTaskMatchMonster('nagadoth_rex', 'nagadoth_supreme')).toBe(true)
    expect(doesSlayerTaskMatchMonster('nagadoth_prime', 'nagadoth_supreme')).toBe(true)
  })



  it('matches nagadoth kings task id to any king', () => {
    expect(doesSlayerTaskMatchMonster('dagganoth_kings', 'nagadoth_rex')).toBe(true)
    expect(doesSlayerTaskMatchMonster('dagganoth_kings', 'nagadoth_prime')).toBe(true)
    expect(doesSlayerTaskMatchMonster('dagganoth_kings', 'nagadoth_supreme')).toBe(true)
  })

  it('does not treat unrelated monsters as equivalent', () => {
    expect(doesSlayerTaskMatchMonster('nagadoth_rex', 'deepmaw_kraken')).toBe(false)
  })
})

describe('canFightSlayerMonster', () => {
  const slayerMonster = { id: 'nether_demon', slayerRequirement: 85 }
  const regularMonster = { id: 'chicken' }

  it('allows fighting any non-slayer monster regardless of task', () => {
    expect(canFightSlayerMonster(regularMonster, null)).toBe(true)
    expect(canFightSlayerMonster(regularMonster, { monsterId: 'nether_demon' })).toBe(true)
  })

  it('blocks slayer monsters when no task is active', () => {
    expect(canFightSlayerMonster(slayerMonster, null)).toBe(false)
    expect(canFightSlayerMonster(slayerMonster, undefined)).toBe(false)
  })

  it('blocks slayer monsters when the active task targets a different monster', () => {
    expect(canFightSlayerMonster(slayerMonster, { monsterId: 'bone_wyvern' })).toBe(false)
  })

  it('allows slayer monsters when the active task matches', () => {
    expect(canFightSlayerMonster(slayerMonster, { monsterId: 'nether_demon' })).toBe(true)
  })

  it('honors Nagadoth Kings group matching', () => {
    const rex = { id: 'nagadoth_rex', slayerRequirement: 90 }
    expect(canFightSlayerMonster(rex, { monsterId: 'dagganoth_kings' })).toBe(true)
    expect(canFightSlayerMonster(rex, { monsterId: 'nagadoth_prime' })).toBe(true)
  })
})
