import { describe, it, expect } from 'vitest'
import { getOrCreateRequestId, safeLogFields, sanitizeError } from '../functions/_lib/logger.js'

describe('logger', () => {
  it('reads request id header', () => {
    const req = new Request('https://x/api', { headers: { 'X-Request-Id': 'abc' } })
    expect(getOrCreateRequestId(req)).toBe('abc')
  })
  it('generates request id', () => {
    const req = new Request('https://x/api')
    expect(getOrCreateRequestId(req)).toBeTruthy()
  })
  it('redacts sensitive fields and truncates', () => {
    const out = safeLogFields({ token: 'secret', nested: { save_data: 'x' }, long: 'a'.repeat(700) })
    expect(out.token).toBe('[redacted]')
    expect(out.nested.save_data).toBe('[redacted]')
    expect(String(out.long)).toContain('[truncated:')
  })
  it('sanitizes errors', () => {
    const e = new Error('boom')
    const out = sanitizeError(e)
    expect(out.errorName).toBe('Error')
    expect(out.errorMessage).toBe('boom')
  })
})
