// POST /api/characters/reset-one-life must clear EVERY table that FK-references
// characters(id) before hard-deleting the character row. D1 enforces foreign
// keys, so a missing child delete makes the batch throw an uncaught Worker
// exception (HTTP 1101) — the 500 that left a dead one-life player un-wiped.

import { describe, it, expect, vi } from 'vitest'

vi.mock('../functions/_lib/auth.js', () => ({
  requireAuth: async () => ({ identity: { id: 1 } }),
  json: (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))

import { onRequestPost } from '../functions/api/characters/reset-one-life.js'

// Every table with a FOREIGN KEY to characters(id) (migrations 0001–0025).
const FK_TABLES = [
  'saves', 'character_idle_state', 'collection_log', 'kill_counts',
  'trading_post_offers', 'character_activity_progress', 'character_daily_tasks',
  'pvp_waiting_room', 'pvp_intents', 'pvp_invitations', 'pvp_matches',
]

function makeEnv({ character, batchThrows = false }: { character: any, batchThrows?: boolean }) {
  const batched: string[] = []
  const env = {
    DB: {
      prepare: (sql: string) => ({
        bind: (..._args: any[]) => ({
          sql,
          first: async () => {
            if (/SELECT id, username, is_ironman, is_one_life/.test(sql)) return character
            // recreated lookup after the batch
            if (/SELECT id, username, is_one_life FROM characters/.test(sql)) {
              return { id: 999, username: character?.username, is_one_life: character?.is_one_life }
            }
            return null
          },
        }),
      }),
      batch: async (stmts: any[]) => {
        for (const s of stmts) batched.push(s.sql)
        if (batchThrows) throw new Error('FOREIGN KEY constraint failed')
        return []
      },
    },
  } as any
  return { env, batched }
}

const req = () => new Request('https://x/api/characters/reset-one-life', {
  method: 'POST',
  headers: { 'X-Character-Id': '164' },
  body: '{}',
})

describe('POST /api/characters/reset-one-life', () => {
  it('deletes from every FK-referencing table before recreating the character', async () => {
    const { env, batched } = makeEnv({ character: { id: 164, username: 'Hardcore', is_ironman: 1, is_one_life: 1, credits: 5, credits_used: 0 } })
    const res = await onRequestPost({ request: req(), env } as any)
    expect(res.status).toBe(200)
    for (const table of FK_TABLES) {
      expect(batched.some(sql => new RegExp(`DELETE FROM ${table}\\b`).test(sql)), `missing DELETE FROM ${table}`).toBe(true)
    }
    // Child deletes must precede the character delete, which must precede insert.
    const charDelIdx = batched.findIndex(s => /DELETE FROM characters\b/.test(s))
    const insertIdx = batched.findIndex(s => /INSERT INTO characters\b/.test(s))
    const lastChildIdx = Math.max(...FK_TABLES.map(t => batched.findIndex(s => new RegExp(`DELETE FROM ${t}\\b`).test(s))))
    expect(lastChildIdx).toBeLessThan(charDelIdx)
    expect(charDelIdx).toBeLessThan(insertIdx)
  })

  it('returns 400 when the character is not one-life', async () => {
    const { env } = makeEnv({ character: { id: 3, username: 'RPG', is_ironman: 0, is_one_life: 0, credits: 0, credits_used: 0 } })
    const res = await onRequestPost({ request: req(), env } as any)
    expect(res.status).toBe(400)
  })

  it('returns a clean JSON 500 (not an uncaught throw) when the batch fails', async () => {
    const { env } = makeEnv({ character: { id: 164, username: 'Hardcore', is_ironman: 1, is_one_life: 1, credits: 5, credits_used: 0 }, batchThrows: true })
    const res = await onRequestPost({ request: req(), env } as any)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('reset_failed')
  })
})
