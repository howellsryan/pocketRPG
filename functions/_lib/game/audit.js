// Durable audit log. Writes are awaited so a D1 outage surfaces as the
// caller's error (so the handler returns 500 rather than silently dropping
// the audit trail). Callers that explicitly cannot afford to fail on audit
// write — typically inside a PvP tick where mid-match resilience is more
// important than completeness — can pass { swallow: true } and the failure
// will be logged but not rethrown.
//
// Backward compatibility: pre-step-4 callers used `auditLog(event, details)`
// with no env. To make the rollout safe to land in stages, the signature
// detects whether the first arg is an env binding or an event string. The
// console.log branch is kept as a safety net but should be considered
// deprecated — new call sites must pass env.

function isEnvLike(value) {
  return !!value && typeof value === 'object' && value.DB && typeof value.DB.prepare === 'function'
}

export async function auditLog(envOrEvent, eventOrDetails = {}, detailsOrOptions = {}, options = {}) {
  let env, eventType, payload, opts
  if (isEnvLike(envOrEvent)) {
    env = envOrEvent
    eventType = String(eventOrDetails || 'unknown')
    payload = detailsOrOptions && typeof detailsOrOptions === 'object' ? detailsOrOptions : {}
    opts = options && typeof options === 'object' ? options : {}
  } else {
    // Legacy signature: auditLog(event, details). Falls through to console
    // only because we have not yet finished threading env to every caller.
    console.log('[PocketRPG][AUDIT]', JSON.stringify({ event: envOrEvent, at: Date.now(), ...(eventOrDetails || {}) }))
    return
  }
  const { swallow = false } = opts
  try {
    const identityId  = payload?.identityId  ?? payload?.identity_id  ?? null
    const characterId = payload?.characterId ?? payload?.character_id ?? null
    await env.DB.prepare(
      `INSERT INTO audit_events (event_type, identity_id, character_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(eventType, identityId, characterId, JSON.stringify(payload), Date.now()).run()
  } catch (err) {
    console.error('[PocketRPG][AUDIT][failed]', eventType, err && (err.message || err))
    if (!swallow) throw err
  }
}
