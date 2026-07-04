// Chatbot spend guard (migration 0027). There is no per-character message cap;
// every AI path is paid, so cost is bounded by two global daily budgets: the
// OpenAI primary meters its own token pool, while the Gemini and Workers AI
// fallbacks share the neuron budget below. Each metered message atomically
// reserves its worst possible cost up front and refunds the unused part once the
// API reports actual usage, so the day's spend can never cross a budget
// mid-flight; when a pool runs out, /api/chat skips that pool (the next
// fallback, then retrieval-only, still answer).

// Token prices converted to milli-neurons per token at $0.011 per 1,000
// neurons. Rated at $0.10/M input, $0.40/M output — an upper bound for both
// gemini-2.5-flash-lite ($0.10/$0.40) and the GLM fallback ($0.06/$0.40) — so
// the neuron budget doubles as a daily $ spend cap for those two paid fallbacks.
// Revisit when CHAT_MODEL / CHAT_FALLBACK_MODEL change.
export const MILLI_NEURONS_PER_INPUT_TOKEN = 9.1
export const MILLI_NEURONS_PER_OUTPUT_TOKEN = 36.37

// Shared budget for the paid Gemini + Workers AI fallbacks. Workers AI bills
// neurons, so budget + one in-flight worst-case reserve must stay ≤ the 10,000
// free daily neurons (10,000,000 milli); the gap also absorbs estimation drift
// and any other Workers AI use on the account.
export const CHAT_NEURON_BUDGET_MILLI = 7_700_000
// Worst-case message: 4 model calls with every context and output limit maxed,
// including the FULL MCP tool schema the model is offered (reads + gated
// writes). tests/chatQuota.test.ts derives this bound from the CHAT_MAX_*
// constants + chatToolDefs() — raise it there first if a limit grows or the
// tool surface expands.
export const CHAT_MESSAGE_RESERVE_MILLI = 2_200_000

// Separate daily pool for the OpenAI attempt, denominated in tokens
// (prompt + completion) against the ~2.5M/day complimentary data-sharing
// allotment. Metered locally because OpenAI doesn't hard-stop at the free
// allotment — overage bills at normal rates. Budget + one in-flight reserve
// stays under 2.5M. Rows live in chat_neuron_usage under an 'openai:'-
// prefixed day_key; the reserve/settle statements are unit-agnostic.
export const CHAT_OPENAI_TOKEN_BUDGET = 2_200_000
export const CHAT_OPENAI_MESSAGE_RESERVE_TOKENS = 185_000

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
