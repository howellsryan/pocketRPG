import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../functions/_lib/auth.js', () => ({
  requireAuth: async () => ({ identity: { id: 1 } }),
  json: (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))
vi.mock('../functions/_lib/pvp.js', () => ({ assertNotInActiveMatch: async () => null }))
vi.mock('../functions/_lib/game/audit.js', () => ({ auditLog: async () => {} }))

const { onRequestPost } = await import('../functions/api/unlocks/purchase.js')

// Minimal D1 stand-in: one character row holding `credits`, debited by the
// endpoint's single UPDATE … WHERE credits >= ? RETURNING statement.
function makeEnv(startingCredits: number) {
  const state = { credits: startingCredits, used: 0 }
  const env = {
    DB: {
      prepare(sql: string) {
        const stmt = {
          _args: [] as any[],
          bind(...args: any[]) { stmt._args = args; return stmt },
          async first() {
            if (sql.includes('SELECT id FROM characters')) return { id: 42 }
            const cost = stmt._args[0] as number
            if (state.credits < cost) return null
            state.credits -= cost
            state.used += cost
            return { credits_remaining: state.credits }
          },
        }
        return stmt
      },
    },
  }
  return { env, state }
}

async function purchase(env: any, unlockId: string) {
  const req = new Request('https://example.com/api/unlocks/purchase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
    body: JSON.stringify({ unlock_id: unlockId }),
  })
  const res = await onRequestPost({ request: req, env } as any)
  return { status: res.status, body: await res.json() as any }
}

describe('extra equipment tab unlock', () => {
  let env: any
  let state: { credits: number }
  beforeEach(() => { ({ env, state } = makeEnv(100)) })

  it('costs 10 credits, server-side — the client never names a price', async () => {
    const out = await purchase(env, 'extra_equipment_tab')
    expect(out.status).toBe(200)
    expect(out.body.unlock_id).toBe('extra_equipment_tab')
    expect(state.credits).toBe(90)
  })

  it('can be bought over and over — no ownership check blocks a repeat', async () => {
    for (let i = 1; i <= 10; i++) {
      const out = await purchase(env, 'extra_equipment_tab')
      expect(out.status).toBe(200)
      expect(out.body.credits_remaining).toBe(100 - i * 10)
    }
    expect(state.credits).toBe(0)
  })

  it('refuses once the credits run out', async () => {
    for (let i = 0; i < 10; i++) await purchase(env, 'extra_equipment_tab')
    const out = await purchase(env, 'extra_equipment_tab')
    expect(out.status).toBe(402)
    expect(out.body.code).toBe('INSUFFICIENT_CREDITS')
  })

  it('still rejects an unknown unlock id', async () => {
    const out = await purchase(env, 'free_everything')
    expect(out.status).toBe(400)
    expect(out.body.code).toBe('UNKNOWN_UNLOCK')
    expect(state.credits).toBe(100)
  })
})
