import { describe, expect, it } from 'vitest'
import {
  CHAT_DAILY_LIMIT,
  CHAT_MESSAGE_RESERVE_MILLI,
  CHAT_NEURON_BUDGET_MILLI,
  MILLI_NEURONS_PER_INPUT_TOKEN,
  MILLI_NEURONS_PER_OUTPUT_TOKEN,
  claimCharacterMessage,
  reserveMessageNeurons,
  settleMessageNeurons,
  usageMilliNeurons,
} from '../functions/_lib/chat/quota.js'

// Minimal in-memory D1 stand-in implementing exactly the statement shapes
// quota.js uses.
function fakeDb() {
  const perChar = new Map<string, number>()
  const neurons = new Map<string, number>()
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              if (sql.includes('chat_neuron_usage')) {
                if (sql.startsWith('UPDATE')) {
                  const [refund, dayKey] = [Number(args[0]), String(args[1])]
                  neurons.set(dayKey, Math.max(0, (neurons.get(dayKey) ?? 0) - refund))
                  return { meta: { changes: 1 } }
                }
                const [dayKey, reserve, , , budget] = [String(args[0]), Number(args[1]), 0, 0, Number(args[4])]
                const current = neurons.get(dayKey)
                if (current === undefined) {
                  neurons.set(dayKey, reserve)
                  return { meta: { changes: 1 } }
                }
                if (current + reserve <= budget) {
                  neurons.set(dayKey, current + reserve)
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

  it('neuron budget: reserves until the budget no longer fits, per day', async () => {
    const env = { DB: fakeDb() }
    expect(await reserveMessageNeurons(env, '2026-07-01', 400, 1000)).toBe(true)
    expect(await reserveMessageNeurons(env, '2026-07-01', 400, 1000)).toBe(true)
    expect(await reserveMessageNeurons(env, '2026-07-01', 400, 1000)).toBe(false)
    expect(await reserveMessageNeurons(env, '2026-07-02', 400, 1000)).toBe(true)
  })

  it('settling refunds unused reserve so later messages fit', async () => {
    const env = { DB: fakeDb() }
    await reserveMessageNeurons(env, '2026-07-01', 400, 1000)
    await reserveMessageNeurons(env, '2026-07-01', 400, 1000)
    await settleMessageNeurons(env, '2026-07-01', 300) // message actually used 100
    expect(await reserveMessageNeurons(env, '2026-07-01', 400, 1000)).toBe(true)
    expect(await reserveMessageNeurons(env, '2026-07-01', 400, 1000)).toBe(false)
  })

  it('converts reported token usage to milli-neurons, rounding up', () => {
    expect(usageMilliNeurons({ prompt_tokens: 1_000_000, completion_tokens: 0 })).toBe(5_460_000)
    expect(usageMilliNeurons({ prompt_tokens: 0, completion_tokens: 1_000_000 })).toBe(36_370_000)
    expect(usageMilliNeurons({ prompt_tokens: 1, completion_tokens: 1 })).toBe(42)
    expect(usageMilliNeurons(undefined)).toBe(0)
  })

  it('budget invariants keep the chatbot inside the free allocation', () => {
    expect(CHAT_DAILY_LIMIT).toBe(30)
    // Budget + one in-flight worst-case reserve must stay under 10,000 free
    // neurons/day (10,000,000 milli-neurons).
    expect(CHAT_NEURON_BUDGET_MILLI).toBeLessThanOrEqual(10_000_000)
    expect(CHAT_MESSAGE_RESERVE_MILLI).toBeLessThan(CHAT_NEURON_BUDGET_MILLI)
    // Conversion rates must not undercount Cloudflare's published pricing:
    // ($ per M tokens) / ($0.011 per 1k neurons) = milli-neurons per token.
    expect(MILLI_NEURONS_PER_INPUT_TOKEN).toBeGreaterThanOrEqual(0.06 / 0.011)
    expect(MILLI_NEURONS_PER_OUTPUT_TOKEN).toBeGreaterThanOrEqual(0.4 / 0.011)
  })
})
