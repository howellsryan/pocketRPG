import { describe, it, expect, vi } from 'vitest'
import { onRequestPost } from '../functions/api/daily-tasks/complete.js'
import { signJWT } from '../functions/_lib/jwt.js'

const TEST_SECRET = 'test-jwt-secret'

async function makeAuthHeader(identityId = 'identity-1') {
  const token = await signJWT({ sub: identityId, provider: 'test' }, TEST_SECRET)
  return `Bearer ${token}`
}

function makeRequest({ characterId = '42', auth = '', body = {} } = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Character-Id': characterId,
  }
  if (auth) headers.Authorization = auth
  return new Request('https://example.test/api/daily-tasks/complete', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

function mockEnv({
  characterRow = { id: 42 },
  claimedRow = null as any,
  grantRow = null as any,
} = {}) {
  let prepareCallCount = 0
  const lockFirst = vi.fn().mockResolvedValue(null)
  const characterFirst = vi.fn().mockResolvedValue(characterRow)
  const claimedFirst = vi.fn().mockResolvedValue(claimedRow)
  const grantFirst = vi.fn().mockResolvedValue(grantRow)

  const prepare = vi.fn((_sql: string) => {
    prepareCallCount++
    const bind = vi.fn(() => {
      // Order:
      //  1: SELECT characters (ownership check)
      //  2: assertNotInActiveMatch: SELECT active_match_id
      //  3: assertNotInActiveMatch: SELECT id from pvp_matches
      //  4: UPDATE character_daily_tasks ... WHERE credited = 0 RETURNING
      //  5: UPDATE characters SET credits = credits + 1 RETURNING
      if (prepareCallCount === 1) return { first: characterFirst, all: vi.fn(), run: vi.fn() }
      if (prepareCallCount === 4) return { first: claimedFirst, all: vi.fn(), run: vi.fn() }
      if (prepareCallCount === 5) return { first: grantFirst, all: vi.fn(), run: vi.fn() }
      return { first: lockFirst, all: vi.fn(), run: vi.fn() }
    })
    return { bind }
  })
  const auditRun = vi.fn().mockResolvedValue(null)
  return {
    DB: { prepare },
    JWT_SECRET: TEST_SECRET,
    // Minimal audit_events mock
    DB_AUDIT: { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ run: auditRun })) })) },
  }
}

describe('POST /api/daily-tasks/complete', () => {
  it('grants +1 credit and returns the new balance', async () => {
    const env = mockEnv({
      characterRow: { id: 42 },
      claimedRow: { task_id: 'kill_lesser_fiends', tier: 'Intermediate' },
      grantRow: { credits: 5 },
    })
    const res = await onRequestPost({
      request: makeRequest({
        auth: await makeAuthHeader(),
        body: { taskId: 'kill_lesser_fiends', slot: 1, date: '2026-06-25' },
      }),
      env: env as any,
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.ok).toBe(true)
    expect(json.creditsGranted).toBe(1)
    expect(json.credits).toBe(5)
    expect(json.taskId).toBe('kill_lesser_fiends')
  })

  it('returns alreadyCompleted=true on replay (no double grant)', async () => {
    const env = mockEnv({
      characterRow: { id: 42 },
      claimedRow: null, // UPDATE WHERE credited=0 returns no row
      grantRow: null,
    })
    const res = await onRequestPost({
      request: makeRequest({
        auth: await makeAuthHeader(),
        body: { taskId: 'kill_lesser_fiends', slot: 1, date: '2026-06-25' },
      }),
      env: env as any,
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.ok).toBe(true)
    expect(json.alreadyCompleted).toBe(true)
    expect(json.creditsGranted).toBe(0)
  })

  it('returns 401 without auth', async () => {
    const env = mockEnv()
    const res = await onRequestPost({
      request: makeRequest({ body: { taskId: 'x', slot: 0, date: '2026-06-25' } }),
      env: env as any,
    })
    expect(res.status).toBe(401)
  })

  it('returns 400 for missing characterId header', async () => {
    const env = mockEnv()
    const req = new Request('https://example.test/api/daily-tasks/complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: await makeAuthHeader(),
      },
      body: JSON.stringify({ taskId: 'x', slot: 0, date: '2026-06-25' }),
    })
    const res = await onRequestPost({ request: req, env: env as any })
    expect(res.status).toBe(400)
  })

  it('returns 400 when required fields are missing', async () => {
    const env = mockEnv({ characterRow: { id: 42 } })
    const res = await onRequestPost({
      request: makeRequest({
        auth: await makeAuthHeader(),
        body: { taskId: 'x' }, // missing slot + date
      }),
      env: env as any,
    })
    expect(res.status).toBe(400)
  })

  it('returns 404 for character not owned by identity', async () => {
    const env = mockEnv({ characterRow: null })
    const res = await onRequestPost({
      request: makeRequest({
        auth: await makeAuthHeader(),
        body: { taskId: 'x', slot: 0, date: '2026-06-25' },
      }),
      env: env as any,
    })
    expect(res.status).toBe(404)
  })
})
