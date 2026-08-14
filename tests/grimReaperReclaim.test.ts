// POST /api/grim-reaper/reclaim (§14): credits are debited server-side against
// the real schema and the stash is priced from the server's own stored save —
// the client never names an item list or a price. Runs the real handler SQL
// against the real migrations schema (tests/helpers/d1), same pattern as
// tests/unlockPurchase.test.ts / tests/adminGrantItem.test.ts.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeD1, FakeD1 } from './helpers/d1'
import { gzipJsonString } from '../functions/_lib/saveCodec.js'

vi.mock('../functions/_lib/auth.js', () => ({
  requireAuth: async () => ({ identity: { id: 1 } }),
  json: (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))

import { onRequestPost } from '../functions/api/grim-reaper/reclaim.js'

let raw: any
let env: { DB: FakeD1 }

async function seedCharacter(id: number, { ownerId = 1, credits = 100, save = {} as any } = {}) {
  raw.prepare(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
     VALUES (?, ?, ?, 0, 0, 0, ?, 0, 0, 50, 60, 0, 0)`,
  ).run(id, ownerId, 'c' + id, credits)
  const fullSave = { coins: 0, inventory: [], bank: {}, stats: {}, equipment: {}, settings: {}, ...save }
  const json = JSON.stringify(fullSave)
  const blob = await gzipJsonString(json)
  raw.prepare(
    `INSERT INTO saves (character_id, save_blob, save_data, updated_at, save_revision) VALUES (?, ?, ?, 0, 3)`,
  ).run(id, blob, json)
}

function creditsOf(id: number) {
  return raw.prepare('SELECT credits, credits_used FROM characters WHERE id = ?').get(id)
}

function storedSave(id: number) {
  const row = raw.prepare('SELECT save_data FROM saves WHERE character_id = ?').get(id)
  return JSON.parse(row.save_data)
}

async function reclaim(characterId = 42) {
  const req = new Request('https://x/api/grim-reaper/reclaim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Character-Id': String(characterId) },
    body: '{}',
  })
  const res = await onRequestPost({ request: req, env } as any)
  return { status: res.status, body: (await res.json()) as any }
}

beforeEach(() => {
  const d = makeD1()
  env = { DB: d.DB }
  raw = d.raw
})

describe('POST /api/grim-reaper/reclaim', () => {
  it('refuses when nothing is stashed', async () => {
    await seedCharacter(42, { credits: 100 })
    const out = await reclaim()
    expect(out.status).toBe(404)
    expect(out.body.code).toBe('NO_STASH')
    expect(creditsOf(42)).toMatchObject({ credits: 100, credits_used: 0 })
  })

  it('prices the stash server-side, debits credits, grants items with charges, and clears the stash', async () => {
    await seedCharacter(42, {
      credits: 20,
      save: {
        settings: {
          grimReaper: {
            diedAt: 1_700_000_000_000,
            source: { id: 'zaryth', name: 'Zaryth' },
            items: [
              { itemId: 'coins', quantity: 12_000_000 },
              { itemId: 'venom_blowpipe', quantity: 1, charges: 150 }, // shopValue 25,000,000
            ],
          },
        },
      },
    })
    // (12,000,000 + 25,000,000) / 5,000,000 = 7.4 -> ceil -> 8 credits.
    const out = await reclaim()
    expect(out.status).toBe(200)
    expect(out.body.cost).toBe(8)
    expect(out.body.credits_remaining).toBe(12)
    expect(creditsOf(42)).toMatchObject({ credits: 12, credits_used: 8 })

    const save = storedSave(42)
    expect(save.settings.grimReaper).toBeUndefined()
    expect(save.bank.coins).toMatchObject({ quantity: 12_000_000 })
    expect(save.bank.venom_blowpipe).toMatchObject({ quantity: 1, charges: 150 })
  })

  it('refuses once credits run out, leaving the save and balance untouched', async () => {
    await seedCharacter(42, {
      credits: 1,
      save: { settings: { grimReaper: { diedAt: 1, source: null, items: [{ itemId: 'coins', quantity: 10_000_000 }] } } },
    })
    const out = await reclaim()
    expect(out.status).toBe(402)
    expect(out.body.code).toBe('INSUFFICIENT_CREDITS')
    expect(out.body.cost).toBe(2)
    expect(creditsOf(42)).toMatchObject({ credits: 1, credits_used: 0 })
    expect(storedSave(42).settings.grimReaper).toBeDefined()
    expect(storedSave(42).bank.coins).toBeUndefined()
  })

  it('drops an item no longer in items.json from both the grant and the price, without blocking the rest', async () => {
    await seedCharacter(42, {
      credits: 10,
      save: {
        settings: {
          grimReaper: {
            diedAt: 1,
            source: null,
            items: [{ itemId: 'coins', quantity: 5_000_000 }, { itemId: 'a_removed_item_id', quantity: 1 }],
          },
        },
      },
    })
    const out = await reclaim()
    expect(out.status).toBe(200)
    expect(out.body.cost).toBe(1)
    const save = storedSave(42)
    expect(save.bank.coins).toMatchObject({ quantity: 5_000_000 })
    expect(save.bank.a_removed_item_id).toBeUndefined()
  })

  it('is all-or-nothing at the minimum: 1 credit for a stash worth nothing at all', async () => {
    await seedCharacter(42, { credits: 5, save: { settings: { grimReaper: { diedAt: 1, source: null, items: [{ itemId: 'a_removed_item_id', quantity: 1 }] } } } })
    const out = await reclaim()
    // Every item unresolvable → treated the same as no stash: nothing to grant.
    expect(out.status).toBe(404)
    expect(out.body.code).toBe('NO_STASH')
  })

  it("refuses to spend another owner's character's credits", async () => {
    await seedCharacter(7, {
      ownerId: 999,
      credits: 100,
      save: { settings: { grimReaper: { diedAt: 1, source: null, items: [{ itemId: 'coins', quantity: 1 }] } } },
    })
    const out = await reclaim(7)
    expect(out.status).toBe(404)
    expect(creditsOf(7)).toMatchObject({ credits: 100 })
  })

  it('refuses while a co-op session owns the save', async () => {
    await seedCharacter(42, {
      credits: 100,
      save: { settings: { grimReaper: { diedAt: 1, source: null, items: [{ itemId: 'coins', quantity: 1 }] } } },
    })
    raw.prepare(
      `INSERT INTO coop_boss_sessions (id, boss_id, status, created_at, last_tick_at, state_json)
       VALUES (1, 'corporeal_horror', 'active', 0, ?, '{}')`,
    ).run(Date.now())
    raw.prepare(
      `INSERT INTO coop_session_members (session_id, character_id, joined_at, last_seen_at) VALUES (1, 42, 0, ?)`,
    ).run(Date.now())
    raw.prepare('UPDATE characters SET active_coop_session_id = 1 WHERE id = 42').run()

    const out = await reclaim()
    expect(out.status).toBe(409)
    expect(out.body.code).toBe('CHARACTER_IN_COOP_SESSION')
    expect(creditsOf(42)).toMatchObject({ credits: 100 })
  })
})
