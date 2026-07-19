// Items 1+2 (P0): the world-session lock keeps the open-world companion and the
// idle game from writing the same save at once, and world entry is refused
// during a PvP match. Real schema (migration 0030 applied), real
// worldSessions lib + /api/save + /api/world-token.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeD1, FakeD1 } from './helpers/d1'
import {
  WORLD_SESSION_TTL_MS,
  isWorldSessionLive,
  beginWorldSession,
  refreshWorldSession,
  endWorldSession,
} from '../functions/_lib/game/worldSessions.js'

vi.mock('../functions/_lib/auth.js', () => ({
  requireAuth: async () => ({ identity: { id: 1 } }),
  json: (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))

import { onRequestPut } from '../functions/api/save.js'
import { onRequestPost as worldTokenPost } from '../functions/api/world-token.js'

const SECRET = 'world-lock-secret'
let raw: any
let env: any
function char(id: number, ownerId = 1, activeMatchId: number | null = null) {
  raw.prepare(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, active_match_id, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
     VALUES (?, ?, ?, 0, 0, 0, 0, ?, 0, 0, 1, 3, 0, 0)`,
  ).run(id, ownerId, 'c' + id, activeMatchId)
}
function savePut(characterId: number, body: any) {
  return new Request('https://x', { method: 'PUT', headers: { 'X-Character-Id': String(characterId), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
function worldTokenReq(characterId: number) {
  return new Request('https://x', { method: 'POST', headers: { 'X-Character-Id': String(characterId) } })
}
function worldRow(characterId: number) {
  return raw.prepare('SELECT session_id, heartbeat_at FROM world_sessions WHERE character_id = ?').get(characterId)
}

beforeEach(() => {
  const d = makeD1()
  env = { DB: d.DB as FakeD1, JWT_SECRET: SECRET }
  raw = d.raw
})

describe('worldSessions lib', () => {
  it('begins, reports live, refreshes, and ends a session', async () => {
    char(5)
    const now = 1_000_000
    await beginWorldSession(env, 5, 'sess-a', now)
    expect(await isWorldSessionLive(env, 5, now)).toBe(true)
    // Just inside the TTL is still live; past it is not (self-heal for a dead DO).
    expect(await isWorldSessionLive(env, 5, now + WORLD_SESSION_TTL_MS - 1)).toBe(true)
    expect(await isWorldSessionLive(env, 5, now + WORLD_SESSION_TTL_MS + 1)).toBe(false)

    // A refresh from the OWNING session moves the heartbeat forward.
    await refreshWorldSession(env, 5, 'sess-a', now + WORLD_SESSION_TTL_MS - 1)
    expect(await isWorldSessionLive(env, 5, now + WORLD_SESSION_TTL_MS + 1)).toBe(true)

    await endWorldSession(env, 5, 'sess-a')
    expect(await isWorldSessionLive(env, 5, now + WORLD_SESSION_TTL_MS + 2)).toBe(false)
    expect(worldRow(5)).toBeUndefined()
  })

  it('does not let a stale session refresh or end a row a newer session re-claimed', async () => {
    char(5)
    const now = 2_000_000
    await beginWorldSession(env, 5, 'old', now)
    await beginWorldSession(env, 5, 'new', now + 10) // reconnect on a second device
    expect(worldRow(5).session_id).toBe('new')
    // The old session's heartbeat/clear must NOT touch the new row.
    await refreshWorldSession(env, 5, 'old', now + 5)
    expect(worldRow(5).heartbeat_at).toBe(now + 10)
    await endWorldSession(env, 5, 'old')
    expect(worldRow(5).session_id).toBe('new')
  })
})

describe('PUT /api/save world-session lock', () => {
  it('refuses a save while a live world session holds the character', async () => {
    char(5)
    await beginWorldSession(env, 5, 'sess-a')
    const res = await onRequestPut({ request: savePut(5, { save_data: JSON.stringify({ stats: {} }), save_revision: 0 }), env } as any)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('CHARACTER_IN_WORLD_SESSION')
  })

  it('allows the save once the world session has ended', async () => {
    char(5)
    await beginWorldSession(env, 5, 'sess-a')
    await endWorldSession(env, 5, 'sess-a')
    const res = await onRequestPut({ request: savePut(5, { save_data: JSON.stringify({ stats: {} }), save_revision: 0 }), env } as any)
    expect(res.status).toBe(200)
  })

  it('does not block on an expired world session (TTL self-heal)', async () => {
    char(5)
    // Heartbeat far in the past → the lock has lapsed.
    raw.prepare('INSERT INTO world_sessions (character_id, session_id, heartbeat_at, created_at) VALUES (?, ?, ?, ?)')
      .run(5, 'dead', Date.now() - WORLD_SESSION_TTL_MS - 5000, Date.now() - WORLD_SESSION_TTL_MS - 5000)
    const res = await onRequestPut({ request: savePut(5, { save_data: JSON.stringify({ stats: {} }), save_revision: 0 }), env } as any)
    expect(res.status).toBe(200)
  })

  // Regression (#811 outage): the world_sessions read throwing — e.g. the table
  // absent because migration 0030 wasn't applied to this D1 — must NOT 500 the
  // save. The lock fails open so saves keep working. Before the fix this took
  // down /api/save for every player and surfaced as the "Save Failed" modal.
  it('saves succeed when the world_sessions read throws (fail-open)', async () => {
    char(5)
    const realPrepare = env.DB.prepare.bind(env.DB)
    vi.spyOn(env.DB, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('world_sessions')) {
        return { bind: () => ({ first: async () => { throw new Error('no such table: world_sessions') } }) } as any
      }
      return realPrepare(sql)
    })
    const res = await onRequestPut({ request: savePut(5, { save_data: JSON.stringify({ stats: {} }), save_revision: 0 }), env } as any)
    expect(res.status).toBe(200)
  })
})

describe('POST /api/world-token PvP lock', () => {
  it('refuses a world handoff while a PvP match is active', async () => {
    char(5, 1, 100)
    raw.prepare(`INSERT INTO pvp_matches (id, character_a, character_b, status, started_at, current_tick, state_json, last_tick_at) VALUES (100, 5, 6, 'active', 0, 0, '{}', 0)`).run()
    const res = await worldTokenPost({ request: worldTokenReq(5), env } as any)
    expect(res.status).toBe(409)
  })

  it('mints a handoff when no match is active', async () => {
    char(5)
    const res = await worldTokenPost({ request: worldTokenReq(5), env } as any)
    expect(res.status).toBe(200)
    expect(typeof (await res.json()).handoff).toBe('string')
  })
})
