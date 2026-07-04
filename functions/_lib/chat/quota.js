// Chatbot spend guard (migration 0027). Messages are unlimited (the free Gemini
// primary is unmetered here); the only cost cap is a global daily budget on the
// PAID paths — the Workers AI fallback (neurons, $0.011/1k) and, if configured,
// the OpenAI attempt (tokens). Each metered message atomically reserves its
// worst possible cost up front and refunds the unused part once the API reports
// actual usage, so the day's spend can never cross the budget mid-flight; when a
// pool runs out, /api/chat skips that pool (Gemini/retrieval still answer).

// Token prices converted to milli-neurons per token at $0.011 per 1,000
// neurons. Rated at $0.10/M input, $0.40/M output — an upper bound for both
// gemini-2.5-flash-lite ($0.10/$0.40; free-tier keys bill $0) and the GLM
// fallback ($0.06/$0.40) — so the budget doubles as a daily $ spend cap.
// Revisit when CHAT_MODEL / CHAT_FALLBACK_MODEL change.
export const MILLI_NEURONS_PER_INPUT_TOKEN = 9.1
export const MILLI_NEURONS_PER_OUTPUT_TOKEN = 36.37

// Budget + one in-flight worst-case reserve must stay ≤ the 10,000 free
// daily neurons (10,000,000 milli); the gap also absorbs estimation drift
// and any other Workers AI use on the account.
export const CHAT_NEURON_BUDGET_MILLI = 8_200_000
// Worst-case message: 4 model calls with every context and output limit
// maxed (incl. the read-tool schemas the model is offered). tests/chatQuota.test.ts
// derives this bound from the CHAT_MAX_* constants + chatToolDefs() — raise it
// there first if a limit grows or read tools are added to the allowlist.
export const CHAT_MESSAGE_RESERVE_MILLI = 1_800_000

// Separate daily pool for the OpenAI attempt, denominated in tokens
// (prompt + completion) against the ~2.5M/day complimentary data-sharing
// allotment. Metered locally because OpenAI doesn't hard-stop at the free
// allotment — overage bills at normal rates. Budget + one in-flight reserve
// stays under 2.5M. Rows live in chat_neuron_usage under an 'openai:'-
// prefixed day_key; the reserve/settle statements are unit-agnostic.
export const CHAT_OPENAI_TOKEN_BUDGET = 2_200_000
export const CHAT_OPENAI_MESSAGE_RESERVE_TOKENS = 150_000

export function openaiPoolKey(dayKey) {
  return `openai:${dayKey}`
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
