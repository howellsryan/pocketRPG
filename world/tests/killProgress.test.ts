// A world kill has to be worth what a solo kill is worth: a kill count, slayer
// progress, and daily-task progress. None of the three used to leave the zone —
// the DO resolves its own combat, and the idle client that owned all three is
// not running while a player is out here.
import { describe, expect, it } from 'vitest'
import {
  creditWorldSlayerKill, drainSlayerCredit, killDailyEvents, restoreSlayerCredit, seedSlayerSession,
  slayerCreditNeedsFlush, xpDailyEvents,
} from '../server/killProgress'

function saveWithTask(overrides: Record<string, unknown> = {}) {
  return {
    settings: {
      slayerTask: { monsterId: 'green_dragon', monstersRemaining: 2, pointsOnComplete: 12, masterId: 'vashka' },
      slayerTasksCompleted: 4,
      characterUnlocks: { doubleSlayerXp: false },
      ...overrides,
    },
  }
}

describe('seedSlayerSession', () => {
  it('takes the task, completion count and the double-XP unlock off the save', () => {
    const session = seedSlayerSession(saveWithTask({ characterUnlocks: { doubleSlayerXp: true } }))
    expect(session.task).toMatchObject({ monsterId: 'green_dragon', monstersRemaining: 2 })
    expect(session.tasksCompleted).toBe(4)
    expect(session.doubleXp).toBe(true)
    expect(session.dirty).toBe(false)
  })

  it('seeds a task-less session from a save with no slayer settings at all', () => {
    const session = seedSlayerSession({})
    expect(session.task).toBe(null)
    expect(session.tasksCompleted).toBe(0)
    expect(session.credit).toEqual({ pointsEarned: 0, tasksCompleted: 0, masterCompletions: {} })
  })
})

describe('creditWorldSlayerKill', () => {
  it('ignores a kill that is not on task, leaving the session clean', () => {
    const session = seedSlayerSession(saveWithTask())
    expect(creditWorldSlayerKill(session, 'pasture_bull')).toBe(null)
    expect(session.dirty).toBe(false)
    expect(session.task).toMatchObject({ monstersRemaining: 2 })
  })

  it('advances the task and marks the session for write-back', () => {
    const session = seedSlayerSession(saveWithTask())
    const credited = creditWorldSlayerKill(session, 'green_dragon')
    expect(credited).toMatchObject({ completed: false, monstersRemaining: 1 })
    expect(credited!.slayerXp).toBeGreaterThan(0)
    expect(credited!.message).toContain('1 left')
    expect(session.dirty).toBe(true)
    expect(session.task).toMatchObject({ monstersRemaining: 1 })
  })

  it('completes the task, banks the points and clears it', () => {
    const session = seedSlayerSession(saveWithTask())
    creditWorldSlayerKill(session, 'green_dragon')
    const done = creditWorldSlayerKill(session, 'green_dragon')
    expect(done).toMatchObject({ completed: true, monstersRemaining: 0 })
    expect(done!.pointsEarned).toBeGreaterThan(0)
    expect(session.task).toBe(null)
    expect(session.tasksCompleted).toBe(5)
    expect(session.credit.tasksCompleted).toBe(1)
    expect(session.credit.masterCompletions).toEqual({ vashka: 1 })
  })

  it('does nothing at all for a session carrying no task', () => {
    const session = seedSlayerSession({})
    expect(creditWorldSlayerKill(session, 'green_dragon')).toBe(null)
    expect(session.dirty).toBe(false)
  })
})

describe('drainSlayerCredit / restoreSlayerCredit', () => {
  it('carries nothing while the session has not touched the task', () => {
    expect(drainSlayerCredit(seedSlayerSession(saveWithTask()))).toBe(null)
  })

  it('hands the task and the banked delta to the flush and clears the delta', () => {
    const session = seedSlayerSession(saveWithTask())
    creditWorldSlayerKill(session, 'green_dragon')
    creditWorldSlayerKill(session, 'green_dragon')
    const drained = drainSlayerCredit(session)
    expect(drained).toMatchObject({ slayerTask: null, slayerTasksCompleted: 5 })
    expect(drained!.slayerCredit.tasksCompleted).toBe(1)
    // Cleared, so a second flush cannot pay the same completed task twice.
    expect(session.credit).toEqual({ pointsEarned: 0, tasksCompleted: 0, masterCompletions: {} })
    expect(drainSlayerCredit(session)).toBe(null)
  })

  it('puts a failed flush\'s delta back so the next one carries it', () => {
    const session = seedSlayerSession(saveWithTask())
    creditWorldSlayerKill(session, 'green_dragon')
    creditWorldSlayerKill(session, 'green_dragon')
    const drained = drainSlayerCredit(session)
    restoreSlayerCredit(session, drained)
    expect(session.dirty).toBe(true)
    const again = drainSlayerCredit(session)
    expect(again!.slayerCredit).toEqual(drained!.slayerCredit)
  })

  it('ADDS a restored delta to whatever was banked while the flush was failing', () => {
    // A merge that overwrote the master counts handed back two completions with
    // one master credit.
    const session = seedSlayerSession(saveWithTask())
    creditWorldSlayerKill(session, 'green_dragon')
    creditWorldSlayerKill(session, 'green_dragon')
    const drained = drainSlayerCredit(session)
    // A second task finishes before the failed flush is put back.
    session.task = { monsterId: 'green_dragon', monstersRemaining: 1, pointsOnComplete: 12, masterId: 'vashka' }
    creditWorldSlayerKill(session, 'green_dragon')
    restoreSlayerCredit(session, drained)

    expect(session.credit.tasksCompleted).toBe(2)
    expect(session.credit.masterCompletions).toEqual({ vashka: 2 })
    // Both completions' points, not just one — the per-task reward varies with
    // the running total, so the sum is what matters, never a doubling.
    expect(session.credit.pointsEarned).toBeGreaterThan(drained!.slayerCredit.pointsEarned)
  })

  it('restoring nothing is a no-op', () => {
    const session = seedSlayerSession(saveWithTask())
    restoreSlayerCredit(session, null)
    expect(session.dirty).toBe(false)
  })
})

describe('slayerCreditNeedsFlush', () => {
  it('flushes immediately for a plain progress kill, not just a completion', () => {
    const session = seedSlayerSession(saveWithTask())
    const credited = creditWorldSlayerKill(session, 'green_dragon')
    expect(credited).toMatchObject({ completed: false })
    expect(slayerCreditNeedsFlush(credited)).toBe(true)
  })

  it('flushes immediately for a completion too', () => {
    const session = seedSlayerSession(saveWithTask())
    creditWorldSlayerKill(session, 'green_dragon')
    const done = creditWorldSlayerKill(session, 'green_dragon')
    expect(done).toMatchObject({ completed: true })
    expect(slayerCreditNeedsFlush(done)).toBe(true)
  })

  it('never flushes for an off-task kill', () => {
    expect(slayerCreditNeedsFlush(null)).toBe(false)
  })
})

describe('killDailyEvents', () => {
  it('files an ordinary monster and a boss under their own triggers', () => {
    expect(killDailyEvents({ green_dragon: 3, warlord_grondar: 1 })).toEqual([
      { kind: 'monster_kill', monsterId: 'green_dragon', count: 3 },
      { kind: 'boss_kill', monsterId: 'warlord_grondar', count: 1 },
    ])
  })

  it('emits nothing for an empty or zeroed tally', () => {
    expect(killDailyEvents({})).toEqual([])
    expect(killDailyEvents({ green_dragon: 0 })).toEqual([])
  })
})

describe('xpDailyEvents', () => {
  it('emits one event per named skill', () => {
    expect(xpDailyEvents({ mining: 400, slayer: 120 })).toEqual([
      { kind: 'skill_xp', skill: 'mining', xp: 400 },
      { kind: 'skill_xp', skill: 'slayer', xp: 120 },
    ])
  })

  it('skips the pseudo-skills and anything that gained nothing', () => {
    expect(xpDailyEvents({ combat: 900, any: 900, mining: 0 })).toEqual([])
  })
})
