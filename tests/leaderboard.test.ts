import { describe, it, expect, vi, afterEach } from 'vitest'
import { onRequestGet } from '../functions/api/leaderboard.js'

function stubCache() {
  const match = vi.fn()
  const put = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('caches', { default: { match, put } })
  return { match, put }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function mockDb(rows: any[]) {
  const all = vi.fn().mockResolvedValue({ results: rows })
  const bind = vi.fn(() => ({ all }))
  const prepare = vi.fn(() => ({ bind }))
  return { env: { DB: { prepare } } as any, prepare, bind, all }
}

function reqWith(query = ''): Request {
  return new Request(`https://example.test/api/leaderboard${query}`)
}

describe('GET /api/leaderboard (denormalized + paginated)', () => {
  it('queries `characters` directly with no JOIN to `saves`', async () => {
    const { env, prepare } = mockDb([])
    await onRequestGet({ request: reqWith(), env } as any)

    const sql = prepare.mock.calls[0][0] as string
    expect(sql).toContain('FROM characters')
    expect(sql).not.toMatch(/JOIN\s+saves/i)
    expect(sql).not.toContain('save_data')
    expect(sql).toContain('total_level')
    expect(sql).toContain('LIMIT ? OFFSET ?')
    expect(sql).toContain('total_level > 33')
    expect(sql).toContain('deleted_at IS NULL')
    expect(sql).toMatch(/ORDER BY\s+total_level\s+DESC/i)
    // Ties break by who reached the total level first, then by id (migration 0024).
    expect(sql).toMatch(/ORDER BY\s+total_level\s+DESC,\s+total_level_at\s+ASC,\s+id\s+ASC/i)
  })

  it('uses default pagination when no params are given', async () => {
    const { env, bind } = mockDb([])
    await onRequestGet({ request: reqWith(), env } as any)
    expect(bind).toHaveBeenCalledWith(100, 0)
  })

  it('respects ?limit and ?offset and clamps out-of-range values', async () => {
    const { env, bind } = mockDb([])
    await onRequestGet({ request: reqWith('?limit=25&offset=50'), env } as any)
    expect(bind).toHaveBeenLastCalledWith(25, 50)

    await onRequestGet({ request: reqWith('?limit=9999&offset=-5'), env } as any)
    // limit clamps to MAX_LIMIT (200), offset clamps to 0
    expect(bind).toHaveBeenLastCalledWith(200, 0)

    await onRequestGet({ request: reqWith('?limit=0'), env } as any)
    // limit clamps up to min=1
    expect(bind).toHaveBeenLastCalledWith(1, 0)

    await onRequestGet({ request: reqWith('?limit=abc&offset=xyz'), env } as any)
    // non-numeric falls back to defaults
    expect(bind).toHaveBeenLastCalledWith(100, 0)
  })

  it('shapes rows into { username, totalLevel, combatLevel, isOneLife } and returns pagination meta', async () => {
    const { env } = mockDb([
      { id: 1, username: 'alice', total_level: 1500, combat_level: 110, is_one_life: 0 },
      { id: 2, username: 'bob', total_level: 900, combat_level: 70, is_one_life: 1 },
    ])

    const res = await onRequestGet({ request: reqWith('?limit=50&offset=10'), env } as any)
    const body = await res.json() as any

    expect(body.characters).toEqual([
      { username: 'alice', totalLevel: 1500, combatLevel: 110, isOneLife: false, isIronman: false },
      { username: 'bob', totalLevel: 900, combatLevel: 70, isOneLife: true, isIronman: false },
    ])
    expect(body.pagination).toEqual({ limit: 50, offset: 10, count: 2 })
  })

  it('scopes the ironman board to is_ironman accounts, ordered by total level', async () => {
    const { env, prepare, bind } = mockDb([
      { id: 1, username: 'ironbob', total_level: 1200, combat_level: 100, is_one_life: 0, is_ironman: 1 },
    ])
    const res = await onRequestGet({ request: reqWith('?metric=ironman'), env } as any)
    const body = await res.json() as any

    const sql = prepare.mock.calls[0][0] as string
    expect(sql).toContain('FROM characters')
    expect(sql).toContain('is_ironman = 1')
    expect(sql).toMatch(/ORDER BY\s+total_level\s+DESC/i)
    expect(bind).toHaveBeenCalledWith(100, 0)
    expect(body.metric).toBe('ironman')
    expect(body.characters).toEqual([
      { username: 'ironbob', totalLevel: 1200, combatLevel: 100, isOneLife: false, isIronman: true },
    ])
  })

  it('does NOT scope the default total board to Ironman accounts', async () => {
    const { env, prepare } = mockDb([])
    await onRequestGet({ request: reqWith(), env } as any)
    const sql = prepare.mock.calls[0][0] as string
    // is_ironman is selected for the name marker, but never used as a WHERE filter.
    expect(sql).not.toContain('is_ironman = 1')
  })

  it('returns 500 + empty list on DB error rather than crashing', async () => {
    const all = vi.fn().mockRejectedValue(new Error('boom'))
    const env = { DB: { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ all })) })) } } as any
    const res = await onRequestGet({ request: reqWith(), env } as any)
    expect(res.status).toBe(500)
    const body = await res.json() as any
    expect(body.characters).toEqual([])
  })
})

describe('GET /api/leaderboard (kill-count filters)', () => {
  it('queries kill_counts JOIN characters and shapes KC rows', async () => {
    const { env, prepare, bind } = mockDb([
      { username: 'alice', kill_count: 42, combat_level: 110, is_one_life: 0 },
      { username: 'bob', kill_count: 17, combat_level: 90, is_one_life: 1 },
    ])
    const res = await onRequestGet({
      request: reqWith('?metric=kc&source_type=raids&source_id=vaults_of_xyren'),
      env,
    } as any)
    const body = await res.json() as any

    const sql = prepare.mock.calls[0][0] as string
    expect(sql).toContain('FROM kill_counts')
    expect(sql).toMatch(/JOIN\s+characters/i)
    expect(sql).toMatch(/ORDER BY\s+k\.kill_count\s+DESC/i)
    expect(bind).toHaveBeenCalledWith('raids', 'vaults_of_xyren', 100, 0)
    expect(body.metric).toBe('kc')
    expect(body.characters).toEqual([
      { username: 'alice', killCount: 42, combatLevel: 110, isOneLife: false, isIronman: false },
      { username: 'bob', killCount: 17, combatLevel: 90, isOneLife: true, isIronman: false },
    ])
  })

  it('accepts a valid boss source', async () => {
    const { env, bind } = mockDb([])
    await onRequestGet({
      request: reqWith('?metric=kc&source_type=monsters&source_id=deepmaw_kraken'),
      env,
    } as any)
    expect(bind).toHaveBeenCalledWith('monsters', 'deepmaw_kraken', 100, 0)
  })

  it('rejects an unknown KC source with 400 and never queries D1', async () => {
    const { env, prepare } = mockDb([])
    const res = await onRequestGet({
      request: reqWith('?metric=kc&source_type=monsters&source_id=not_a_boss'),
      env,
    } as any)
    expect(res.status).toBe(400)
    expect(prepare).not.toHaveBeenCalled()
  })

  it('rejects a legacy raid alias (non-canonical key) with 400', async () => {
    const { env, prepare } = mockDb([])
    const res = await onRequestGet({
      request: reqWith('?metric=kc&source_type=raids&source_id=chambers_of_xeric'),
      env,
    } as any)
    expect(res.status).toBe(400)
    expect(prepare).not.toHaveBeenCalled()
  })
})

describe('GET /api/leaderboard (edge cache)', () => {
  it('cache miss → queries D1, sets Cache-Control, stores response', async () => {
    const { match, put } = stubCache()
    match.mockResolvedValue(undefined) // miss
    const { env, prepare } = mockDb([
      { id: 1, username: 'alice', total_level: 1500, combat_level: 110 },
    ])
    const waitUntil = vi.fn()

    const res = await onRequestGet({ request: reqWith(), env, waitUntil } as any)

    expect(prepare).toHaveBeenCalledTimes(1)
    expect(res.headers.get('Cache-Control')).toMatch(/s-maxage=60/)
    expect(put).toHaveBeenCalledTimes(1)
    expect(waitUntil).toHaveBeenCalledTimes(1)

    const cachedKey = put.mock.calls[0][0] as Request
    expect(new URL(cachedKey.url).searchParams.get('limit')).toBe('100')
    expect(new URL(cachedKey.url).searchParams.get('offset')).toBe('0')
  })

  it('cache hit → returns cached response without touching D1', async () => {
    const { match, put } = stubCache()
    const cached = new Response('{"cached":true}', { status: 200 })
    match.mockResolvedValue(cached)
    const { env, prepare } = mockDb([])

    const res = await onRequestGet({ request: reqWith(), env } as any)

    expect(res).toBe(cached)
    expect(prepare).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
  })

  it('different (limit, offset) pages get different cache keys', async () => {
    const { match, put } = stubCache()
    match.mockResolvedValue(undefined)
    const { env } = mockDb([])

    await onRequestGet({ request: reqWith('?limit=50&offset=0'), env } as any)
    await onRequestGet({ request: reqWith('?limit=50&offset=50'), env } as any)

    const k1 = put.mock.calls[0][0] as Request
    const k2 = put.mock.calls[1][0] as Request
    expect(k1.url).not.toBe(k2.url)
    expect(new URL(k1.url).searchParams.get('offset')).toBe('0')
    expect(new URL(k2.url).searchParams.get('offset')).toBe('50')
  })

  it('strips arbitrary query params from the cache key', async () => {
    const { match, put } = stubCache()
    match.mockResolvedValue(undefined)
    const { env } = mockDb([])

    await onRequestGet({ request: reqWith('?limit=100&offset=0&cb=12345'), env } as any)
    await onRequestGet({ request: reqWith('?limit=100&offset=0&cb=99999'), env } as any)

    const k1 = put.mock.calls[0][0] as Request
    const k2 = put.mock.calls[1][0] as Request
    expect(k1.url).toBe(k2.url) // same canonical key
    expect(k1.url).not.toContain('cb=')
  })

  it('total and KC filters get different cache keys', async () => {
    const { match, put } = stubCache()
    match.mockResolvedValue(undefined)
    const { env } = mockDb([])

    await onRequestGet({ request: reqWith(), env } as any)
    await onRequestGet({ request: reqWith('?metric=kc&source_type=raids&source_id=vaults_of_xyren'), env } as any)

    const k1 = put.mock.calls[0][0] as Request
    const k2 = put.mock.calls[1][0] as Request
    expect(k1.url).not.toBe(k2.url)
    expect(new URL(k1.url).searchParams.get('metric')).toBe('total')
    expect(new URL(k2.url).searchParams.get('metric')).toBe('kc')
  })

  it('falls through to D1 if globalThis.caches is unavailable', async () => {
    // No stub — globalThis.caches is undefined in vitest's node env.
    const { env, prepare } = mockDb([])
    const res = await onRequestGet({ request: reqWith(), env } as any)
    expect(res.status).toBe(200)
    expect(prepare).toHaveBeenCalledTimes(1)
  })
})
