const SENSITIVE_KEYS = new Set([
  'authorization', 'cookie', 'token', 'jwt', 'secret', 'password',
  'save_data', 'save_blob', 'rawbody',
])

const MAX_STRING_LENGTH = 500
const SCHEMA_VERSION = 1

function truncateString(value) {
  if (typeof value !== 'string') return value
  if (value.length <= MAX_STRING_LENGTH) return value
  return `${value.slice(0, MAX_STRING_LENGTH)}...[truncated:${value.length - MAX_STRING_LENGTH}]`
}

export function safeLogFields(input, depth = 0) {
  if (input == null) return input
  if (depth > 4) return '[max_depth]'
  if (Array.isArray(input)) return input.slice(0, 20).map(v => safeLogFields(v, depth + 1))
  if (typeof input === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(input)) {
      const lower = String(k).toLowerCase()
      if (SENSITIVE_KEYS.has(lower) || [...SENSITIVE_KEYS].some(s => lower.includes(s))) {
        out[k] = '[redacted]'
        continue
      }
      out[k] = safeLogFields(v, depth + 1)
    }
    return out
  }
  return truncateString(input)
}

export function sanitizeError(error) {
  if (!error) return null
  const obj = typeof error === 'object' ? error : { message: String(error) }
  return safeLogFields({
    errorName: obj.name || 'Error',
    errorMessage: obj.message || 'Unknown error',
    errorStack: typeof obj.stack === 'string' ? truncateString(obj.stack) : undefined,
    errorCode: obj.code || obj.errorCode || undefined,
  })
}

export function getOrCreateRequestId(request) {
  const fromHeader = request?.headers?.get('X-Request-Id') || request?.headers?.get('x-request-id')
  if (fromHeader && String(fromHeader).trim()) return String(fromHeader).trim().slice(0, 128)
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `req_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`
}

export function createLogger(base = {}) {
  const log = (level, input = {}) => {
    const payload = safeLogFields({ schemaVersion: SCHEMA_VERSION, level, ...base, ...input })
    if (level === 'error') console.error(payload)
    else if (level === 'warn') console.warn(payload)
    else console.log(payload)
  }
  return { debug: (i) => log('debug', i), info: (i) => log('info', i), warn: (i) => log('warn', i), error: (i) => log('error', i) }
}

export const logInfo = (i) => createLogger().info(i)
export const logWarn = (i) => createLogger().warn(i)
export const logError = (i) => createLogger().error(i)

export async function withRequestLogging(context, handlerOrNext) {
  const startedAt = Date.now()
  const requestId = getOrCreateRequestId(context.request)
  const url = new URL(context.request.url)
  const route = url.pathname
  const method = context.request.method
  const environment = context.env?.CF_PAGES_BRANCH === 'main' ? 'production' : (context.env?.CF_PAGES_BRANCH ? 'preview' : 'dev')
  const characterId = context.request.headers.get('X-Character-Id') || undefined
  const logger = createLogger({ requestId, route, method, characterId, environment })

  context.data ||= {}
  context.data.requestId = requestId
  context.data.route = route
  context.data.startedAt = startedAt
  context.data.logger = logger

  try {
    const response = await handlerOrNext()
    const durationMs = Date.now() - startedAt
    logger.info({ event: 'api_request_completed', status: response.status, durationMs })
    const headers = new Headers(response.headers)
    if (!headers.has('X-Request-Id')) headers.set('X-Request-Id', requestId)
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  } catch (error) {
    const durationMs = Date.now() - startedAt
    logger.error({ event: 'api_request_failed', status: 500, durationMs, ...sanitizeError(error) })
    return new Response(JSON.stringify({ error: 'server_error', requestId }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
    })
  }
}
