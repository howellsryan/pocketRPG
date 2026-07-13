// POST /api/characters/reset-one-life reverts a dead one-life character to its
// underlying account type (Ironman or normal) in place — it flips is_one_life
// off and touches nothing else, so the character, save and all progress
// survive the death (no delete/recreate, no FK-child cleanup needed).

import { describe, it, expect, vi } from 'vitest'

vi.mock('../functions/_lib/auth.js', () => ({
  requireAuth: async () => ({ identity: { id: 1 } }),
  json: (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))

import { onRequestPost } from '../functions/api/characters/reset-one-life.js'

function makeEnv({ character, updateThrows = false }: { character: any, updateThrows?: boolean }) {
  const executed: string[] = []
  const env = {
    DB: {
      prepare: (sql: string) => ({
        bind: (..._args: any[]) => ({
          sql,
          first: async () => (/SELECT id, username, is_ironman, is_one_life/.test(sql) ? character : null),
          run: async () => {
            executed.push(sql)
            if (updateThrows) throw new Error('D1 write failed')
            return {}
          },
        }),
      }),
    },
  } as any
  return { env, executed }
}

const req = () => new Request('https://x/api/characters/reset-one-life', {
  method: 'POST',
  headers: { 'X-Character-Id': '164' },
  body: '{}',
})

describe('POST /api/characters/reset-one-life', () => {
  it('reverts a one-life ironman to a plain ironman without touching any other row', async () => {
    const { env, executed } = makeEnv({ character: { id: 164, username: 'Hardcore', is_ironman: 1, is_one_life: 1 } })
    const res = await onRequestPost({ request: req(), env } as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, reverted: { id: 164, username: 'Hardcore', is_ironman: true, is_one_life: false } })
    expect(executed).toEqual(['UPDATE characters SET is_one_life = 0 WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'])
  })

  it('reverts a one-life normal character to a plain normal account', async () => {
    const { env } = makeEnv({ character: { id: 3, username: 'RPG', is_ironman: 0, is_one_life: 1 } })
    const res = await onRequestPost({ request: req(), env } as any)
    const body = await res.json()
    expect(body.reverted).toEqual({ id: 3, username: 'RPG', is_ironman: false, is_one_life: false })
  })

  it('returns 400 when the character is not one-life (idempotent retry signal)', async () => {
    const { env } = makeEnv({ character: { id: 3, username: 'RPG', is_ironman: 0, is_one_life: 0 } })
    const res = await onRequestPost({ request: req(), env } as any)
    expect(res.status).toBe(400)
  })

  it('returns 404 when the character does not exist / is not owned', async () => {
    const { env } = makeEnv({ character: null })
    const res = await onRequestPost({ request: req(), env } as any)
    expect(res.status).toBe(404)
  })

  it('returns a clean JSON 500 (not an uncaught throw) when the update fails', async () => {
    const { env } = makeEnv({ character: { id: 164, username: 'Hardcore', is_ironman: 1, is_one_life: 1 }, updateThrows: true })
    const res = await onRequestPost({ request: req(), env } as any)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('reset_failed')
  })
})
