// Character-unlock purchases (§14): credits are debited server-side against the
// real schema, so the client never names a price. Covers the repeatable
// Extra Equipment Tab, which has no ownership row — every buy is one more debit.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeD1, FakeD1 } from './helpers/d1'

vi.mock('../functions/_lib/auth.js', () => ({
  requireAuth: async () => ({ identity: { id: 1 } }),
  json: (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))
vi.mock('../functions/_lib/pvp.js', () => ({ assertNotInActiveMatch: async () => null }))
vi.mock('../functions/_lib/game/audit.js', () => ({ auditLog: async () => {} }))

import { onRequestPost } from '../functions/api/unlocks/purchase.js'

let raw: any
let env: { DB: FakeD1 }

function char(id: number, credits: number, ownerId = 1) {
  raw.prepare(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
     VALUES (?, ?, ?, 0, 0, 0, ?, 0, 0, 50, 60, 0, 0)`,
  ).run(id, ownerId, 'c' + id, credits)
}

function creditsOf(id: number) {
  return raw.prepare('SELECT credits, credits_used FROM characters WHERE id = ?').get(id)
}

async function purchase(unlockId: string, characterId = 42) {
  const req = new Request('https://x/api/unlocks/purchase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Character-Id': String(characterId) },
    body: JSON.stringify({ unlock_id: unlockId }),
  })
  const res = await onRequestPost({ request: req, env } as any)
  return { status: res.status, body: (await res.json()) as any }
}

beforeEach(() => {
  const d = makeD1()
  env = { DB: d.DB }
  raw = d.raw
})

describe('POST /api/unlocks/purchase — extra equipment tab', () => {
  it('debits exactly 10 credits and books them as used', async () => {
    char(42, 100)
    const out = await purchase('extra_equipment_tab')
    expect(out.status).toBe(200)
    expect(out.body.unlock_id).toBe('extra_equipment_tab')
    expect(out.body.credits_remaining).toBe(90)
    expect(creditsOf(42)).toMatchObject({ credits: 90, credits_used: 10 })
  })

  it('can be bought over and over — nothing blocks a repeat', async () => {
    char(42, 100)
    for (let i = 1; i <= 10; i++) {
      const out = await purchase('extra_equipment_tab')
      expect(out.status).toBe(200)
      expect(out.body.credits_remaining).toBe(100 - i * 10)
    }
    expect(creditsOf(42)).toMatchObject({ credits: 0, credits_used: 100 })
  })

  it('refuses once the credits run out, leaving the balance untouched', async () => {
    char(42, 5)
    const out = await purchase('extra_equipment_tab')
    expect(out.status).toBe(402)
    expect(out.body.code).toBe('INSUFFICIENT_CREDITS')
    expect(creditsOf(42)).toMatchObject({ credits: 5, credits_used: 0 })
  })

  it('still rejects an unknown unlock id without touching credits', async () => {
    char(42, 100)
    const out = await purchase('free_everything')
    expect(out.status).toBe(400)
    expect(out.body.code).toBe('UNKNOWN_UNLOCK')
    expect(creditsOf(42)).toMatchObject({ credits: 100 })
  })

  it("refuses to spend another owner's character's credits", async () => {
    char(7, 100, 999)
    const out = await purchase('extra_equipment_tab', 7)
    expect(out.status).toBe(404)
    expect(creditsOf(7)).toMatchObject({ credits: 100 })
  })
})
