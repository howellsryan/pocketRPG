// /api/activity-progress persistence guards (§14): ownership, PvP save-lock,
// entry validation, and the batched upsert. Real schema.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeD1, FakeD1 } from './helpers/d1'

vi.mock('../functions/_lib/auth.js', () => ({
  requireAuth: async () => ({ identity: { id: 1 } }),
  json: (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))

import { onRequestGet, onRequestPut, onRequestDelete } from '../functions/api/activity-progress.js'

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
function getReq(characterId: number) {
  return new Request('https://x', { headers: { 'X-Character-Id': String(characterId) } })
}
beforeEach(() => {
  const d = makeD1()
  env = { DB: d.DB as FakeD1 }
  raw = d.raw
})

describe('activity-progress', () => {
  it('404s a character the caller does not own', async () => {
    char(5, 999)
    const res = await onRequestPut({ request: putReq(5, { progress: {} }), env } as any)
    expect(res.status).toBe(404)
  })
  it('400s a missing progress object', async () => {
    char(5)
    const res = await onRequestPut({ request: putReq(5, {}), env } as any)
    expect(res.status).toBe(400)
  })
  it('400s too many activity keys', async () => {
    char(5)
    const progress: any = {}
    for (let i = 0; i < 51; i++) progress['k' + i] = { progressTicks: 1 }
    const res = await onRequestPut({ request: putReq(5, { progress }), env } as any)
    expect(res.status).toBe(400)
  })
  it('upserts valid entries and reads them back, skipping invalid ones', async () => {
    char(5)
    const res = await onRequestPut({ request: putReq(5, { progress: {
      mining: { progressTicks: 12, totalTicks: 100 },
      bad: { progressTicks: -3 }, // invalid — skipped
    } }), env } as any)
    expect(res.status).toBe(200)
    const body = await (await onRequestGet({ request: getReq(5), env } as any)).json()
    expect(body.progress.mining.progressTicks).toBe(12)
    expect(body.progress.bad).toBeUndefined()
  })
  it('blocks writes during an active PvP match', async () => {
    char(5, 1, 200)
    raw.prepare(`INSERT INTO pvp_matches (id, character_a, character_b, status, started_at, current_tick, state_json, last_tick_at) VALUES (200, 5, 6, 'active', 0, 0, '{}', 0)`).run()
    const res = await onRequestPut({ request: putReq(5, { progress: { mining: { progressTicks: 1 } } }), env } as any)
    expect(res.status).toBe(409)
  })
  it('DELETE with a key clears just that entry', async () => {
    char(5)
    await onRequestPut({ request: putReq(5, { progress: { mining: { progressTicks: 5 }, fishing: { progressTicks: 7 } } }), env } as any)
    await onRequestDelete({ request: new Request('https://x?key=mining', { method: 'DELETE', headers: { 'X-Character-Id': '5' } }), env } as any)
    const body = await (await onRequestGet({ request: getReq(5), env } as any)).json()
    expect(body.progress.mining).toBeUndefined()
    expect(body.progress.fishing.progressTicks).toBe(7)
  })
})
