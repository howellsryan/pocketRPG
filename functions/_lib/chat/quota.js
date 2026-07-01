// Chatbot usage quotas (see migrations/0027_chat_usage.sql). Two layers keep
// the Workers AI free allocation at £0:
//   1. Per-character daily message cap — hard refusal once exhausted.
//   2. Global daily AI-call cap (circuit-breaker) — when tripped, /api/chat
//      still answers but from retrieval only (no model call).

export const CHAT_DAILY_LIMIT = 30
export const CHAT_GLOBAL_DAILY_LIMIT = 1500

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

// Atomically claim one global AI call for the day. Returns false when the
// circuit-breaker has tripped (caller should fall back to retrieval-only).
export async function claimGlobalAiCall(env, dayKey, limit = CHAT_GLOBAL_DAILY_LIMIT) {
  const res = await env.DB.prepare(
    `INSERT INTO chat_global_usage (day_key, count) VALUES (?, 1)
     ON CONFLICT(day_key) DO UPDATE SET count = count + 1
     WHERE chat_global_usage.count < ?`,
  )
    .bind(dayKey, limit)
    .run()
  return (res?.meta?.changes ?? 0) > 0
}
