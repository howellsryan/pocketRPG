// Daily-task progress applied server-side, from game events.
//
// The bug this exists for: progress lived only in the idle client's memory, so
// a green dragon killed in the open world (its own tab, its own Durable Object)
// could never move a daily task, and a reload lost whatever the client held.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeD1 } from './helpers/d1'
import { applyDailyTaskEvents, claimDailyTaskCredit, normaliseDailyEvents } from '../functions/_lib/game/dailyTaskProgress.js'
import { ensureDailyTasks } from '../functions/_lib/game/dailyTasks.js'

const DATE = '2026-03-04'
let env: any
let raw: any

beforeEach(() => {
  const d1 = makeD1()
  env = { DB: d1.DB }
  raw = d1.raw
  raw.prepare(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
     VALUES (7, 'identity-1', 'player7', 0, 0, 0, 0, 0, 0, 100, 3, 0, 0)`,
  ).run()
})

/** Issues a single known task in slot 0 so a test can name the event that moves it. */
async function issueTask(taskId: string, target: number) {
  raw.prepare(
    `INSERT INTO character_daily_tasks (character_id, task_date, slot, task_id, tier, target, progress, credited, issued_at)
     VALUES (7, ?, 0, ?, 'Novice', ?, 0, 0, 0)`,
  ).run(DATE, taskId, target)
}

function creditsOf(characterId = 7) {
  return raw.prepare('SELECT credits FROM characters WHERE id = ?').get(characterId).credits
}

function progressOf(slot = 0) {
  return raw.prepare('SELECT progress, credited FROM character_daily_tasks WHERE character_id = 7 AND task_date = ? AND slot = ?').get(DATE, slot)
}

describe('normaliseDailyEvents', () => {
  it('drops anything that is not a known event kind', () => {
    expect(normaliseDailyEvents([{ kind: 'grant_me_credits' }, null, 'monster_kill', 7])).toEqual([])
  })

  it('keeps the fields a matcher reads and bounds the counts', () => {
    expect(normaliseDailyEvents([{ kind: 'monster_kill', monsterId: 'green_dragon', count: 10 ** 9, extra: 'ignored' }]))
      .toEqual([{ kind: 'monster_kill', monsterId: 'green_dragon', count: 100000 }])
    expect(normaliseDailyEvents([{ kind: 'skill_xp', skill: 'mining', xp: 10 ** 12 }]))
      .toEqual([{ kind: 'skill_xp', skill: 'mining', xp: 200000000 }])
  })

  it('drops an event whose count or xp is zero or negative', () => {
    expect(normaliseDailyEvents([
      { kind: 'monster_kill', monsterId: 'green_dragon', count: 0 },
      { kind: 'skill_xp', skill: 'mining', xp: -5 },
    ])).toEqual([])
  })

  it('caps a single request at 200 events', () => {
    const events = Array.from({ length: 500 }, () => ({ kind: 'monster_kill', monsterId: 'green_dragon' }))
    expect(normaliseDailyEvents(events)).toHaveLength(200)
  })

  it('returns nothing for a non-array', () => {
    expect(normaliseDailyEvents(undefined)).toEqual([])
  })
})

describe('applyDailyTaskEvents', () => {
  it('adds matched kills to the issued task and leaves it uncredited short of the target', async () => {
    await issueTask('kill_green_dragons', 10)
    const res = await applyDailyTaskEvents(env, {
      characterId: 7, identityId: 'identity-1', dateKey: DATE,
      events: [{ kind: 'monster_kill', monsterId: 'green_dragon', count: 4 }],
    })
    expect(progressOf()).toMatchObject({ progress: 4, credited: 0 })
    expect(res.creditsGranted).toBe(0)
    expect(res.tasks[0]).toMatchObject({ slot: 0, progress: 4, completed: false })
    expect(creditsOf()).toBe(0)
  })

  it('ignores a kill that is not the task\'s monster', async () => {
    await issueTask('kill_green_dragons', 10)
    await applyDailyTaskEvents(env, {
      characterId: 7, identityId: 'identity-1', dateKey: DATE,
      events: [{ kind: 'monster_kill', monsterId: 'pasture_bull', count: 40 }],
    })
    expect(progressOf().progress).toBe(0)
  })

  it('composes with progress already on the row rather than replacing it', async () => {
    await issueTask('kill_green_dragons', 10)
    const half = { kind: 'monster_kill', monsterId: 'green_dragon', count: 3 }
    await applyDailyTaskEvents(env, { characterId: 7, identityId: 'identity-1', dateKey: DATE, events: [half] })
    await applyDailyTaskEvents(env, { characterId: 7, identityId: 'identity-1', dateKey: DATE, events: [half] })
    expect(progressOf().progress).toBe(6)
  })

  it('credits exactly one credit when the events carry the task past its target', async () => {
    await issueTask('kill_green_dragons', 10)
    const res = await applyDailyTaskEvents(env, {
      characterId: 7, identityId: 'identity-1', dateKey: DATE,
      events: [{ kind: 'monster_kill', monsterId: 'green_dragon', count: 25 }],
    })
    expect(res.creditsGranted).toBe(1)
    expect(res.credits).toBe(1)
    expect(creditsOf()).toBe(1)
    // Progress is clamped at the target — never the raw overshoot.
    expect(progressOf()).toMatchObject({ progress: 10, credited: 1 })
  })

  it('pays a completed task once, however many times the events are replayed', async () => {
    await issueTask('kill_green_dragons', 10)
    const events = [{ kind: 'monster_kill', monsterId: 'green_dragon', count: 25 }]
    await applyDailyTaskEvents(env, { characterId: 7, identityId: 'identity-1', dateKey: DATE, events })
    const again = await applyDailyTaskEvents(env, { characterId: 7, identityId: 'identity-1', dateKey: DATE, events })
    expect(again.creditsGranted).toBe(0)
    expect(creditsOf()).toBe(1)
  })

  it('moves nothing when there are no events, and issues the rest of the day\'s tasks', async () => {
    await issueTask('kill_green_dragons', 10)
    const res = await applyDailyTaskEvents(env, { characterId: 7, identityId: 'identity-1', dateKey: DATE, events: [] })
    expect(res.creditsGranted).toBe(0)
    // Issuance is lazy: the hand-seeded slot survives and the other four appear.
    expect(res.tasks).toHaveLength(5)
    expect(res.tasks[0]).toMatchObject({ taskId: 'kill_green_dragons', progress: 0 })
  })

  it('issues the day\'s tasks when the character has none yet', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(`${DATE}T09:00:00Z`))
    try {
      const res = await applyDailyTaskEvents(env, { characterId: 7, identityId: 'identity-1', events: [] })
      expect(res.tasks).toHaveLength(5)
      expect(res.date).toBe(DATE)
    } finally {
      vi.useRealTimers()
    }
  })

  it('credits a raid completion, which is how a co-op raid clear reaches a daily task', async () => {
    await issueTask('conquer_cryptbound_champions', 1)
    const res = await applyDailyTaskEvents(env, {
      characterId: 7, identityId: 'identity-1', dateKey: DATE,
      events: [{ kind: 'raid_complete', raidId: 'cryptbound_champions' }],
    })
    expect(res.creditsGranted).toBe(1)
  })
})

describe('claimDailyTaskCredit', () => {
  it('flips the row and pays once; a replay claims nothing', async () => {
    await issueTask('kill_green_dragons', 10)
    const first = await claimDailyTaskCredit(env, { characterId: 7, identityId: 'identity-1', dateKey: DATE, slot: 0, taskId: 'kill_green_dragons' })
    const second = await claimDailyTaskCredit(env, { characterId: 7, identityId: 'identity-1', dateKey: DATE, slot: 0, taskId: 'kill_green_dragons' })
    expect(first.creditsGranted).toBe(1)
    expect(second.creditsGranted).toBe(0)
    expect(creditsOf()).toBe(1)
    expect(progressOf()).toMatchObject({ progress: 10, credited: 1 })
  })

  it('claims nothing for a task that was never issued', async () => {
    const claim = await claimDailyTaskCredit(env, { characterId: 7, identityId: 'identity-1', dateKey: DATE, slot: 3, taskId: 'kill_green_dragons' })
    expect(claim.creditsGranted).toBe(0)
    expect(creditsOf()).toBe(0)
  })

  it('pays without an identity — the world knows the character, not the owner', async () => {
    await issueTask('kill_green_dragons', 10)
    const claim = await claimDailyTaskCredit(env, { characterId: 7, identityId: null, dateKey: DATE, slot: 0, taskId: 'kill_green_dragons' })
    expect(claim.creditsGranted).toBe(1)
    expect(creditsOf()).toBe(1)
  })
})

describe('ensureDailyTasks', () => {
  it('is the issuing path both the client fetch and a world flush go through', async () => {
    const rows = await ensureDailyTasks(env, 7, DATE)
    expect(rows).toHaveLength(5)
    const again = await ensureDailyTasks(env, 7, DATE)
    expect(again.map((r: any) => r.task_id)).toEqual(rows.map((r: any) => r.task_id))
  })
})
