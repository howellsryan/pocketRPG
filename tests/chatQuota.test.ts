import { describe, expect, it } from 'vitest'
import {
  CHAT_DAILY_LIMIT,
  CHAT_MESSAGE_RESERVE_MILLI,
  CHAT_NEURON_BUDGET_MILLI,
  MILLI_NEURONS_PER_INPUT_TOKEN,
  MILLI_NEURONS_PER_OUTPUT_TOKEN,
  claimCharacterMessage,
  refundCharacterMessage,
  reserveMessageNeurons,
  settleMessageNeurons,
  usageMilliNeurons,
} from '../functions/_lib/chat/quota.js'
import {
  CHAT_MAX_ANSWER_TOKENS,
  CHAT_MAX_HISTORY_CHARS,
  CHAT_MAX_HISTORY_MESSAGES,
  CHAT_MAX_QUESTION_CHARS,
  CHAT_MAX_TOOL_RESULT_CHARS,
  CHAT_MAX_TOOL_ROUNDS,
  SYSTEM_PROMPT,
  chatToolDefs,
} from '../functions/_lib/chat/prompt.js'
import { KNOWLEDGE_CHUNKS } from '../functions/_lib/chat/knowledge.js'

// Minimal in-memory D1 stand-in implementing exactly the statement shapes
// quota.js uses.
function fakeDb() {
  const perChar = new Map<string, number>()
  const neurons = new Map<string, number>()
  return {
    perChar,
    neurons,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              if (sql.includes('chat_neuron_usage')) {
                if (sql.startsWith('UPDATE')) {
                  const [delta, dayKey] = [Number(args[0]), String(args[1])]
                  neurons.set(dayKey, Math.max(0, (neurons.get(dayKey) ?? 0) + delta))
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
              if (sql.startsWith('UPDATE')) {
                // refundCharacterMessage binds (characterId, dayKey)
                perChar.set(key, Math.max(0, (perChar.get(key) ?? 0) - 1))
                return { meta: { changes: 1 } }
              }
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

  it('refunding a message frees the slot again', async () => {
    const env = { DB: fakeDb() }
    await claimCharacterMessage(env, 7, '2026-07-01', 1)
    expect((await claimCharacterMessage(env, 7, '2026-07-01', 1)).allowed).toBe(false)
    await refundCharacterMessage(env, 7, '2026-07-01')
    expect((await claimCharacterMessage(env, 7, '2026-07-01', 1)).allowed).toBe(true)
  })

  it('neuron budget: reserves until the budget no longer fits, per day', async () => {
    const env = { DB: fakeDb() }
    expect(await reserveMessageNeurons(env, '2026-07-01', 400, 1000)).toBe(true)
    expect(await reserveMessageNeurons(env, '2026-07-01', 400, 1000)).toBe(true)
    expect(await reserveMessageNeurons(env, '2026-07-01', 400, 1000)).toBe(false)
    expect(await reserveMessageNeurons(env, '2026-07-02', 400, 1000)).toBe(true)
  })

  it('settling swaps the reserve for actual usage — refund and overage both land', async () => {
    const db = fakeDb()
    const env = { DB: db }
    await reserveMessageNeurons(env, '2026-07-01', 400, 1000)
    await settleMessageNeurons(env, '2026-07-01', 400, 100) // used 100 → refund 300
    expect(db.neurons.get('2026-07-01')).toBe(100)
    await reserveMessageNeurons(env, '2026-07-01', 400, 1000)
    await settleMessageNeurons(env, '2026-07-01', 400, 450) // overshot the reserve → charge 50
    expect(db.neurons.get('2026-07-01')).toBe(550)
  })

  it('converts reported token usage to milli-neurons, rounding up', () => {
    expect(usageMilliNeurons({ prompt_tokens: 1_000_000, completion_tokens: 0 })).toBe(5_460_000)
    expect(usageMilliNeurons({ prompt_tokens: 0, completion_tokens: 1_000_000 })).toBe(36_370_000)
    expect(usageMilliNeurons({ prompt_tokens: 1, completion_tokens: 1 })).toBe(42)
    expect(usageMilliNeurons(undefined)).toBe(0)
  })

  it('the per-message reserve covers a worst-case message derived from the CHAT_MAX_* limits', () => {
    // Conservative token estimate: 3 chars/token (JSON-heavy content runs
    // denser than prose's ~4).
    const CHARS_PER_TOKEN = 3
    const toolDefsChars = JSON.stringify(chatToolDefs()).length
    const biggestChunksChars = KNOWLEDGE_CHUNKS.map((c) => c.text.length + c.title.length + 16)
      .sort((a, b) => b - a)
      .slice(0, 6)
      .reduce((a, b) => a + b, 0)
    // Fixed input re-sent on every call: system prompt, history, question +
    // retrieved chunks, tool schemas, plus framing slack.
    const baseChars =
      SYSTEM_PROMPT.length +
      CHAT_MAX_HISTORY_MESSAGES * CHAT_MAX_HISTORY_CHARS +
      CHAT_MAX_QUESTION_CHARS +
      biggestChunksChars +
      toolDefsChars +
      1_000
    // Each tool round appends 3 clipped tool results and an assistant message
    // (content can approach the answer-token budget) to the transcript.
    const roundGrowthChars = 3 * CHAT_MAX_TOOL_RESULT_CHARS + CHAT_MAX_ANSWER_TOKENS * 4 + 1_000
    // Worst case is CHAT_MAX_TOOL_ROUNDS tool calls plus the final no-tools
    // call; round r's growth is re-sent by every later call.
    const calls = CHAT_MAX_TOOL_ROUNDS + 1
    const inputChars = calls * baseChars + ((calls * (calls - 1)) / 2) * roundGrowthChars
    const inputTokens = inputChars / CHARS_PER_TOKEN
    const outputTokens = calls * CHAT_MAX_ANSWER_TOKENS
    const worstMilli = Math.ceil(
      inputTokens * MILLI_NEURONS_PER_INPUT_TOKEN + outputTokens * MILLI_NEURONS_PER_OUTPUT_TOKEN,
    )
    expect(CHAT_MESSAGE_RESERVE_MILLI).toBeGreaterThanOrEqual(worstMilli)
  })

  it('budget invariants keep the chatbot inside the free allocation', () => {
    expect(CHAT_DAILY_LIMIT).toBe(30)
    // Budget + one in-flight worst-case reserve must stay within 10,000 free
    // neurons/day (10,000,000 milli-neurons).
    expect(CHAT_NEURON_BUDGET_MILLI + CHAT_MESSAGE_RESERVE_MILLI).toBeLessThanOrEqual(10_000_000)
    // Conversion rates must not undercount Cloudflare's published pricing:
    // ($ per M tokens) / ($0.011 per 1k neurons) = milli-neurons per token.
    expect(MILLI_NEURONS_PER_INPUT_TOKEN).toBeGreaterThanOrEqual(0.06 / 0.011)
    expect(MILLI_NEURONS_PER_OUTPUT_TOKEN).toBeGreaterThanOrEqual(0.4 / 0.011)
  })
})
