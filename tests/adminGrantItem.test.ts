// POST /api/admin/grant-item — the admin item grant (§14 integrity boundary).
// Runs the real handler SQL against the real migrations schema (tests/helpers/d1)
// so the authorization gate, the three save locks and the revision-guarded
// write are all exercised end to end.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeD1, FakeD1 } from './helpers/d1'
import { gzipJsonString } from '../functions/_lib/saveCodec.js'

import { onRequestPost } from '../functions/api/admin/grant-item.js'
import { writeSave } from '../functions/_lib/game/save.js'

const SECRET = 'a-very-long-admin-portal-secret'
const NOW = 1_760_000_000_000

let raw: any
let env: any

async function seedCharacter(id = 7, { ownerId = 1, inventory = [] as any[], bank = {} as any } = {}) {
  raw.prepare(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
     VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 1, 3, 0, 0)`,
  ).run(id, ownerId, 'char' + id)
  const save = JSON.stringify({ coins: 0, inventory, bank, stats: {}, equipment: {}, settings: {} })
  const blob = await gzipJsonString(save)
  raw.prepare(`INSERT INTO saves (character_id, save_blob, save_data, updated_at, save_revision) VALUES (?, ?, ?, 0, 4)`).run(id, blob, save)
}

function req(body: any, { secret = SECRET as string | null } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (secret !== null) headers['X-Admin-Secret'] = secret
  return new Request('https://x/api/admin/grant-item', { method: 'POST', headers, body: JSON.stringify(body) })
}

function storedSave(characterId = 7) {
  const row = raw.prepare('SELECT save_data, save_revision FROM saves WHERE character_id = ?').get(characterId)
  return { save: JSON.parse(row.save_data), revision: Number(row.save_revision) }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  const d = makeD1()
  env = { DB: d.DB as FakeD1, ADMIN_SECRET: SECRET }
  raw = d.raw
})
afterEach(() => {
  vi.useRealTimers()
})

describe('POST /api/admin/grant-item authorization', () => {
  it('rejects a request with no admin secret', async () => {
    await seedCharacter()
    const res = await onRequestPost({ request: req({ character_id: 7, item_id: 'coins' }, { secret: null }), env } as any)
    expect(res.status).toBe(401)
    expect(storedSave().revision).toBe(4)
  })

  it('rejects a wrong admin secret', async () => {
    await seedCharacter()
    const res = await onRequestPost({ request: req({ character_id: 7, item_id: 'coins' }, { secret: 'wrong-but-long-enough-secret' }), env } as any)
    expect(res.status).toBe(401)
  })

  it('rejects a secret that is a prefix of the real one', async () => {
    await seedCharacter()
    const res = await onRequestPost({ request: req({ character_id: 7, item_id: 'coins' }, { secret: SECRET.slice(0, -1) }), env } as any)
    expect(res.status).toBe(401)
  })

  it('fails closed when ADMIN_SECRET is not configured', async () => {
    await seedCharacter()
    env.ADMIN_SECRET = undefined
    const res = await onRequestPost({ request: req({ character_id: 7, item_id: 'coins' }, { secret: '' }), env } as any)
    expect(res.status).toBe(401)
  })

  it('fails closed when ADMIN_SECRET is configured too short to be a real secret', async () => {
    await seedCharacter()
    env.ADMIN_SECRET = 'short'
    const res = await onRequestPost({ request: req({ character_id: 7, item_id: 'coins' }, { secret: 'short' }), env } as any)
    expect(res.status).toBe(401)
  })

  it('accepts the real secret even when ADMIN_SECRET carries a trailing newline (openssl / dashboard paste)', async () => {
    // The header itself can never carry one — fetch() strips leading/trailing
    // whitespace from header values before it reaches the wire — so only the
    // env var side needs the accidental newline to reproduce the mismatch.
    await seedCharacter()
    env.ADMIN_SECRET = SECRET + '\n'
    const res = await onRequestPost({ request: req({ character_id: 7, item_id: 'coins' }), env } as any)
    expect(res.status).toBe(200)
  })

  it('accepts the real secret even when ADMIN_SECRET carries leading/trailing spaces', async () => {
    await seedCharacter()
    env.ADMIN_SECRET = `  ${SECRET}  `
    const res = await onRequestPost({ request: req({ character_id: 7, item_id: 'coins' }), env } as any)
    expect(res.status).toBe(200)
  })
})

describe('POST /api/admin/grant-item validation', () => {
  beforeEach(async () => { await seedCharacter() })

  it('404s an item that does not exist', async () => {
    const res = await onRequestPost({ request: req({ character_id: 7, item_id: 'excalibur_of_nothing' }), env } as any)
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('ITEM_NOT_FOUND')
  })

  it('404s a character that does not exist', async () => {
    const res = await onRequestPost({ request: req({ character_id: 999, item_id: 'coins' }), env } as any)
    expect(res.status).toBe(404)
  })

  it('400s a non-positive quantity', async () => {
    const res = await onRequestPost({ request: req({ character_id: 7, item_id: 'coins', quantity: 0 }), env } as any)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_QUANTITY')
  })

  it('400s a quantity above the grant cap', async () => {
    const res = await onRequestPost({ request: req({ character_id: 7, item_id: 'coins', quantity: 1_000_000_001 }), env } as any)
    expect(res.status).toBe(400)
  })

  it('400s an unknown destination', async () => {
    const res = await onRequestPost({ request: req({ character_id: 7, item_id: 'coins', destination: 'equipment' }), env } as any)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_DESTINATION')
  })

  it('400s a missing item_id', async () => {
    const res = await onRequestPost({ request: req({ character_id: 7 }), env } as any)
    expect(res.status).toBe(400)
  })

  it('404s an item_id that names an inherited Object property rather than an item', async () => {
    for (const itemId of ['constructor', 'toString', '__proto__']) {
      const res = await onRequestPost({ request: req({ character_id: 7, item_id: itemId }), env } as any)
      expect(res.status, itemId).toBe(404)
    }
    expect(storedSave().revision).toBe(4)
  })

  it('refuses a character that has never synced a save', async () => {
    raw.prepare(
      `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
       VALUES (9, 1, 'unsynced', 0, 0, 0, 0, 0, 0, 1, 3, 0, 0)`,
    ).run()
    const res = await onRequestPost({ request: req({ character_id: 9, item_id: 'coins' }), env } as any)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('SAVE_NOT_FOUND')
    expect(raw.prepare('SELECT COUNT(*) AS n FROM saves WHERE character_id = 9').get().n).toBe(0)
  })
})

describe('POST /api/admin/grant-item grants', () => {
  it('adds a stackable item to the inventory and bumps the save revision', async () => {
    await seedCharacter(7, { inventory: [{ itemId: 'coins', quantity: 100 }] })
    const res = await onRequestPost({ request: req({ character_id: 7, item_id: 'coins', quantity: 50_000 }), env } as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, item_id: 'coins', before: 100, after: 50_100, destination: 'inventory' })
    const { save, revision } = storedSave()
    expect(save.inventory.find((s: any) => s.itemId === 'coins').quantity).toBe(50_100)
    expect(revision).toBe(5)
  })

  it('adds to the bank when asked', async () => {
    await seedCharacter(7, { bank: { coins: { itemId: 'coins', quantity: 5 } } })
    const res = await onRequestPost({ request: req({ character_id: 7, item_id: 'coins', quantity: 20, destination: 'bank' }), env } as any)
    expect(res.status).toBe(200)
    expect(storedSave().save.bank.coins.quantity).toBe(25)
    expect(storedSave().save.inventory).toHaveLength(0)
  })

  it('gives one inventory slot per copy of a non-stackable item', async () => {
    await seedCharacter()
    const res = await onRequestPost({ request: req({ character_id: 7, item_id: 'runeforged_scimitar', quantity: 3 }), env } as any)
    expect(res.status).toBe(200)
    const slots = storedSave().save.inventory.filter((s: any) => s.itemId === 'runeforged_scimitar')
    expect(slots).toHaveLength(3)
    expect(slots.every((s: any) => s.quantity === 1)).toBe(true)
  })

  it('lands a non-stackable grant as one noted stack when asked', async () => {
    await seedCharacter()
    const res = await onRequestPost({ request: req({ character_id: 7, item_id: 'runeforged_scimitar', quantity: 40, noted: true }), env } as any)
    expect(res.status).toBe(200)
    const slots = storedSave().save.inventory.filter((s: any) => s.itemId === 'runeforged_scimitar')
    expect(slots).toHaveLength(1)
    expect(slots[0]).toMatchObject({ quantity: 40, noted: true })
  })

  it('refuses rather than dropping items when the pack cannot hold the grant', async () => {
    await seedCharacter(7, { inventory: Array.from({ length: 27 }, () => ({ itemId: 'bones', quantity: 1 })) })
    const res = await onRequestPost({ request: req({ character_id: 7, item_id: 'runeforged_scimitar', quantity: 5 }), env } as any)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('INVENTORY_FULL')
    expect(storedSave().revision).toBe(4)
  })

  it('resolves a legacy item id to its canonical id', async () => {
    await seedCharacter()
    const res = await onRequestPost({ request: req({ character_id: 7, item_id: 'rune_scimitar' }), env } as any)
    expect(res.status).toBe(200)
    expect((await res.json()).item_id).toBe('runeforged_scimitar')
    expect(storedSave().save.inventory[0].itemId).toBe('runeforged_scimitar')
  })

  it('grants to a character the caller does not own — the point of an admin grant', async () => {
    await seedCharacter(7, { ownerId: 4242 })
    const res = await onRequestPost({ request: req({ character_id: 7, item_id: 'coins', quantity: 10 }), env } as any)
    expect(res.status).toBe(200)
    expect(storedSave().save.inventory[0].quantity).toBe(10)
  })

  it('writes an audit event naming the grant', async () => {
    await seedCharacter()
    await onRequestPost({ request: req({ character_id: 7, item_id: 'coins', quantity: 12, reason: 'compensation' }), env } as any)
    const row = raw.prepare(`SELECT event_type, character_id, payload_json FROM audit_events WHERE event_type = 'admin_item_grant'`).get()
    expect(row).toBeTruthy()
    expect(row.character_id).toBe(7)
    const payload = JSON.parse(row.payload_json)
    expect(payload).toMatchObject({ itemId: 'coins', quantity: 12, destination: 'inventory', reason: 'compensation', ownerId: 1 })
  })

  it('writes no audit row when the guarded save write loses a revision race', async () => {
    // Exercised against writeSave directly: the endpoint reads and writes the
    // revision inside one request, so a conflict can only be staged at the
    // layer that carries the guarantee. A stale revision must write neither the
    // save nor an audit row claiming a grant that never landed.
    await seedCharacter()
    await expect(
      writeSave(env, 7, { coins: 1 }, 1, {
        auditEvent: { eventType: 'admin_item_grant', identityId: null, payload: { itemId: 'coins' } },
      }),
    ).rejects.toMatchObject({ code: 'SAVE_REVISION_CONFLICT' })
    expect(raw.prepare(`SELECT COUNT(*) AS n FROM audit_events WHERE event_type = 'admin_item_grant'`).get().n).toBe(0)
    expect(storedSave().revision).toBe(4)
  })

  it('commits the audit row in the same write as the grant, so neither can land alone', async () => {
    await seedCharacter()
    await onRequestPost({ request: req({ character_id: 7, item_id: 'coins', quantity: 5 }), env } as any)
    const audits = raw.prepare(`SELECT COUNT(*) AS n FROM audit_events WHERE event_type = 'admin_item_grant'`).get().n
    expect(audits).toBe(1)
    expect(storedSave().revision).toBe(5)
  })

  it('does not credit the character owner as the actor on the audit row', async () => {
    await seedCharacter()
    await onRequestPost({ request: req({ character_id: 7, item_id: 'coins', quantity: 1 }), env } as any)
    const row = raw.prepare(`SELECT identity_id FROM audit_events WHERE event_type = 'admin_item_grant'`).get()
    expect(row.identity_id).toBe(null)
  })

  it('names the character it granted to in the response', async () => {
    await seedCharacter()
    const res = await onRequestPost({ request: req({ character_id: 7, item_id: 'coins', quantity: 1 }), env } as any)
    expect(await res.json()).toMatchObject({ character_id: 7, username: 'char7', item_name: 'Coins' })
  })

  it('dry_run reports the change without writing it', async () => {
    await seedCharacter(7, { inventory: [{ itemId: 'coins', quantity: 100 }] })
    const res = await onRequestPost({ request: req({ character_id: 7, item_id: 'coins', quantity: 500, dry_run: true }), env } as any)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ dry_run: true, before: 100, after: 600 })
    const { save, revision } = storedSave()
    expect(save.inventory[0].quantity).toBe(100)
    expect(revision).toBe(4)
  })
})

describe('POST /api/admin/grant-item save locks', () => {
  beforeEach(async () => { await seedCharacter() })

  it('refuses while a co-op boss session owns the save', async () => {
    raw.prepare(`INSERT INTO coop_boss_sessions (id, boss_id, status, member_count, created_at, current_tick, state_json, last_tick_at) VALUES (11, 'grondar', 'active', 1, ?, 0, '{}', ?)`).run(NOW, NOW)
    raw.prepare(`INSERT INTO coop_session_members (session_id, character_id, joined_at, last_seen_at) VALUES (11, 7, ?, ?)`).run(NOW, NOW)
    raw.prepare('UPDATE characters SET active_coop_session_id = 11 WHERE id = 7').run()
    const res = await onRequestPost({ request: req({ character_id: 7, item_id: 'coins' }), env } as any)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('CHARACTER_IN_COOP_SESSION')
  })

  it('refuses while a live open-world session owns the save', async () => {
    raw.prepare(`INSERT INTO world_sessions (character_id, session_id, heartbeat_at, created_at) VALUES (7, 'w1', ?, ?)`).run(NOW - 1_000, NOW)
    const res = await onRequestPost({ request: req({ character_id: 7, item_id: 'coins' }), env } as any)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('CHARACTER_IN_WORLD_SESSION')
    expect(storedSave().revision).toBe(4)
  })

  it('grants once a stale world session has lapsed past its TTL', async () => {
    raw.prepare(`INSERT INTO world_sessions (character_id, session_id, heartbeat_at, created_at) VALUES (7, 'w1', ?, ?)`).run(NOW - 300_000, NOW)
    const res = await onRequestPost({ request: req({ character_id: 7, item_id: 'coins', quantity: 3 }), env } as any)
    expect(res.status).toBe(200)
    expect(storedSave().save.inventory[0].quantity).toBe(3)
  })
})
