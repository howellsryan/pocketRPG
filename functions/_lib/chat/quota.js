// Chatbot quotas (migration 0027). Two layers bound chatbot cost:
//   1. Per-character daily message cap — hard refusal once exhausted, with a
//      paid refill (CHAT_REFILL_CREDITS) to top it back up before the reset.
//   2. Per-provider global daily spend budgets (reserve-then-settle): OpenAI
//      (primary) and Gemini (paid last resort) each meter their own token pool;
//      the free Workers AI failover meters the neuron budget. Each metered
//      message atomically reserves its worst-case cost up front and refunds the
//      unused part once the API reports actual usage, so the day's spend can
//      never cross a budget mid-flight; when a pool runs out, /api/chat skips
//      that pool (the next fallback, then retrieval-only, still answer).

// One character's daily helper-message allowance, and the credit price to refill
// it to full before the 00:00 UTC reset.
export const CHAT_DAILY_LIMIT = 30
export const CHAT_REFILL_CREDITS = 10

// Token prices converted to milli-neurons per token at $0.011 per 1,000
// neurons. Rated at $0.10/M input, $0.40/M output — an upper bound for both
// gemini-2.5-flash-lite ($0.10/$0.40) and the GLM fallback ($0.06/$0.40).
// Revisit when CHAT_MODEL / CHAT_FALLBACK_MODEL change.
export const MILLI_NEURONS_PER_INPUT_TOKEN = 9.1
export const MILLI_NEURONS_PER_OUTPUT_TOKEN = 36.37

// Budget for the FREE Workers AI failover. Workers AI bills neurons past the
// 10,000 free daily neurons, so budget + one in-flight worst-case reserve must
// stay ≤ 10,000,000 milli; the gap also absorbs estimation drift and any other
// Workers AI use on the account.
export const CHAT_NEURON_BUDGET_MILLI = 6_600_000
// Worst-case message: CHAT_MAX_TOOL_ROUNDS + 1 model calls with every context
// and output limit maxed, including the FULL MCP tool schema the model is
// offered (reads + gated writes). tests/chatQuota.test.ts derives this bound
// from the CHAT_MAX_* constants + chatToolDefs() — raise it there first if a
// limit grows or the tool surface expands. Reserve and budget trade off
// against each other under a fixed ceiling, and the reserve is held only for
// the duration of one in-flight call: with daily usage sitting far below the
// allocation, per-message capacity is worth more than day-wide headroom.
export const CHAT_MESSAGE_RESERVE_MILLI = 3_300_000

// Daily token pool for the OpenAI primary against the ~2.5M/day complimentary
// data-sharing allotment. Metered locally because OpenAI doesn't hard-stop at
// the free allotment — overage bills at normal rates. Budget + one in-flight
// reserve stays under 2.5M. Rows live in chat_neuron_usage under an 'openai:'-
// prefixed day_key; the reserve/settle statements are unit-agnostic.
// The OpenAI reserve is much larger than the others because its worst case
// funds CHAT_OPENAI_MAX_OUTPUT_TOKENS of reasoning on every call, not just the
// shared visible-answer cap.
export const CHAT_OPENAI_TOKEN_BUDGET = 1_900_000
export const CHAT_OPENAI_MESSAGE_RESERVE_TOKENS = 570_000

// Daily token pool for the PAID Gemini last resort. No free tier, so this is a
// pure $ cap chosen for a rarely-reached fallback: at $0.10/$0.40 per M tokens
// this bounds Gemini spend to roughly $0.25/day. Own day_key so it never mixes
// with the free Workers AI neuron budget.
export const CHAT_GEMINI_TOKEN_BUDGET = 2_000_000
export const CHAT_GEMINI_MESSAGE_RESERVE_TOKENS = 290_000

export function openaiPoolKey(dayKey) {
  return `openai:${dayKey}`
}

export function geminiPoolKey(dayKey) {
  return `gemini:${dayKey}`
}

// Atomically claim one message from the character's daily allowance.
// Returns { allowed, remaining }.
export async function claimCharacterMessage(env, characterId, dayKey, limit = CHAT_DAILY_LIMIT) {
  const res = await env.DB.prepare(
    `INSERT INTO chat_usage (character_id, day_key, count) VALUES (?, ?, 1)
     ON CONFLICT(character_id, day_key) DO UPDATE SET count = count + 1
     WHERE chat_usage.count < ?`,
  )
    .bind(characterId, dayKey, limit)
    .run()
  const allowed = (res?.meta?.changes ?? 0) > 0
  if (!allowed) return { allowed: false, remaining: 0 }
  const row = await env.DB.prepare('SELECT count FROM chat_usage WHERE character_id = ? AND day_key = ?')
    .bind(characterId, dayKey)
    .first()
  return { allowed: true, remaining: Math.max(0, limit - (row?.count ?? limit)) }
}

// Give back a character's daily message when the answer degraded to
// retrieval-only — the player didn't get an AI answer, so it shouldn't count.
export async function refundCharacterMessage(env, characterId, dayKey) {
  try {
    await env.DB.prepare('UPDATE chat_usage SET count = MAX(0, count - 1) WHERE character_id = ? AND day_key = ?')
      .bind(characterId, dayKey)
      .run()
  } catch (err) {
    console.error('[PocketRPG][chat] message refund failed:', err?.message || err)
  }
}

// Reset today's message count to 0 (a paid refill), restoring the full daily
// allowance. Upsert so a character with no row yet also lands at 0.
export async function resetCharacterMessages(env, characterId, dayKey) {
  await env.DB.prepare(
    `INSERT INTO chat_usage (character_id, day_key, count) VALUES (?, ?, 0)
     ON CONFLICT(character_id, day_key) DO UPDATE SET count = 0`,
  )
    .bind(characterId, dayKey)
    .run()
}

// Estimated milli-neurons for one model call from its reported usage.
export function usageMilliNeurons(usage) {
  const inTok = usage?.prompt_tokens ?? 0
  const outTok = usage?.completion_tokens ?? 0
  return Math.ceil(inTok * MILLI_NEURONS_PER_INPUT_TOKEN + outTok * MILLI_NEURONS_PER_OUTPUT_TOKEN)
}

// Atomically reserve a message's worst-case neuron cost against today's
// budget. Returns false when it no longer fits (caller falls back to
// retrieval-only). Reserving up front is what makes the cap hard: concurrent
// messages can never jointly overshoot the budget.
export async function reserveMessageNeurons(
  env,
  dayKey,
  reserve = CHAT_MESSAGE_RESERVE_MILLI,
  budget = CHAT_NEURON_BUDGET_MILLI,
) {
  const res = await env.DB.prepare(
    `INSERT INTO chat_neuron_usage (day_key, milli_neurons) VALUES (?, ?)
     ON CONFLICT(day_key) DO UPDATE SET milli_neurons = milli_neurons + ?
     WHERE chat_neuron_usage.milli_neurons + ? <= ?`,
  )
    .bind(dayKey, reserve, reserve, reserve, budget)
    .run()
  return (res?.meta?.changes ?? 0) > 0
}

// Replace a message's reserve with its actual usage once known: refunds the
// unused part, or charges the overage if usage somehow exceeded the reserve
// (belt-and-braces — the reserve is meant to be a true upper bound). A failed
// refund only makes the cap more conservative.
export async function settleMessageNeurons(env, dayKey, reserveMilli, actualMilli) {
  const delta = Math.ceil(actualMilli) - reserveMilli
  if (delta === 0) return
  try {
    await env.DB.prepare('UPDATE chat_neuron_usage SET milli_neurons = MAX(0, milli_neurons + ?) WHERE day_key = ?')
      .bind(delta, dayKey)
      .run()
  } catch (err) {
    console.error('[PocketRPG][chat] neuron settle failed:', err?.message || err)
  }
}
