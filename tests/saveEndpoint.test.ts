// /api/save write-reduction guards (Phase 6.2):
//   1. a no-op PUT (payload unchanged modulo the volatile client `timestamp`)
//      performs zero writes and returns the current revision;
//   2. the denormalized characters summary UPDATE is only batched when
//      total_level / combat_level actually changed;
//   3. the stale-write and total-level-regression guards stay intact.

import { describe, it, expect, vi } from 'vitest'

vi.mock('../functions/_lib/auth.js', () => ({
  requireAuth: async () => ({ identity: { id: 1 } }),
  json: (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))

vi.mock('../functions/_lib/pvp.js', () => ({
  assertNotInActiveMatch: async () => null,
  sweepStaleRows: async () => {},
}))

import { onRequestPut } from '../functions/api/save.js'

// Minimal save bodies. stats → totalLevel 1 (one skill at level 1), CB 3.
const baseSave = (extra: Record<string, unknown> = {}) => ({
  version: 1,
  timestamp: 1111,
  stats: { attack: { xp: 0 } },
  bank: { shrimps: { itemId: 'shrimps', quantity: 5 } },
  ...extra,
})

function makeEnv({ existingSaveData, character }: { existingSaveData: string | null, character?: any }) {
  const batches: any[][] = []
  const runs: { sql: string, args: any[] }[] = []
  const env = {
    DB: {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => ({
          sql,
          args,
          first: async () => {
            if (/FROM characters WHERE id/.test(sql)) {
              return character ?? { id: 42, total_level: 1, combat_level: 3 }
            }
            if (/SELECT save_data, save_blob, save_revision FROM saves/.test(sql)) {
              return existingSaveData === null
                ? null
                : { save_data: existingSaveData, save_blob: null, save_revision: 7 }
            }
            if (/SELECT save_revision FROM saves/.test(sql)) {
              return { save_revision: 8 }
            }
            return null
          },
          run: async () => { runs.push({ sql, args }) },
        }),
      }),
      batch: async (statements: any[]) => { batches.push(statements) },
    },
  }
  return { env, batches, runs }
}

function makePut(body: Record<string, unknown>) {
  return new Request('https://example.com/api/save', {
    method: 'PUT',
    headers: { 'X-Character-Id': '42', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PUT /api/save no-op detection', () => {
  it('skips the blob rewrite but touches updated_at when only the client timestamp changed', async () => {
    const stored = JSON.stringify(baseSave({ timestamp: 1111 }))
    const incoming = JSON.stringify(baseSave({ timestamp: 99999 }))
    const { env, batches, runs } = makeEnv({ existingSaveData: stored })

    const res = await onRequestPut({ request: makePut({ save_data: incoming, save_revision: 7 }), env } as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.noop).toBe(true)
    expect(body.save_revision).toBe(7) // unchanged — no blob rewrite / revision bump
    expect(batches).toHaveLength(0)
    // Freshness touch: a single cheap updated_at write so server-authoritative
    // staleness checks (PvP match-create) see the save as current. Without this
    // a post-match identical re-push leaves updated_at stale and trips stale_save.
    const touch = runs.find(r => /UPDATE saves SET updated_at/.test(r.sql))
    expect(touch).toBeTruthy()
    expect(touch?.sql).not.toMatch(/save_blob/)
  })

  it('writes when the payload content actually changed', async () => {
    const stored = JSON.stringify(baseSave())
    const incoming = JSON.stringify(baseSave({
      bank: { shrimps: { itemId: 'shrimps', quantity: 6 } },
      timestamp: 99999,
    }))
    const { env, batches } = makeEnv({ existingSaveData: stored })

    const res = await onRequestPut({ request: makePut({ save_data: incoming, save_revision: 7 }), env } as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.noop).toBeUndefined()
    expect(body.save_revision).toBe(8)
    expect(batches).toHaveLength(1)
  })
})

describe('PUT /api/save summary update skipping', () => {
  it('omits the characters UPDATE when total/combat level are unchanged', async () => {
    const stored = JSON.stringify(baseSave())
    const incoming = JSON.stringify(baseSave({
      bank: { shrimps: { itemId: 'shrimps', quantity: 6 } },
    }))
    // Stored summary matches the incoming save: totalLevel 1, combatLevel 3.
    const { env, batches } = makeEnv({
      existingSaveData: stored,
      character: { id: 42, total_level: 1, combat_level: 3 },
    })

    await onRequestPut({ request: makePut({ save_data: incoming, save_revision: 7 }), env } as any)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(1) // saves upsert only
    expect(batches[0][0].sql).toMatch(/INSERT INTO saves/)
  })

  it('includes the characters UPDATE when the summary changed', async () => {
    const stored = JSON.stringify(baseSave())
    const incoming = JSON.stringify(baseSave({
      stats: { attack: { xp: 0 }, strength: { xp: 50000 } },
    }))
    const { env, batches } = makeEnv({
      existingSaveData: stored,
      character: { id: 42, total_level: 1, combat_level: 3 },
    })

    await onRequestPut({ request: makePut({ save_data: incoming, save_revision: 7 }), env } as any)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(2)
    expect(batches[0][1].sql).toMatch(/UPDATE characters/)
  })
})

describe('PUT /api/save existing guards stay intact', () => {
  it('rejects a stale save_revision', async () => {
    const stored = JSON.stringify(baseSave())
    const { env, batches } = makeEnv({ existingSaveData: stored })
    const res = await onRequestPut({ request: makePut({ save_data: stored, save_revision: 3 }), env } as any)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('SAVE_REVISION_CONFLICT')
    expect(batches).toHaveLength(0)
  })

  it('rejects a total-level regression', async () => {
    const stored = JSON.stringify(baseSave({
      stats: { attack: { xp: 50000 }, strength: { xp: 50000 } },
    }))
    const incoming = JSON.stringify(baseSave())
    const { env, batches } = makeEnv({ existingSaveData: stored })
    const res = await onRequestPut({ request: makePut({ save_data: incoming, save_revision: 7 }), env } as any)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('TOTAL_LEVEL_REGRESSION')
    expect(batches).toHaveLength(0)
  })
})
