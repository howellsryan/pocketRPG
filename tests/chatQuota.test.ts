import { describe, expect, it } from 'vitest'
import {
  CHAT_DAILY_LIMIT,
  claimCharacterMessage,
  claimGlobalAiCall,
} from '../functions/_lib/chat/quota.js'

// Minimal in-memory D1 stand-in implementing exactly the two upsert shapes and
// the count SELECT that quota.js uses.
function fakeDb() {
  const perChar = new Map<string, number>()
  const global = new Map<string, number>()
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              if (sql.includes('chat_global_usage')) {
                const [dayKey, limit] = [String(args[0]), Number(args[1])]
                const current = global.get(dayKey)
                if (current === undefined) {
                  global.set(dayKey, 1)
                  return { meta: { changes: 1 } }
                }
                if (current < limit) {
                  global.set(dayKey, current + 1)
                  return { meta: { changes: 1 } }
                }
                return { meta: { changes: 0 } }
              }
              const key = `${args[0]}:${args[1]}`
              const limit = Number(args[2])
              const current = perChar.get(key)
              if (current === undefined) {
                perChar.set(key, 1)
                return { meta: { changes: 1 } }
              }
              if (current < limit) {
                perChar.set(key, current + 1)
                return { meta: { changes: 1 } }
              }
              return { meta: { changes: 0 } }
            },
            async first() {
              return { count: perChar.get(`${args[0]}:${args[1]}`) ?? 0 }
            },
          }
        },
      }
    },
  }
}

describe('chat quotas', () => {
  it('allows up to the per-character daily limit, then refuses', async () => {
    const env = { DB: fakeDb() }
    for (let i = 1; i <= 3; i++) {
      const claim = await claimCharacterMessage(env, 7, '2026-07-01', 3)
      expect(claim.allowed).toBe(true)
      expect(claim.remaining).toBe(3 - i)
    }
    const refused = await claimCharacterMessage(env, 7, '2026-07-01', 3)
    expect(refused).toEqual({ allowed: false, remaining: 0 })
  })

  it('tracks characters and days independently', async () => {
    const env = { DB: fakeDb() }
    await claimCharacterMessage(env, 7, '2026-07-01', 1)
    expect((await claimCharacterMessage(env, 7, '2026-07-01', 1)).allowed).toBe(false)
    expect((await claimCharacterMessage(env, 8, '2026-07-01', 1)).allowed).toBe(true)
    expect((await claimCharacterMessage(env, 7, '2026-07-02', 1)).allowed).toBe(true)
  })

  it('global circuit-breaker trips at its limit', async () => {
    const env = { DB: fakeDb() }
    expect(await claimGlobalAiCall(env, '2026-07-01', 2)).toBe(true)
    expect(await claimGlobalAiCall(env, '2026-07-01', 2)).toBe(true)
    expect(await claimGlobalAiCall(env, '2026-07-01', 2)).toBe(false)
    expect(await claimGlobalAiCall(env, '2026-07-02', 2)).toBe(true)
  })

  it('default limit is 30 per day', () => {
    expect(CHAT_DAILY_LIMIT).toBe(30)
  })
})
