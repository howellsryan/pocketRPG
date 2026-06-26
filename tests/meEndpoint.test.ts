// /api/auth/me must return the authoritative account-type flags for the
// selected character. The client mirrors these into its one-life / ironman
// gates at boot (incl. the One-Life death wipe), so a returning session that
// skips the character picker can't drift out of sync with the server row.

import { describe, it, expect, vi } from 'vitest'

vi.mock('../functions/_lib/auth.js', () => ({
  requireAuth: async () => ({ identity: { id: 1 } }),
  json: (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))

import { onRequestGet } from '../functions/api/auth/me.js'

function makeEnv(charRow: any) {
  return {
    DB: {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => {
            if (/FROM oauth_identities/.test(sql)) return { remove_ads: 0 }
            if (/FROM characters/.test(sql)) return charRow
            return null
          },
        }),
      }),
    },
  } as any
}

function makeRequest(charId: number | null) {
  const headers = new Headers()
  if (charId != null) headers.set('X-Character-Id', String(charId))
  return new Request('https://x/api/auth/me', { headers })
}

describe('GET /api/auth/me — account-type flags', () => {
  it('returns is_ironman / is_one_life as booleans from the character row', async () => {
    const env = makeEnv({ id: 164, credits: 5, is_ironman: 1, is_one_life: 1, total_pvp_kills: 0, last_updated_total_pvp_kills: null })
    const res = await onRequestGet({ request: makeRequest(164), env } as any)
    const body = await res.json()
    expect(body.character).toMatchObject({ id: 164, is_ironman: true, is_one_life: true })
  })

  it('reports a normal character as is_ironman:false / is_one_life:false', async () => {
    const env = makeEnv({ id: 3, credits: 0, is_ironman: 0, is_one_life: 0, total_pvp_kills: 0, last_updated_total_pvp_kills: null })
    const res = await onRequestGet({ request: makeRequest(3), env } as any)
    const body = await res.json()
    expect(body.character).toMatchObject({ id: 3, is_ironman: false, is_one_life: false })
  })

  it('returns character:null when no character is selected', async () => {
    const env = makeEnv(null)
    const res = await onRequestGet({ request: makeRequest(null), env } as any)
    const body = await res.json()
    expect(body.character).toBeNull()
  })
})
