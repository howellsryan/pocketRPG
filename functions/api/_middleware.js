import { withRequestLogging } from '../_lib/logger.js'
import { writeAuditEventSafe } from '../_lib/audit.js'

export async function onRequest(context) {
  return withRequestLogging(context, async () => {
    try {
      return await context.next()
    } catch (error) {
      const requestId = context.data?.requestId || 'unknown'
      const characterIdHeader = Number.parseInt(context.request.headers.get('X-Character-Id') || '0', 10)
      const characterId = Number.isFinite(characterIdHeader) ? characterIdHeader : 0
      await writeAuditEventSafe(context, {
        eventType: 'api_request_failed',
        severity: 'error',
        requestId,
        characterId,
        status: 'failed',
        errorCode: error?.name || 'unhandled_exception',
        message: error?.message || 'Unhandled exception in API middleware',
      })
      throw error
    }
  })
}
