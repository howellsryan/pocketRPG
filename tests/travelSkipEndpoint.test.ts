import { describe, it, expect, vi } from 'vitest'
import { onRequestPost } from '../functions/api/travel/skip.js'
import { signJWT } from '../functions/_lib/jwt.js'

const TEST_SECRET = 'test-jwt-secret'

async function makeAuthHeader(identityId = 'identity-1') {
  const token = await signJWT({ sub: identityId, provider: 'test' }, TEST_SECRET)
  return `Bearer ${token}`
}

function makeRequest({ characterId = '42', auth = '' } = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Character-Id': characterId,
  }
  if (auth) headers.Authorization = auth
  return new Request('https://example.test/api/travel/skip', {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  })
}

function mockEnv({ characterRow, debitResult }: { characterRow: any, debitResult: any }) {
  const characterFirst = vi.fn().mockResolvedValue(characterRow)
  const debitFirst = vi.fn().mockResolvedValue(debitResult)
  // Two prepare calls: SELECT character, then UPDATE+RETURNING debit.
  // assertNotInActiveMatch makes a separate SELECT first if invoked; we mock
  // that to return no active match by returning null for any other .first().
  const lockFirst = vi.fn().mockResolvedValue(null)
  let prepareCallCount = 0
  const prepare = vi.fn((_sql: string) => {
    prepareCallCount += 1
    const bind = vi.fn(() => {
      // Order of prepare calls in handler:
      //   1: SELECT characters (existence check)
      //   2: assertNotInActiveMatch: SELECT active_match_id (null here)
      //   3: UPDATE characters ... RETURNING credits_remaining
      // With active_match_id null the pvp_matches probe is skipped, so the
      // debit is call #3.
      if (prepareCallCount === 1) return { first: characterFirst, all: vi.fn(), run: vi.fn() }
      if (prepareCallCount === 3) return { first: debitFirst, all: vi.fn(), run: vi.fn() }
      return { first: lockFirst, all: vi.fn(), run: vi.fn() }
    })
    return { bind }
  })
  return { DB: { prepare }, JWT_SECRET: TEST_SECRET }
}

describe('POST /api/travel/skip', () => {
  it('deducts a credit and returns remaining balance', async () => {
    const env = mockEnv({
      characterRow: { id: 42 },
      debitResult: { credits_remaining: 9 },
    })
    const res = await onRequestPost({
      request: makeRequest({ auth: await makeAuthHeader() }),
      env: env as any,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body).toEqual({ ok: true, credits_remaining: 9 })
  })

  it('returns 402 when the character has no credits', async () => {
    const env = mockEnv({
      characterRow: { id: 42 },
      debitResult: null,
    })
    const res = await onRequestPost({
      request: makeRequest({ auth: await makeAuthHeader() }),
      env: env as any,
    })
    expect(res.status).toBe(402)
    const body = await res.json() as any
    expect(body.error).toBe('Insufficient credits')
  })

  it('rejects unauthenticated requests', async () => {
    const env = mockEnv({
      characterRow: { id: 42 },
      debitResult: { credits_remaining: 1 },
    })
    const res = await onRequestPost({
      request: makeRequest(),
      env: env as any,
    })
    expect(res.status).toBe(401)
  })

  it('rejects when X-Character-Id is missing', async () => {
    const env = mockEnv({
      characterRow: { id: 42 },
      debitResult: { credits_remaining: 1 },
    })
    const res = await onRequestPost({
      request: makeRequest({ characterId: '', auth: await makeAuthHeader() }),
      env: env as any,
    })
    expect(res.status).toBe(400)
  })

  it('returns 404 when the character is not owned by the caller', async () => {
    const env = mockEnv({
      characterRow: null,
      debitResult: { credits_remaining: 5 },
    })
    const res = await onRequestPost({
      request: makeRequest({ auth: await makeAuthHeader() }),
      env: env as any,
    })
    expect(res.status).toBe(404)
  })
})
