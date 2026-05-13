export class GameApiError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message || code)
    this.name = 'GameApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export function toErrorResponse(err) {
  if (err instanceof GameApiError) {
    return {
      status: err.status,
      body: { error: err.message, code: err.code, ...(err.details ? { details: err.details } : {}) },
    }
  }
  return { status: 500, body: { error: 'Internal server error', code: 'INTERNAL_ERROR' } }
}
