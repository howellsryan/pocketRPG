// /api/purchase — server-authoritative store buy (§14 integrity boundary).
// Runs the real handler SQL against the real migrations schema (tests/helpers/d1).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeD1, FakeD1 } from './helpers/d1'
import items from '../src/data/items.json' with { type: 'json' }
import { gzipJsonString } from '../functions/_lib/saveCodec.js'

vi.mock('../functions/_lib/auth.js', () => ({
  requireAuth: async () => ({ identity: { id: 1 } }),
  json: (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))
vi.mock('../functions/_lib/pvp.js', () => ({
  assertNotInActiveMatch: async () => null,
  sweepStaleRows: async () => {},
}))

import { onRequestPost } from '../functions/api/purchase.js'

const ITEM = 'bronze_dagger'
const UNIT = (items as any)[ITEM].shopValue as number

async function seed(DB: FakeD1, raw: any, { coins = 100_000, ownerId = 1, settings = {} } = {}) {
  raw.prepare(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
     VALUES (7, ?, 'tester', 0, 0, 0, 0, 0, 0, 1, 3, 0, 0)`,
  ).run(ownerId)
  const inventory = new Array(28).fill(null)
  inventory[0] = { itemId: 'coins', quantity: coins }
  const save = JSON.stringify({ coins: 0, inventory, bank: {}, stats: {}, equipment: {}, settings })
  const blob = await gzipJsonString(save)
  raw.prepare(`INSERT INTO saves (character_id, save_blob, save_data, updated_at, save_revision) VALUES (7, ?, ?, 0, 3)`).run(blob, save)
}

function req(body: any, characterId = 7) {
  return new Request('https://x/api/purchase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Character-Id': String(characterId) },
    body: JSON.stringify(body),
  })
}

function coinTotal(raw: any): number {
  const row = raw.prepare('SELECT save_data FROM saves WHERE character_id = 7').get()
  const save = JSON.parse(row.save_data)
  let n = Math.floor(save.coins || 0)
  for (const s of save.inventory || []) if (s?.itemId === 'coins') n += s.quantity
  return n
}

let env: { DB: FakeD1 }
let raw: any
beforeEach(() => {
  const d = makeD1()
  env = { DB: d.DB }
  raw = d.raw
})

describe('POST /api/purchase', () => {
  it('rejects an invalid request (missing item)', async () => {
    await seed(env.DB, raw)
    const res = await onRequestPost({ request: req({ quantity: 1 }), env } as any)
    expect(res.status).toBe(400)
  })

  it('404s an unknown item', async () => {
    await seed(env.DB, raw)
    const res = await onRequestPost({ request: req({ item_id: 'not_a_real_item', quantity: 1 }), env } as any)
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('ITEM_NOT_FOUND')
  })

  it('buys an item, debits coins atomically, and writes an audit row', async () => {
    await seed(env.DB, raw, { coins: 100_000 })
    const res = await onRequestPost({ request: req({ item_id: ITEM, quantity: 2 }), env } as any)
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out.ok).toBe(true)
    expect(out.totalCost).toBe(UNIT * 2)
    expect(coinTotal(raw)).toBe(100_000 - UNIT * 2)
    const audit = raw.prepare(`SELECT event_type, payload_json FROM audit_events WHERE event_type = 'shop_purchase'`).get()
    expect(audit).toBeTruthy()
    expect(JSON.parse(audit.payload_json).itemId).toBe(ITEM)
    // save_revision advanced (stale-write protection stays intact).
    expect(raw.prepare('SELECT save_revision FROM saves WHERE character_id = 7').get().save_revision).toBe(4)
  })

  it('refuses when coins are insufficient and leaves the balance untouched', async () => {
    await seed(env.DB, raw, { coins: UNIT - 1 })
    const before = coinTotal(raw)
    const res = await onRequestPost({ request: req({ item_id: ITEM, quantity: 1 }), env } as any)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INSUFFICIENT_COINS')
    expect(coinTotal(raw)).toBe(before) // no partial debit
  })

  it('blocks a quest-unlock item when the quest is not completed, leaving coins untouched', async () => {
    await seed(env.DB, raw, { coins: 1_000_000 })
    const before = coinTotal(raw)
    const res = await onRequestPost({ request: req({ item_id: 'ava_s_assembler', quantity: 1 }), env } as any)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('QUEST_REQUIREMENT_NOT_MET')
    expect(coinTotal(raw)).toBe(before) // no debit
  })

  it('allows a quest-unlock item once the required quest is completed', async () => {
    await seed(env.DB, raw, { coins: 1_000_000, settings: { completedQuests: ['dragon_slayer_ii'] } })
    const res = await onRequestPost({ request: req({ item_id: 'ava_s_assembler', quantity: 1 }), env } as any)
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('404s a character the caller does not own', async () => {
    await seed(env.DB, raw, { ownerId: 999 }) // owned by someone else; auth identity is 1
    const res = await onRequestPost({ request: req({ item_id: ITEM, quantity: 1 }), env } as any)
    expect(res.status).toBe(404)
  })
})
