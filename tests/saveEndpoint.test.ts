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

// Mutable so a test can simulate the PvP inventory lock (active match → 409).
let pvpLockResponse: Response | null = null
vi.mock('../functions/_lib/pvp.js', () => ({
  assertNotInActiveMatch: async () => pvpLockResponse,
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
            if (/SELECT save_data, save_blob, save_revision.* FROM saves/.test(sql)) {
              return existingSaveData === null
                ? null
                : { save_data: existingSaveData, save_blob: null, save_revision: 7, updated_at: 555 }
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
  it('writes NOTHING (not even updated_at) when only the client timestamp changed', async () => {
    const stored = JSON.stringify(baseSave({ timestamp: 1111 }))
    const incoming = JSON.stringify(baseSave({ timestamp: 99999 }))
    const { env, batches, runs } = makeEnv({ existingSaveData: stored })

    const res = await onRequestPut({ request: makePut({ save_data: incoming, save_revision: 7 }), env } as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.noop).toBe(true)
    expect(body.save_revision).toBe(7) // unchanged — no blob rewrite / revision bump
    expect(body.updatedAt).toBe(555)   // hands back the stored timestamp, untouched
    expect(batches).toHaveLength(0)
    // A content-identical save costs ZERO blob writes — no blob, no revision
    // bump, no summary UPDATE, and no updated_at touch. The ONE write that still
    // fires is the folded idle heartbeat (last_active_at stamp). Without this a
    // long AFK foreground session would never refresh last_active_at and offline
    // rewards would inflate on next load.
    const idleStamps = runs.filter(r => /INSERT INTO character_idle_state/.test(r.sql))
    expect(idleStamps).toHaveLength(1)
    expect(runs.some(r => /UPDATE saves/.test(r.sql))).toBe(false)
    expect(runs).toHaveLength(1)
  })

  it('bumps updated_at on a no-op only when touch:true (PvP-lobby freshness)', async () => {
    const stored = JSON.stringify(baseSave({ timestamp: 1111 }))
    const incoming = JSON.stringify(baseSave({ timestamp: 99999 }))
    const { env, batches, runs } = makeEnv({ existingSaveData: stored })

    const res = await onRequestPut({ request: makePut({ save_data: incoming, save_revision: 7, touch: true }), env } as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.noop).toBe(true)
    expect(batches).toHaveLength(0)
    // One cheap indexed-column write so the PvP match-create guard sees the save
    // as current; never the 130 KB blob.
    const touch = runs.find(r => /UPDATE saves SET updated_at/.test(r.sql))
    expect(touch).toBeTruthy()
    expect(touch?.sql).not.toMatch(/save_blob/)
  })

  it('treats a save that only churned the activeTask countdown as a no-op', async () => {
    const stored = JSON.stringify(baseSave({
      settings: { activeTask: { type: 'skill', skill: 'mining', action: { id: 'iron_ore' }, ticksRemaining: 5, pendingTicks: 0, session: { actions: 2, xp: 70 } } },
    }))
    // Same real state; only the per-tick countdown/session advanced.
    const incoming = JSON.stringify(baseSave({
      timestamp: 99999,
      settings: { activeTask: { type: 'skill', skill: 'mining', action: { id: 'iron_ore' }, ticksRemaining: 3, pendingTicks: 2, session: { actions: 2, xp: 70 } } },
    }))
    const { env, batches, runs } = makeEnv({ existingSaveData: stored })

    const res = await onRequestPut({ request: makePut({ save_data: incoming, save_revision: 7 }), env } as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.noop).toBe(true)
    expect(batches).toHaveLength(0)
    // Only the folded idle stamp runs; the blob write is still skipped. The
    // stamped active_task mirrors the (volatile-stripped) running task.
    expect(runs).toHaveLength(1)
    expect(runs[0].sql).toMatch(/INSERT INTO character_idle_state/)
    const stampedTask = JSON.parse(runs[0].args[2])
    expect(stampedTask.skill).toBe('mining')
  })

  it('still writes when a running task makes real progress', async () => {
    const stored = JSON.stringify(baseSave({
      stats: { attack: { xp: 0 }, mining: { xp: 50 } },
      settings: { activeTask: { type: 'skill', skill: 'mining', action: { id: 'iron_ore' }, ticksRemaining: 5 } },
    }))
    const incoming = JSON.stringify(baseSave({
      timestamp: 99999,
      stats: { attack: { xp: 0 }, mining: { xp: 90 } }, // real XP gain
      settings: { activeTask: { type: 'skill', skill: 'mining', action: { id: 'iron_ore' }, ticksRemaining: 3 } },
    }))
    const { env, batches } = makeEnv({ existingSaveData: stored })

    const res = await onRequestPut({ request: makePut({ save_data: incoming, save_revision: 7 }), env } as any)
    const body = await res.json()
    expect(body.noop).toBeUndefined()
    expect(batches).toHaveLength(1)
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
    // saves upsert + folded idle stamp; no characters UPDATE (summary unchanged).
    expect(batches[0]).toHaveLength(2)
    expect(batches[0][0].sql).toMatch(/INSERT INTO saves/)
    expect(batches[0][1].sql).toMatch(/INSERT INTO character_idle_state/)
    expect(batches[0].some((s: any) => /UPDATE characters/.test(s.sql))).toBe(false)
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
    // saves upsert + folded idle stamp + characters UPDATE (summary changed).
    expect(batches[0]).toHaveLength(3)
    expect(batches[0].some((s: any) => /UPDATE characters/.test(s.sql))).toBe(true)
    expect(batches[0].some((s: any) => /INSERT INTO character_idle_state/.test(s.sql))).toBe(true)
  })
})

describe('PUT /api/save folds the idle heartbeat', () => {
  it('stamps character_idle_state with last_active_at + active_task on a normal write', async () => {
    const stored = JSON.stringify(baseSave())
    const incoming = JSON.stringify(baseSave({
      bank: { shrimps: { itemId: 'shrimps', quantity: 6 } },
      settings: { activeTask: { type: 'skill', skill: 'fishing', action: { id: 'shrimps' }, ticksRemaining: 4 } },
    }))
    const { env, batches } = makeEnv({ existingSaveData: stored })

    const res = await onRequestPut({ request: makePut({ save_data: incoming, save_revision: 7 }), env } as any)
    expect(res.status).toBe(200)
    const stamp = batches[0].find((s: any) => /INSERT INTO character_idle_state/.test(s.sql))
    expect(stamp).toBeTruthy()
    // args: [character_id, last_active_at, active_task, updated_at]
    expect(stamp.args[0]).toBe(42)
    expect(typeof stamp.args[1]).toBe('number')
    expect(JSON.parse(stamp.args[2]).skill).toBe('fishing')
  })

  it('stamps a null active_task when the save has no running task', async () => {
    const stored = JSON.stringify(baseSave())
    const incoming = JSON.stringify(baseSave({ bank: { shrimps: { itemId: 'shrimps', quantity: 6 } } }))
    const { env, batches } = makeEnv({ existingSaveData: stored })

    await onRequestPut({ request: makePut({ save_data: incoming, save_revision: 7 }), env } as any)
    const stamp = batches[0].find((s: any) => /INSERT INTO character_idle_state/.test(s.sql))
    expect(stamp.args[2]).toBeNull()
  })

  it('performs NO idle write when the PvP inventory lock returns (active match)', async () => {
    const stored = JSON.stringify(baseSave())
    const incoming = JSON.stringify(baseSave({ bank: { shrimps: { itemId: 'shrimps', quantity: 6 } } }))
    const { env, batches, runs } = makeEnv({ existingSaveData: stored })
    pvpLockResponse = new Response(JSON.stringify({ error: 'in_active_match' }), { status: 409 })
    try {
      const res = await onRequestPut({ request: makePut({ save_data: incoming, save_revision: 7 }), env } as any)
      expect(res.status).toBe(409)
      // Guard returns before parsing/derivation — neither the blob nor the idle
      // stamp may write.
      expect(batches).toHaveLength(0)
      expect(runs.some(r => /character_idle_state/.test(r.sql))).toBe(false)
    } finally {
      pvpLockResponse = null
    }
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
