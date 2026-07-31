import { describe, it, expect, vi } from 'vitest'
import { onRequestPost } from '../functions/api/world-token.js'
import { signJWT, verifyJWT } from '../functions/_lib/jwt.js'

const TEST_SECRET = 'test-jwt-secret'

async function makeAuthHeader(identityId = 'identity-1') {
  const token = await signJWT({ sub: identityId, provider: 'test' }, TEST_SECRET)
  return `Bearer ${token}`
}

function makeRequest({ characterId = '42', auth = '', body = undefined as unknown } = {}) {
  const headers: Record<string, string> = { 'X-Character-Id': characterId }
  if (auth) headers.Authorization = auth
  return new Request('https://example.test/api/world-token', {
    method: 'POST',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function mockEnv({
  characterRow = { id: 42 } as any,
  killCounts = [] as Array<{ source_id: string; kill_count: number }>,
  save = {} as Record<string, unknown>,
} = {}) {
  const characterFirst = vi.fn().mockResolvedValue(characterRow)
  // The lair gate reads kill_counts and the character's save; everything else
  // this endpoint touches resolves through the same character row.
  const saveFirst = vi.fn().mockResolvedValue({
    id: 42, owner_id: 'identity-1', save_data: JSON.stringify(save), save_revision: 1,
  })
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn(() => ({
      first: sql.includes('save_revision') ? saveFirst : characterFirst,
      all: vi.fn().mockResolvedValue({ results: killCounts }),
      run: vi.fn().mockResolvedValue({}),
    })),
  }))
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
    expect(payload.world_zone).toBeUndefined()
  })

  it('refuses a boss lair the character has not unlocked', async () => {
    // The world Worker grants this boss's drop table on a kill, so the client's
    // combat-screen check is not a gate (§20). Zaryth's throne needs all four
    // generals; a handoff with none of them on record must not be signed.
    const env = mockEnv({ characterRow: { id: 42 }, killCounts: [] })
    const auth = await makeAuthHeader('identity-1')
    const res = await onRequestPost({ request: makeRequest({ auth, body: { zone: 'zaryth_throne' } }), env } as any)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('BOSS_REQUIREMENTS_NOT_MET')
    expect(body.error).toContain('Zaryth')
  })

  it('signs the handoff once the lair\'s kill-count gate is satisfied', async () => {
    const env = mockEnv({
      characterRow: { id: 42 },
      killCounts: [
        { source_id: 'warlord_grondar', kill_count: 1 },
        { source_id: 'commander_zephyra', kill_count: 1 },
        { source_id: 'krylth_the_defiler', kill_count: 1 },
        { source_id: 'skyrender_kharra', kill_count: 1 },
      ],
    })
    const auth = await makeAuthHeader('identity-1')
    const res = await onRequestPost({ request: makeRequest({ auth, body: { zone: 'zaryth_throne' } }), env } as any)
    expect(res.status).toBe(200)
    const payload = await verifyJWT((await res.json()).handoff, TEST_SECRET)
    expect(payload.world_zone).toBe('zaryth_throne')
  })

  it('carries a requested entry zone through as a claim', async () => {
    const env = mockEnv({ characterRow: { id: 42 } })
    const auth = await makeAuthHeader('identity-1')
    const res = await onRequestPost({ request: makeRequest({ auth, body: { zone: 'grondar_lair' } }), env } as any)
    const payload = await verifyJWT((await res.json()).handoff, TEST_SECRET)
    expect(payload.world_zone).toBe('grondar_lair')
  })

  it('drops a zone that is not a plain zone id, rather than signing it', async () => {
    const env = mockEnv({ characterRow: { id: 42 } })
    const auth = await makeAuthHeader('identity-1')
    for (const zone of ['../../etc', 'Grondar Lair', 'grondar_lair~3', 42, null]) {
      const res = await onRequestPost({ request: makeRequest({ auth, body: { zone } }), env } as any)
      const payload = await verifyJWT((await res.json()).handoff, TEST_SECRET)
      expect(payload.world_zone, String(zone)).toBeUndefined()
    }
  })
})
