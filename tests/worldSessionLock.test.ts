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
  expireWorldSessionAfter,
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
function char(id: number, ownerId = 1) {
  raw.prepare(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
     VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 1, 3, 0, 0)`,
  ).run(id, ownerId, 'c' + id)
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

describe('world session expiry armed on a socket close', () => {
  it('lapses the lock at the grace period instead of a full TTL', async () => {
    char(5)
    const now = 3_000_000
    await beginWorldSession(env, 5, 'sess-a', now)
    await expireWorldSessionAfter(env, 5, 'sess-a', 15_000, now)
    // Still locked through the grace period (the DO is expected to flush and
    // release inside it), and lapsed straight after — never a TTL later.
    expect(await isWorldSessionLive(env, 5, now + 14_999)).toBe(true)
    expect(await isWorldSessionLive(env, 5, now + 15_001)).toBe(false)
  })

  it('is undone by a reconnect re-claiming the session', async () => {
    char(5)
    const now = 3_000_000
    await beginWorldSession(env, 5, 'sess-a', now)
    await expireWorldSessionAfter(env, 5, 'sess-a', 15_000, now)
    await beginWorldSession(env, 5, 'sess-a', now + 5_000)
    expect(await isWorldSessionLive(env, 5, now + 20_000)).toBe(true)
  })

  it('never pushes an expiry further out, and ignores a session it does not own', async () => {
    char(5)
    const now = 3_000_000
    await beginWorldSession(env, 5, 'sess-a', now)
    await expireWorldSessionAfter(env, 5, 'sess-a', 15_000, now)
    const armed = worldRow(5).heartbeat_at
    // A later, longer arming (a second close, or one that raced the first) must
    // not extend the lock it already shortened.
    await expireWorldSessionAfter(env, 5, 'sess-a', 60_000, now + 1_000)
    expect(worldRow(5).heartbeat_at).toBe(armed)
    // A stale session's close must not touch a row a newer session re-claimed.
    await beginWorldSession(env, 5, 'sess-b', now + 2_000)
    await expireWorldSessionAfter(env, 5, 'sess-a', 1_000, now + 2_000)
    expect(worldRow(5).heartbeat_at).toBe(now + 2_000)
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
})

