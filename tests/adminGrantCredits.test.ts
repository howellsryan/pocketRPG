// POST /api/admin/grant-credits — the admin one-off credit boost (§14 integrity
// boundary). Unlike grant-item this never touches the save blob — credits live
// on the `characters` row — so there is no save lock and no revision to guard,
// just the authorization gate and an atomic UPDATE.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeD1, FakeD1 } from './helpers/d1'

import { onRequestPost } from '../functions/api/admin/grant-credits.js'

const SECRET = 'a-very-long-admin-portal-secret'
const NOW = 1_760_000_000_000

let raw: any
let env: any

function seedCharacter(id = 7, { ownerId = 1, credits = 0 } = {}) {
  raw.prepare(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
     VALUES (?, ?, ?, 0, 0, 0, ?, 0, 0, 1, 3, 0, 0)`,
  ).run(id, ownerId, 'char' + id, credits)
}

function req(body: any, { secret = SECRET as string | null } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (secret !== null) headers['X-Admin-Secret'] = secret
  return new Request('https://x/api/admin/grant-credits', { method: 'POST', headers, body: JSON.stringify(body) })
}

function creditsOf(characterId = 7) {
  return Number(raw.prepare('SELECT credits FROM characters WHERE id = ?').get(characterId).credits)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  const d = makeD1()
  env = { DB: d.DB as FakeD1, ADMIN_SECRET: SECRET }
  raw = d.raw
})

describe('POST /api/admin/grant-credits authorization', () => {
  it('rejects a request with no admin secret', async () => {
    seedCharacter()
    const res = await onRequestPost({ request: req({ character_id: 7, amount: 10 }, { secret: null }), env } as any)
    expect(res.status).toBe(401)
    expect(creditsOf()).toBe(0)
  })

  it('rejects a wrong admin secret', async () => {
    seedCharacter()
    const res = await onRequestPost({ request: req({ character_id: 7, amount: 10 }, { secret: 'wrong-but-long-enough-secret' }), env } as any)
    expect(res.status).toBe(401)
  })

  it('fails closed when ADMIN_SECRET is not configured', async () => {
    seedCharacter()
    env.ADMIN_SECRET = undefined
    const res = await onRequestPost({ request: req({ character_id: 7, amount: 10 }, { secret: '' }), env } as any)
    expect(res.status).toBe(401)
  })
})

describe('POST /api/admin/grant-credits validation', () => {
  beforeEach(() => { seedCharacter() })

  it('404s a character that does not exist', async () => {
    const res = await onRequestPost({ request: req({ character_id: 999, amount: 10 }), env } as any)
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('CHARACTER_NOT_FOUND')
  })

  it('400s a non-positive amount', async () => {
    const res = await onRequestPost({ request: req({ character_id: 7, amount: 0 }), env } as any)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_AMOUNT')
  })

  it('400s an amount above the grant cap', async () => {
    const res = await onRequestPost({ request: req({ character_id: 7, amount: 100_001 }), env } as any)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_AMOUNT')
  })

  it('400s a missing amount', async () => {
    const res = await onRequestPost({ request: req({ character_id: 7 }), env } as any)
    expect(res.status).toBe(400)
  })

  it('grants a character the caller does not own — the point of an admin grant, and works with no save row at all', async () => {
    seedCharacter(8, { ownerId: 4242 })
    const res = await onRequestPost({ request: req({ character_id: 8, amount: 25 }), env } as any)
    expect(res.status).toBe(200)
    expect(creditsOf(8)).toBe(25)
  })
})

describe('POST /api/admin/grant-credits grants', () => {
  it('adds the amount to the character credits', async () => {
    seedCharacter(7, { credits: 5 })
    const res = await onRequestPost({ request: req({ character_id: 7, amount: 50 }), env } as any)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, character_id: 7, username: 'char7', amount: 50, before: 5, after: 55 })
    expect(creditsOf()).toBe(55)
  })

  it('dry_run reports the change without writing it', async () => {
    seedCharacter(7, { credits: 5 })
    const res = await onRequestPost({ request: req({ character_id: 7, amount: 50, dry_run: true }), env } as any)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ dry_run: true, before: 5, after: 55 })
    expect(creditsOf()).toBe(5)
  })

  it('writes an audit event naming the grant, with no owner as actor', async () => {
    seedCharacter(7, { credits: 5, ownerId: 42 })
    await onRequestPost({ request: req({ character_id: 7, amount: 20, reason: 'welcome bonus' }), env } as any)
    const row = raw.prepare(`SELECT event_type, character_id, identity_id, payload_json FROM audit_events WHERE event_type = 'admin_credit_grant'`).get()
    expect(row).toBeTruthy()
    expect(row.character_id).toBe(7)
    expect(row.identity_id).toBe(null)
    const payload = JSON.parse(row.payload_json)
    expect(payload).toMatchObject({ amount: 20, before: 5, after: 25, reason: 'welcome bonus', ownerId: 42 })
  })

  it('does not write an audit row on a dry run', async () => {
    seedCharacter()
    await onRequestPost({ request: req({ character_id: 7, amount: 20, dry_run: true }), env } as any)
    const n = raw.prepare(`SELECT COUNT(*) AS n FROM audit_events WHERE event_type = 'admin_credit_grant'`).get().n
    expect(n).toBe(0)
  })

  it('is unaffected by a co-op or world session owning the save — credits are not save-blob state', async () => {
    seedCharacter(7, { credits: 5 })
    raw.prepare(`INSERT INTO world_sessions (character_id, session_id, heartbeat_at, created_at) VALUES (7, 'w1', ?, ?)`).run(NOW - 1_000, NOW)
    const res = await onRequestPost({ request: req({ character_id: 7, amount: 10 }), env } as any)
    expect(res.status).toBe(200)
    expect(creditsOf()).toBe(15)
  })
})
