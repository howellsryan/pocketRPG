// /api/idle persistence guards (§14): ownership, PvP save-lock, task-JSON
// validation, and the write-throttle that collapses per-tick flushes. Real
// schema; real assertNotInActiveMatch / verifyJWT.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeD1, FakeD1 } from './helpers/d1'
import { signJWT } from '../functions/_lib/jwt.js'

vi.mock('../functions/_lib/auth.js', () => ({
  requireAuth: async () => ({ identity: { id: 1 } }),
  json: (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))

import { onRequestGet, onRequestPut, onRequestDelete, onRequestPost } from '../functions/api/idle.js'

const SECRET = 'idle-secret'
let raw: any
let env: any
function char(id: number, ownerId = 1, activeMatchId: number | null = null) {
  raw.prepare(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, active_match_id, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
     VALUES (?, ?, ?, 0, 0, 0, 0, ?, 0, 0, 1, 3, 0, 0)`,
  ).run(id, ownerId, 'c' + id, activeMatchId)
}
function putReq(characterId: number, body: any) {
  return new Request('https://x', { method: 'PUT', headers: { 'X-Character-Id': String(characterId), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
function idleRow(characterId: number) {
  return raw.prepare('SELECT last_active_at, active_task, updated_at FROM character_idle_state WHERE character_id = ?').get(characterId)
}

beforeEach(() => {
  const d = makeD1()
  env = { DB: d.DB as FakeD1, JWT_SECRET: SECRET }
  raw = d.raw
})

describe('PUT /api/idle', () => {
  it('400s without a character header', async () => {
    const res = await onRequestPut({ request: new Request('https://x', { method: 'PUT', body: '{}' }), env } as any)
    expect(res.status).toBe(400)
  })
  it('404s a character the caller does not own', async () => {
    char(5, 999)
    const res = await onRequestPut({ request: putReq(5, { active_task: null }), env } as any)
    expect(res.status).toBe(404)
  })
  it('rejects oversized and malformed task JSON', async () => {
    char(5)
    const big = await onRequestPut({ request: putReq(5, { active_task: 'x'.repeat(20000) }), env } as any)
    expect(big.status).toBe(400)
    const bad = await onRequestPut({ request: putReq(5, { active_task: '{not json' }), env } as any)
    expect(bad.status).toBe(400)
  })
  it('writes a valid task and stores it', async () => {
    char(5)
    const res = await onRequestPut({ request: putReq(5, { active_task: JSON.stringify({ type: 'skill', id: 'mining' }) }), env } as any)
    expect(res.status).toBe(200)
    expect(JSON.parse(idleRow(5).active_task).type).toBe('skill')
  })
  it('blocks writes while in an active PvP match', async () => {
    char(5, 1, 100)
    raw.prepare(`INSERT INTO pvp_matches (id, character_a, character_b, status, started_at, current_tick, state_json, last_tick_at) VALUES (100, 5, 6, 'active', 0, 0, '{}', 0)`).run()
    const res = await onRequestPut({ request: putReq(5, { active_task: null }), env } as any)
    expect(res.status).toBe(409)
  })
  it('throttles an unchanged same-task rewrite (no second write)', async () => {
    char(5)
    const task = JSON.stringify({ type: 'skill', id: 'mining', ticksRemaining: 10 })
    await onRequestPut({ request: putReq(5, { active_task: task }), env } as any)
    const firstUpdatedAt = idleRow(5).updated_at
    // Same task identity (only volatile ticksRemaining differs) within the throttle window → skipped.
    const task2 = JSON.stringify({ type: 'skill', id: 'mining', ticksRemaining: 3 })
    await onRequestPut({ request: putReq(5, { active_task: task2 }), env } as any)
    expect(idleRow(5).updated_at).toBe(firstUpdatedAt) // no new write
  })
})

describe('GET /api/idle', () => {
  it('returns null idle with a server clock when no row exists', async () => {
    char(5)
    const res = await onRequestGet({ request: new Request('https://x?character_id=5'), env } as any)
    const body = await res.json()
    expect(body.idle).toBeNull()
    expect(body.serverNow).toBeGreaterThan(0)
  })
})

describe('DELETE /api/idle', () => {
  it('removes the idle row', async () => {
    char(5)
    await onRequestPut({ request: putReq(5, { active_task: JSON.stringify({ type: 'skill' }) }), env } as any)
    const res = await onRequestDelete({ request: new Request('https://x', { method: 'DELETE', headers: { 'X-Character-Id': '5' } }), env } as any)
    expect(res.status).toBe(200)
    expect(idleRow(5)).toBeUndefined()
  })
})

describe('POST /api/idle (beacon)', () => {
  it('401s a missing / invalid token', async () => {
    char(5)
    const missing = await onRequestPost({ request: new Request('https://x', { method: 'POST', body: JSON.stringify({ character_id: 5 }) }), env } as any)
    expect(missing.status).toBe(401)
    const bad = await onRequestPost({ request: new Request('https://x', { method: 'POST', body: JSON.stringify({ token: 'garbage', character_id: 5 }) }), env } as any)
    expect(bad.status).toBe(401)
  })
  it('writes with a valid session token', async () => {
    char(5)
    const token = await signJWT({ sub: 1 }, SECRET)
    const res = await onRequestPost({ request: new Request('https://x', { method: 'POST', body: JSON.stringify({ token, character_id: 5, active_task: null }) }), env } as any)
    expect(res.status).toBe(200)
    expect(idleRow(5)).toBeTruthy()
  })
})
