import { describe, it, expect, vi } from 'vitest'
import {
  BOSS_RAID_SKIP_CODE,
  BOSS_RAID_SKIP_MESSAGE,
  onRequestPost,
} from '../functions/api/skip-hour.js'
import { signJWT } from '../functions/_lib/jwt.js'

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
// checks sit between the existence probe and the debit, so a positional mock
// breaks every time one is added. Everything unmatched resolves null, which
// reads as "no lock held".
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
  return { DB: { prepare }, JWT_SECRET: TEST_SECRET, debitFirst }
}

describe('POST /api/skip-hour boss and raid protection', () => {
  it('refuses a full raid skip without spending credits', async () => {
    const env = mockEnv({ debitResult: { credits_remaining: 92 } })
    const res = await onRequestPost({
      request: makeRequest({ raidId: 'crimson_night_theatre' }, { auth: await makeAuthHeader() }),
      env: env as any,
    })

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: BOSS_RAID_SKIP_MESSAGE,
      code: BOSS_RAID_SKIP_CODE,
    })
    expect(env.debitFirst).not.toHaveBeenCalled()
  })

  it('refuses a boss instant-kill skip without spending credits', async () => {
    const env = mockEnv({ debitResult: { credits_remaining: 0 } })
    const res = await onRequestPost({
      request: makeRequest({ bossId: 'ember_tyrant' }, { auth: await makeAuthHeader() }),
      env: env as any,
    })

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: BOSS_RAID_SKIP_MESSAGE,
      code: BOSS_RAID_SKIP_CODE,
    })
    expect(env.debitFirst).not.toHaveBeenCalled()
  })

  it('keeps an ordinary one-hour skip at one credit', async () => {
    const env = mockEnv({ debitResult: { credits_remaining: 4 } })
    const res = await onRequestPost({
      request: makeRequest({}, { auth: await makeAuthHeader() }),
      env: env as any,
    })

    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.cost).toBe(1)
    expect(body.credits_remaining).toBe(4)
    expect(env.debitFirst).toHaveBeenCalledTimes(1)
  })

  it('returns 402 when the character cannot afford an ordinary hour skip', async () => {
    const env = mockEnv({ debitResult: null })
    const res = await onRequestPost({
      request: makeRequest({}, { auth: await makeAuthHeader() }),
      env: env as any,
    })

    expect(res.status).toBe(402)
    const body = await res.json() as any
    expect(body.error).toBe('Insufficient credits')
  })
})
