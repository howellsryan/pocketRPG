// POST /api/slayer/skip against the real schema. The credit debit is
// server-authoritative (§14), so the endpoint is exercised end to end rather
// than through a mock: the previous version counted DB.prepare() calls to decide
// which one was the debit, which made adding any lock check to the handler look
// like a broken debit.
import { describe, it, expect, beforeEach } from 'vitest'
import { onRequestPost } from '../functions/api/slayer/skip.js'
import { signJWT } from '../functions/_lib/jwt.js'
import { makeD1, FakeD1 } from './helpers/d1'

const TEST_SECRET = 'test-jwt-secret'
const OWNER = 1
let raw: any
let env: any

async function makeAuthHeader(identityId: number | string = OWNER) {
  return `Bearer ${await signJWT({ sub: identityId, provider: 'test' }, TEST_SECRET)}`
}

function makeRequest({ characterId = '42', auth = '' } = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Character-Id': characterId,
  }
  if (auth) headers.Authorization = auth
  return new Request('https://example.test/api/slayer/skip', {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  })
}

function seedCharacter(id: number, credits: number, ownerId = OWNER) {
  raw.prepare(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
     VALUES (?, ?, ?, 0, 0, 0, ?, 0, 0, 700, 126, 0, 0)`,
  ).run(id, ownerId, 'c' + id, credits)
}

function creditsOf(id: number) {
  return raw.prepare('SELECT credits, credits_used FROM characters WHERE id = ?').get(id)
}

beforeEach(() => {
  const d = makeD1()
  env = { DB: d.DB as FakeD1, JWT_SECRET: TEST_SECRET }
  raw = d.raw
  raw.prepare("INSERT INTO oauth_identities (id, provider, provider_user_id, created_at) VALUES (?, 'test', 'u1', 0)").run(OWNER)
})

describe('POST /api/slayer/skip', () => {
  it('deducts a credit and returns remaining balance', async () => {
    seedCharacter(42, 10)
    const res = await onRequestPost({ request: makeRequest({ auth: await makeAuthHeader() }), env } as any)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, credits_remaining: 9 })
    expect(creditsOf(42)).toMatchObject({ credits: 9, credits_used: 1 })
  })

  it('returns 402 when the character has no credits', async () => {
    seedCharacter(42, 0)
    const res = await onRequestPost({ request: makeRequest({ auth: await makeAuthHeader() }), env } as any)

    expect(res.status).toBe(402)
    expect((await res.json() as any).error).toBe('Insufficient credits')
    expect(creditsOf(42).credits).toBe(0)
  })

  it('rejects unauthenticated requests', async () => {
    seedCharacter(42, 10)
    const res = await onRequestPost({ request: makeRequest(), env } as any)
    expect(res.status).toBe(401)
    expect(creditsOf(42).credits).toBe(10)
  })

  it('rejects when X-Character-Id is missing', async () => {
    seedCharacter(42, 10)
    const res = await onRequestPost({ request: makeRequest({ characterId: '', auth: await makeAuthHeader() }), env } as any)
    expect(res.status).toBe(400)
  })

  it('returns 404 when the character is not owned by the caller', async () => {
    raw.prepare("INSERT INTO oauth_identities (id, provider, provider_user_id, created_at) VALUES (2, 'test', 'u2', 0)").run()
    seedCharacter(42, 10, 2)
    const res = await onRequestPost({ request: makeRequest({ auth: await makeAuthHeader() }), env } as any)

    expect(res.status).toBe(404)
    expect(creditsOf(42).credits).toBe(10)
  })
})
