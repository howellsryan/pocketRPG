import { describe, it, expect, vi } from 'vitest'
import { onRequestPost } from '../functions/api/world-token.js'
import { signJWT, verifyJWT } from '../functions/_lib/jwt.js'

const TEST_SECRET = 'test-jwt-secret'

async function makeAuthHeader(identityId = 'identity-1') {
  const token = await signJWT({ sub: identityId, provider: 'test' }, TEST_SECRET)
  return `Bearer ${token}`
}

function makeRequest({ characterId = '42', auth = '' } = {}) {
  const headers: Record<string, string> = { 'X-Character-Id': characterId }
  if (auth) headers.Authorization = auth
  return new Request('https://example.test/api/world-token', { method: 'POST', headers })
}

function mockEnv({ characterRow = { id: 42 } as any } = {}) {
  const characterFirst = vi.fn().mockResolvedValue(characterRow)
  const prepare = vi.fn((_sql: string) => ({ bind: vi.fn(() => ({ first: characterFirst })) }))
  return { DB: { prepare }, JWT_SECRET: TEST_SECRET }
}

describe('POST /api/world-token', () => {
  it('rejects a request with no bearer token', async () => {
    const env = mockEnv()
    const res = await onRequestPost({ request: makeRequest({ auth: '' }), env } as any)
    expect(res.status).toBe(401)
  })

  it('rejects a character the caller does not own', async () => {
    const env = mockEnv({ characterRow: null })
    const auth = await makeAuthHeader('identity-1')
    const res = await onRequestPost({ request: makeRequest({ auth }), env } as any)
    expect(res.status).toBe(404)
  })

  it('returns a short-lived world_handoff-scoped JWT for an owned character', async () => {
    const env = mockEnv({ characterRow: { id: 42 } })
    const auth = await makeAuthHeader('identity-1')
    const res = await onRequestPost({ request: makeRequest({ characterId: '42', auth }), env } as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.handoff).toBe('string')

    const payload = await verifyJWT(body.handoff, TEST_SECRET)
    expect(payload).toMatchObject({ sub: 'identity-1', character_id: 42, scope: 'world_handoff' })
    expect(payload.exp - payload.iat).toBe(60)
  })
})
