import { safeLogFields } from './logger.js'

export async function writeAuditEvent(env, event) {
  const metadata = event.metadata ? JSON.stringify(safeLogFields(event.metadata)) : null
  return env.DB.prepare(`INSERT INTO audit_events (
    event_type, severity, request_id, identity_id, character_id, related_character_id,
    match_id, invitation_id, stripe_event_id, item_id, status, error_code, message, metadata_json, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      event.eventType,
      event.severity,
      event.requestId || null,
      event.identityId || null,
      event.characterId || null,
      event.relatedCharacterId || null,
      event.matchId || null,
      event.invitationId || null,
      event.stripeEventId || null,
      event.itemId || null,
      event.status || null,
      event.errorCode || null,
      event.message || null,
      metadata,
      event.createdAt || Date.now(),
    ).run()
}

export async function writeAuditEventSafe(contextOrEnv, event) {
  const env = contextOrEnv?.env || contextOrEnv
  try { await writeAuditEvent(env, event) } catch {}
}
