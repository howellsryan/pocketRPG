// /api/daily-tasks/progress — the idle client's batched progress push. Real
// schema: it writes the same rows the world's flush does, and the credit it
// pays goes through the same atomic claim /complete uses.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeD1, FakeD1 } from './helpers/d1'

vi.mock('../functions/_lib/auth.js', () => ({
  requireAuth: async () => ({ identity: { id: 1 } }),
  json: (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))

import { onRequestPost } from '../functions/api/daily-tasks/progress.js'

let raw: any
let env: any

function char(id: number, ownerId = 1) {
  raw.prepare(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
     VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 1, 3, 0, 0)`,
  ).run(id, ownerId, 'c' + id)
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function issueTask(characterId: number, taskId: string, target: number) {
  raw.prepare(
    `INSERT INTO character_daily_tasks (character_id, task_date, slot, task_id, tier, target, progress, credited, issued_at)
     VALUES (?, ?, 0, ?, 'Novice', ?, 0, 0, 0)`,
  ).run(characterId, today(), taskId, target)
}

function post(characterId: number, body: any) {
  return new Request('https://x', {
    method: 'POST',
    headers: { 'X-Character-Id': String(characterId), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  const d = makeD1()
  env = { DB: d.DB as FakeD1 }
  raw = d.raw
})

describe('/api/daily-tasks/progress', () => {
  it('404s a character the caller does not own', async () => {
    char(5, 999)
    const res = await onRequestPost({ request: post(5, { date: today(), events: [] }), env } as any)
    expect(res.status).toBe(404)
  })

  it('applies matched kill events to the issued task', async () => {
    char(5)
    issueTask(5, 'kill_green_dragons', 10)
    const res = await onRequestPost({
      request: post(5, { date: today(), events: [{ kind: 'monster_kill', monsterId: 'green_dragon', count: 6 }] }),
      env,
    } as any)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.tasks.find((t: any) => t.taskId === 'kill_green_dragons').progress).toBe(6)
    expect(body.creditsGranted).toBe(0)
  })

  it('pays the credit when the batch finishes a task', async () => {
    char(5)
    issueTask(5, 'kill_green_dragons', 10)
    const res = await onRequestPost({
      request: post(5, { date: today(), events: [{ kind: 'monster_kill', monsterId: 'green_dragon', count: 10 }] }),
      env,
    } as any)
    const body = await res.json()
    expect(body.creditsGranted).toBe(1)
    expect(raw.prepare('SELECT credits FROM characters WHERE id = 5').get().credits).toBe(1)
  })

  it('refuses a batch stamped with a date that has already rolled over', async () => {
    char(5)
    issueTask(5, 'kill_green_dragons', 10)
    const res = await onRequestPost({
      request: post(5, { date: '2020-01-01', events: [{ kind: 'monster_kill', monsterId: 'green_dragon', count: 10 }] }),
      env,
    } as any)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('DAILY_TASKS_ROLLED_OVER')
    expect(raw.prepare('SELECT progress FROM character_daily_tasks WHERE character_id = 5 AND slot = 0').get().progress).toBe(0)
  })

  it('accepts a body with no date and issues the day\'s tasks', async () => {
    char(5)
    const res = await onRequestPost({ request: post(5, { events: [] }), env } as any)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.tasks).toHaveLength(5)
    expect(body.resetInMs).toBeGreaterThan(0)
  })

  it('survives a malformed body rather than throwing', async () => {
    char(5)
    const request = new Request('https://x', {
      method: 'POST',
      headers: { 'X-Character-Id': '5', 'Content-Type': 'application/json' },
      body: 'not json',
    })
    const res = await onRequestPost({ request, env } as any)
    expect(res.status).toBe(200)
  })
})
