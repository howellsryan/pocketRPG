import { describe, it, expect, vi } from 'vitest'
import raids from '../src/data/raids.json'
import { onRequestPost } from '../functions/api/skip-hour.js'
import { signJWT } from '../functions/_lib/jwt.js'

// A full-raid skip is server-authoritative: the cost lives as `skipCost` on the
// raid definition (its bosses plus any additional forms), and
// functions/api/skip-hour.js reads the same field when a `raidId` is supplied.
describe('raid skip cost data', () => {
  it('charges the agreed full-raid skip costs', () => {
    const r = raids as Record<string, any>
    expect(r.crimson_night_theatre.skipCost).toBe(10)
    expect(r.vaults_of_xyren.skipCost).toBe(10)
    expect(r.cryptbound_champions.skipCost).toBe(2)
  })

  it('keeps legacy raid aliases in sync with their canonical raid', () => {
    const r = raids as Record<string, any>
    expect(r.chambers_of_xeric.skipCost).toBe(r.vaults_of_xyren.skipCost)
    expect(r.theatre_of_blood.skipCost).toBe(r.crimson_night_theatre.skipCost)
    expect(r.barrows_brothers.skipCost).toBe(r.cryptbound_champions.skipCost)
  })

  it('any declared raid skipCost is a positive integer', () => {
    for (const [id, raid] of Object.entries(raids as Record<string, any>)) {
      if (raid.skipCost === undefined) continue
      expect(Number.isInteger(raid.skipCost), `${id} skipCost must be an integer`).toBe(true)
      expect(raid.skipCost, `${id} skipCost must be > 0`).toBeGreaterThan(0)
    }
  })
})

const TEST_SECRET = 'test-jwt-secret'

async function makeAuthHeader(identityId = 'identity-1') {
  const token = await signJWT({ sub: identityId, provider: 'test' }, TEST_SECRET)
  return `Bearer ${token}`
}

function makeRequest(body: Record<string, unknown> = {}, { characterId = '42', auth = '' } = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Character-Id': characterId,
  }
  if (auth) headers.Authorization = auth
  return new Request('https://example.test/api/skip-hour', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

// Routed on the SQL rather than the prepare-call index: the endpoint's lock
// checks (PvP active match, live co-op session) sit between the existence probe
// and the debit, so a positional mock breaks every time one is added.
// Everything unmatched resolves null, which reads as "no lock held".
function mockEnv({ characterRow = { id: 42 }, debitResult = { credits_remaining: 0 } } = {}) {
  const characterFirst = vi.fn().mockResolvedValue(characterRow)
  const debitFirst = vi.fn().mockResolvedValue(debitResult)
  const lockFirst = vi.fn().mockResolvedValue(null)
  const prepare = vi.fn((sql: string) => {
    const isDebit = /UPDATE\s+characters/i.test(sql) && /credits/i.test(sql)
    const isExistence = /SELECT\s+id\s+FROM\s+characters/i.test(sql)
    const bind = vi.fn(() => {
      if (isDebit) return { first: debitFirst, all: vi.fn(), run: vi.fn() }
      if (isExistence) return { first: characterFirst, all: vi.fn(), run: vi.fn() }
      return { first: lockFirst, all: vi.fn(), run: vi.fn() }
    })
    return { bind }
  })
  return { DB: { prepare }, JWT_SECRET: TEST_SECRET }
}

describe('POST /api/skip-hour cost resolution', () => {
  it('charges the full-raid skipCost when a raidId is supplied', async () => {
    const env = mockEnv({ debitResult: { credits_remaining: 92 } })
    const res = await onRequestPost({
      request: makeRequest({ raidId: 'crimson_night_theatre' }, { auth: await makeAuthHeader() }),
      env: env as any,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.cost).toBe(10)
    expect(body.credits_remaining).toBe(92)
  })

  it('charges the boss skipCost when only a bossId is supplied', async () => {
    const env = mockEnv({ debitResult: { credits_remaining: 0 } })
    const res = await onRequestPost({
      request: makeRequest({ bossId: 'ember_tyrant' }, { auth: await makeAuthHeader() }),
      env: env as any,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.cost).toBe(10)
  })

  it('defaults to 1 credit for a plain hour skip', async () => {
    const env = mockEnv({ debitResult: { credits_remaining: 4 } })
    const res = await onRequestPost({
      request: makeRequest({}, { auth: await makeAuthHeader() }),
      env: env as any,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.cost).toBe(1)
  })

  it('returns 402 when the character cannot afford the raid skip', async () => {
    const env = mockEnv({ debitResult: null })
    const res = await onRequestPost({
      request: makeRequest({ raidId: 'vaults_of_xyren' }, { auth: await makeAuthHeader() }),
      env: env as any,
    })
    expect(res.status).toBe(402)
    const body = await res.json() as any
    expect(body.error).toBe('Insufficient credits')
  })
})
