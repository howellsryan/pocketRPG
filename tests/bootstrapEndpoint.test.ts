// /api/bootstrap — the one request a signed-in boot makes instead of six.
//
// The load-bearing property is PARITY: every sub-object must match the endpoint
// it replaces exactly, because the client runs one set of mappers over both.
// These tests assert bootstrap against the real endpoints' own output on the
// same fixture rather than against hand-written literals, so a drift in either
// direction fails here. Real schema via the migrated FakeD1.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeD1, FakeD1 } from './helpers/d1'

let identityId = 1
vi.mock('../functions/_lib/auth.js', () => ({
  requireAuth: async () => (identityId
    ? { identity: { id: identityId, provider: 'github', displayName: 'tester' } }
    : { error: 'Missing bearer token', status: 401 }),
  json: (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))

import { onRequestGet as bootstrapGet } from '../functions/api/bootstrap.js'
import { onRequestGet as killCountsGet } from '../functions/api/kill-counts.js'
import { onRequestGet as hardModeGet } from '../functions/api/hard-mode.js'
import { onRequestGet as idleGet } from '../functions/api/idle.js'
import { onRequestGet as activityGet } from '../functions/api/activity-progress.js'
import { onRequestGet as dailyTasksGet } from '../functions/api/daily-tasks/index.js'
import { onRequestGet as meGet } from '../functions/api/auth/me.js'

let raw: any
let env: any

function identity(id: number, removeAds = 0) {
  raw.prepare(
    `INSERT INTO oauth_identities (id, provider, provider_user_id, display_name, created_at, remove_ads)
     VALUES (?, 'github', ?, 'tester', 0, ?)`,
  ).run(id, 'gh' + id, removeAds)
}
function char(id: number, ownerId = 1, extra: { credits?: number, ironman?: number, oneLife?: number } = {}) {
  raw.prepare(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
     VALUES (?, ?, ?, 0, ?, ?, ?, 0, 0, 1, 3, 0, 0)`,
  ).run(id, ownerId, 'c' + id, extra.ironman ?? 0, extra.oneLife ?? 0, extra.credits ?? 0)
}
function req(characterId?: number) {
  const headers: Record<string, string> = {}
  if (characterId !== undefined) headers['X-Character-Id'] = String(characterId)
  return new Request('https://x', { headers })
}
async function body(res: Response) { return await res.json() as any }

beforeEach(() => {
  identityId = 1
  const d = makeD1()
  env = { DB: d.DB as FakeD1 }
  raw = d.raw
  identity(1)
  identity(2)
})

describe('/api/bootstrap', () => {
  it('401s without a session', async () => {
    identityId = 0
    expect((await bootstrapGet({ request: req(5), env } as any)).status).toBe(401)
  })

  it('404s a character the caller does not own, and reads no character-scoped table', async () => {
    char(5, 2)
    raw.prepare(`INSERT INTO kill_counts (character_id, source_type, source_id, kill_count, updated_at) VALUES (5, 'monsters', 'zaryth_the_shadowed', 9, 0)`).run()
    const res = await bootstrapGet({ request: req(5), env } as any)
    expect(res.status).toBe(404)
    // The kill counts of a character owned by someone else must not leak out
    // on the 404 path.
    expect(JSON.stringify(await body(res))).not.toContain('zaryth')
  })

  it('answers identity-only when no character is selected, like /api/auth/me', async () => {
    const res = await bootstrapGet({ request: req(), env } as any)
    expect(res.status).toBe(200)
    const b = await body(res)
    expect(b.character).toBeNull()
    expect(b.identity.id).toBe(1)
    // Nothing character-scoped is invented for a caller with no character.
    expect(b.killCounts).toBeUndefined()
    expect(b.idle).toBeUndefined()
  })

  it('matches every endpoint it replaces, field for field', async () => {
    char(5, 1, { credits: 42, ironman: 1 })
    raw.prepare(`INSERT INTO kill_counts (character_id, source_type, source_id, kill_count, updated_at) VALUES (5, 'monsters', 'zaryth_the_shadowed', 9, 0)`).run()
    raw.prepare(`INSERT INTO hard_mode_targets (character_id, source_type, source_id, enabled_at) VALUES (5, 'monsters', 'zaryth_the_shadowed', 100)`).run()
    raw.prepare(`INSERT INTO character_idle_state (character_id, last_active_at, active_task, updated_at) VALUES (5, 1234, ?, 1234)`)
      .run(JSON.stringify({ type: 'skill', skill: 'mining' }))
    raw.prepare(`INSERT INTO character_activity_progress (character_id, activity_key, progress_ticks, total_ticks, updated_at) VALUES (5, 'mining', 12, 100, 7)`).run()

    const boot = await body(await bootstrapGet({ request: req(5), env } as any))

    expect(boot.killCounts).toEqual(await body(await killCountsGet({ request: req(5), env } as any)))
    expect(boot.hardMode).toEqual(await body(await hardModeGet({ request: req(5), env } as any)))
    expect(boot.activityProgress).toEqual(await body(await activityGet({ request: req(5), env } as any)))

    // serverNow is a clock reading, so compare everything but it.
    const idle = await body(await idleGet({ request: req(5), env } as any))
    expect(boot.idle.idle).toEqual(idle.idle)
    expect(typeof boot.idle.serverNow).toBe('number')

    // Daily tasks are issued lazily by whichever of the two runs first, so the
    // second call sees the same five rows.
    const daily = await body(await dailyTasksGet({ request: req(5), env } as any))
    expect(boot.dailyTasks.date).toBe(daily.date)
    expect(boot.dailyTasks.tasks).toEqual(daily.tasks)
    expect(boot.dailyTasks.tasks).toHaveLength(5)

    const me = await body(await meGet({ request: req(5), env } as any))
    expect(boot.identity).toEqual(me.identity)
    expect(boot.character).toEqual(me.character)
    expect(boot.stripe_skus).toEqual(me.stripe_skus)
    expect(boot.character.credits).toBe(42)
    expect(boot.character.is_ironman).toBe(true)
  })

  it('issues the five daily tasks exactly once across repeated calls', async () => {
    char(5)
    await bootstrapGet({ request: req(5), env } as any)
    await bootstrapGet({ request: req(5), env } as any)
    await dailyTasksGet({ request: req(5), env } as any)
    const n = raw.prepare('SELECT COUNT(*) AS n FROM character_daily_tasks WHERE character_id = 5').get().n
    expect(n).toBe(5)
  })

  it('still answers the other five payloads when daily-task issuance fails', async () => {
    char(5)
    raw.prepare(`INSERT INTO kill_counts (character_id, source_type, source_id, kill_count, updated_at) VALUES (5, 'monsters', 'zaryth_the_shadowed', 9, 0)`).run()
    raw.exec('DROP TABLE character_daily_tasks')
    const res = await bootstrapGet({ request: req(5), env } as any)
    expect(res.status).toBe(200)
    const boot = await body(res)
    expect(boot.dailyTasks).toBeNull()
    expect(boot.killCounts.entries).toHaveLength(1)
    expect(boot.character.id).toBe(5)
  })

  it('returns a null idle row rather than failing when the character has never been stamped', async () => {
    char(5)
    const boot = await body(await bootstrapGet({ request: req(5), env } as any))
    expect(boot.idle.idle).toBeNull()
    expect(typeof boot.idle.serverNow).toBe('number')
    expect(boot.activityProgress.progress).toEqual({})
    expect(boot.killCounts.entries).toEqual([])
  })

  it('survives an unparseable stored task instead of losing the whole boot', async () => {
    char(5)
    raw.prepare(`INSERT INTO character_idle_state (character_id, last_active_at, active_task, updated_at) VALUES (5, 1234, '{not json', 1234)`).run()
    const res = await bootstrapGet({ request: req(5), env } as any)
    expect(res.status).toBe(200)
    const boot = await body(res)
    expect(boot.idle.idle.activeTask).toBeNull()
    expect(boot.idle.idle.lastActiveAt).toBe(1234)
  })

  it('stamps serverNow at or after the idle row it will be measured against', async () => {
    char(5)
    const before = Date.now()
    raw.prepare(`INSERT INTO character_idle_state (character_id, last_active_at, active_task, updated_at) VALUES (5, ?, NULL, ?)`).run(before, before)
    const boot = await body(await bootstrapGet({ request: req(5), env } as any))
    // (serverNow - lastActiveAt) is the offline-idle window. A serverNow read
    // before the row would widen it — the one direction that pays out idle time
    // the player did not accrue.
    expect(boot.idle.serverNow).toBeGreaterThanOrEqual(boot.idle.idle.lastActiveAt)
  })
})
