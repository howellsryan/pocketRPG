import { safeLogFields } from './logger.js'

function present(value) {
  return value !== undefined && value !== null && value !== ''
}

export async function writeAuditEvent(env, event) {
  const columns = ['event_type', 'severity', 'created_at']
  const values = [event.eventType, event.severity, event.createdAt || Date.now()]

  const optionalFields = [
    ['request_id', event.requestId],
    ['identity_id', event.identityId],
    ['character_id', event.characterId],
    ['related_character_id', event.relatedCharacterId],
    ['match_id', event.matchId],
    ['invitation_id', event.invitationId],
    ['stripe_event_id', event.stripeEventId],
    ['item_id', event.itemId],
    ['status', event.status],
    ['error_code', event.errorCode],
    ['message', event.message],
  ]

  for (const [column, value] of optionalFields) {
    if (!present(value)) continue
    columns.push(column)
    values.push(value)
  }

  if (present(event.metadata)) {
    columns.push('metadata_json')
    values.push(JSON.stringify(safeLogFields(event.metadata)))
  }

  const placeholders = values.map(() => '?').join(', ')
  const sql = `INSERT INTO audit_events (${columns.join(', ')}) VALUES (${placeholders})`
  return env.DB.prepare(sql).bind(...values).run()
}

export async function writeAuditEventSafe(contextOrEnv, event) {
  const env = contextOrEnv?.env || contextOrEnv
  try { await writeAuditEvent(env, event) } catch {}
}
