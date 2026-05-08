import { describe, it, expect, vi } from 'vitest'
import { onRequestGet } from '../functions/api/leaderboard.js'

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
    expect(sql).toContain('total_level > 0')
    expect(sql).toContain('deleted_at IS NULL')
    expect(sql).toMatch(/ORDER BY\s+total_level\s+DESC/i)
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

  it('shapes rows into { username, totalLevel, combatLevel } and returns pagination meta', async () => {
    const { env } = mockDb([
      { id: 1, username: 'alice', total_level: 1500, combat_level: 110 },
      { id: 2, username: 'bob', total_level: 900, combat_level: 70 },
    ])

    const res = await onRequestGet({ request: reqWith('?limit=50&offset=10'), env } as any)
    const body = await res.json() as any

    expect(body.characters).toEqual([
      { username: 'alice', totalLevel: 1500, combatLevel: 110 },
      { username: 'bob', totalLevel: 900, combatLevel: 70 },
    ])
    expect(body.pagination).toEqual({ limit: 50, offset: 10, count: 2 })
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
