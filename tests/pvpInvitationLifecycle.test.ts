// PvP invitation lifecycle guards (§10/§14). Decline is fully exercised;
// accept's early account/id guards are covered. Full match creation +
// settlement run against the real engine elsewhere (pvpEngine tests) — this
// pins the endpoint-level ownership/state transitions against the real schema.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeD1, FakeD1 } from './helpers/d1'

vi.mock('../functions/_lib/auth.js', () => ({
  requireAuth: async () => ({ identity: { id: 1 } }),
  json: (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))

import { onRequestPost as decline } from '../functions/api/pvp/invitations/[id]/decline.js'
import { onRequestPost as accept } from '../functions/api/pvp/invitations/[id]/accept.js'

let raw: any
let env: { DB: FakeD1 }
function char(id: number, ownerId: number, { ironman = 0, oneLife = 0 } = {}) {
  raw.prepare(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
     VALUES (?, ?, ?, 0, ?, ?, 0, 0, 0, 50, 60, 0, 0)`,
  ).run(id, ownerId, 'c' + id, ironman, oneLife)
}
function invite(id: number, from: number, to: number, status = 'pending') {
  raw.prepare(
    `INSERT INTO pvp_invitations (id, from_character, to_character, status, created_at) VALUES (?, ?, ?, ?, 0)`,
  ).run(id, from, to, status)
}
function reqFor(characterId: number) {
  return new Request('https://x', { method: 'POST', headers: { 'X-Character-Id': String(characterId) } })
}

beforeEach(() => {
  const d = makeD1()
  env = { DB: d.DB }
  raw = d.raw
})

describe('POST /api/pvp/invitations/:id/decline', () => {
  it('400s an invalid invitation id', async () => {
    char(10, 1)
    const res = await decline({ request: reqFor(10), env, params: { id: 'abc' } } as any)
    expect(res.status).toBe(400)
  })

  it('404s for a character the caller does not own', async () => {
    char(10, 999) // owned by another identity
    const res = await decline({ request: reqFor(10), env, params: { id: '5' } } as any)
    expect(res.status).toBe(404)
  })

  it('declines a pending invite the caller received and flips its status', async () => {
    char(10, 1) // recipient, owned by identity 1
    char(20, 2) // sender
    invite(5, 20, 10, 'pending')
    const res = await decline({ request: reqFor(10), env, params: { id: '5' } } as any)
    expect(res.status).toBe(200)
    const row = raw.prepare('SELECT status, responded_at FROM pvp_invitations WHERE id = 5').get()
    expect(row.status).toBe('declined')
    expect(row.responded_at).toBeGreaterThan(0)
  })

  it('404s when declining an invite the caller did not receive', async () => {
    char(10, 1)
    char(20, 2)
    invite(5, 20, 999, 'pending') // addressed to someone else
    const res = await decline({ request: reqFor(10), env, params: { id: '5' } } as any)
    expect(res.status).toBe(404)
  })

  it('is not re-declinable once already declined (no double transition)', async () => {
    char(10, 1)
    char(20, 2)
    invite(5, 20, 10, 'declined')
    const res = await decline({ request: reqFor(10), env, params: { id: '5' } } as any)
    expect(res.status).toBe(404)
  })
})

describe('POST /api/pvp/invitations/:id/accept — early guards', () => {
  it('403s an Ironman (PvP not allowed for account type)', async () => {
    char(10, 1, { ironman: 1 })
    const res = await accept({ request: reqFor(10), env, params: { id: '5' } } as any)
    expect(res.status).toBe(403)
  })

  it('400s an invalid invitation id', async () => {
    char(10, 1)
    const res = await accept({ request: reqFor(10), env, params: { id: 'nope' } } as any)
    expect(res.status).toBe(400)
  })
})
