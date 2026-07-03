// Chatbot usage quotas (migration 0027). Two layers bound chatbot cost:
//   1. Per-character daily message cap — hard refusal once exhausted.
//   2. Global daily spend budget, denominated in Workers AI neurons
//      ($0.011/1k). Each message atomically reserves its worst possible cost
//      up front and refunds the unused part once the API reports actual token
//      usage, so the day's spend can never cross the budget mid-flight; when
//      the budget runs out, /api/chat degrades to retrieval-only.

export const CHAT_DAILY_LIMIT = 30

// Token prices converted to milli-neurons per token at $0.011 per 1,000
// neurons. Rated at $0.06/M input, $0.40/M output — an upper bound for
// gpt-5-nano ($0.05/$0.40), so the budget doubles as a daily $ spend cap.
// Revisit when CHAT_MODEL changes.
export const MILLI_NEURONS_PER_INPUT_TOKEN = 5.46
export const MILLI_NEURONS_PER_OUTPUT_TOKEN = 36.37

// Budget + one in-flight worst-case reserve must stay ≤ the 10,000 free
// daily neurons (10,000,000 milli); the gap also absorbs estimation drift
// and any other Workers AI use on the account.
export const CHAT_NEURON_BUDGET_MILLI = 8_600_000
// Worst-case message: 4 model calls with every context and output limit
// maxed. tests/chatQuota.test.ts derives this bound from the CHAT_MAX_*
// constants — raise it there first if a limit grows.
export const CHAT_MESSAGE_RESERVE_MILLI = 1_350_000

// Atomically claim one message for the character's daily allowance.
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

// Give back a character's daily message when the answer degraded to
// retrieval-only — the player didn't get an AI answer, so the question
// shouldn't count against their allowance.
export async function refundCharacterMessage(env, characterId, dayKey) {
  try {
    await env.DB.prepare('UPDATE chat_usage SET count = MAX(0, count - 1) WHERE character_id = ? AND day_key = ?')
      .bind(characterId, dayKey)
      .run()
  } catch (err) {
    console.error('[PocketRPG][chat] message refund failed:', err?.message || err)
  }
}
