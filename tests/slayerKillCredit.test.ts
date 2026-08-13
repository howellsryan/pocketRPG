// The slayer arithmetic three call sites share: the solo screen, a co-op
// member, and an open-world session. It is pure so the world's Durable Object
// can run it, and every caller stores the result in a different shape — so what
// is tested here is that it decides, and never that it writes.
import { describe, it, expect } from 'vitest'
import { bankSlayerCredit, creditSlayerTaskKill, emptySlayerCredit } from '../src/engine/slayerKillCredit.js'
import monstersData from '../src/data/monsters.json'

function task(overrides: Record<string, unknown> = {}) {
  return { monsterId: 'green_dragon', monstersRemaining: 3, pointsOnComplete: 12, masterId: 'vashka', ...overrides }
}

describe('creditSlayerTaskKill', () => {
  it('returns null when there is no task at all', () => {
    expect(creditSlayerTaskKill({ task: null, tasksCompleted: 0 }, 'green_dragon', monstersData)).toBe(null)
  })

  it('returns null for a kill that is not the assigned monster', () => {
    expect(creditSlayerTaskKill({ task: task(), tasksCompleted: 0 }, 'pasture_bull', monstersData)).toBe(null)
  })

  it('advances the task and pays slayer XP for an on-task kill', () => {
    const credited = creditSlayerTaskKill({ task: task(), tasksCompleted: 4 }, 'green_dragon', monstersData)
    expect(credited?.completed).toBe(false)
    expect(credited?.monstersRemaining).toBe(2)
    expect(credited?.task?.monstersRemaining).toBe(2)
    expect(credited?.slayerXp).toBeGreaterThan(0)
  })

  it('doubles the XP for a character holding the unlock', () => {
    const plain = creditSlayerTaskKill({ task: task(), tasksCompleted: 0, doubleXp: false }, 'green_dragon', monstersData)
    const doubled = creditSlayerTaskKill({ task: task(), tasksCompleted: 0, doubleXp: true }, 'green_dragon', monstersData)
    expect(doubled!.slayerXp).toBe(plain!.slayerXp * 2)
  })

  it('clears the task and awards points on the last kill', () => {
    const credited = creditSlayerTaskKill({ task: task({ monstersRemaining: 1 }), tasksCompleted: 9 }, 'green_dragon', monstersData)
    expect(credited?.completed).toBe(true)
    expect(credited?.task).toBe(null)
    expect(credited?.pointsEarned).toBeGreaterThan(0)
    expect(credited?.totalTasks).toBe(10)
    expect(credited?.masterId).toBe('vashka')
  })

  it('refuses a raid proxy task unless the kill is the raid completion itself', () => {
    // The proxy task is keyed to the raid's FINAL boss (RAID_TASK_META).
    const raidTask = task({ monsterId: 'verin_the_defiled', monstersRemaining: 1 })
    const holder = { task: raidTask, tasksCompleted: 0 }
    expect(creditSlayerTaskKill(holder, 'verin_the_defiled', monstersData)).toBe(null)
    const onClear = creditSlayerTaskKill(holder, 'verin_the_defiled', monstersData, { fromRaidCompletion: true })
    expect(onClear?.completed).toBe(true)
    // A raid clear pays the authored flat rate, not the final boss's HP.
    expect(onClear?.slayerXp).toBe(2500)
  })
})

describe('bankSlayerCredit', () => {
  it('leaves the delta untouched for an incomplete task', () => {
    const credit = bankSlayerCredit(emptySlayerCredit(), { completed: false })
    expect(credit).toEqual({ pointsEarned: 0, tasksCompleted: 0, masterCompletions: {} })
  })

  it('accumulates points, completions and per-master counts across tasks', () => {
    let credit = emptySlayerCredit()
    credit = bankSlayerCredit(credit, { completed: true, pointsEarned: 12, masterId: 'vashka' })
    credit = bankSlayerCredit(credit, { completed: true, pointsEarned: 18, masterId: 'vashka' })
    credit = bankSlayerCredit(credit, { completed: true, pointsEarned: 5, masterId: 'thorne' })
    expect(credit).toEqual({
      pointsEarned: 35,
      tasksCompleted: 3,
      masterCompletions: { vashka: 2, thorne: 1 },
    })
  })

  it('banks a completion with no master without inventing a key', () => {
    const credit = bankSlayerCredit(emptySlayerCredit(), { completed: true, pointsEarned: 4, masterId: null })
    expect(credit.tasksCompleted).toBe(1)
    expect(credit.masterCompletions).toEqual({})
  })
})
