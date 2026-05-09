export async function writeAuditEvent(env, event) {
  const sql = `INSERT INTO audit_events (
    event_type, severity, request_id, character_id, status, error_code, message, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  return env.DB.prepare(sql).bind(
    event.eventType,
    event.severity,
    event.requestId,
    event.characterId,
    event.status,
    event.errorCode,
    event.message,
    event.createdAt || Date.now(),
  ).run()
}

export async function writeAuditEventSafe(contextOrEnv, event) {
  const env = contextOrEnv?.env || contextOrEnv
  try { await writeAuditEvent(env, event) } catch {}
}
