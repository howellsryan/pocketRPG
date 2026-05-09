import { describe, it, expect, vi } from 'vitest'
import { onRequest } from '../functions/api/_middleware.js'

describe('api middleware', () => {
  it('adds request id on success', async () => {
    const context = { request: new Request('https://x/api/save', { method: 'GET' }), env: {}, data: {}, next: async () => new Response('ok', { status: 200 }) }
    const res = await onRequest(context)
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
  })
  it('handles thrown errors', async () => {
    const context = { request: new Request('https://x/api/save', { method: 'GET' }), env: {}, data: {}, next: async () => { throw new Error('x') } }
    const res = await onRequest(context)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('server_error')
    expect(body.requestId).toBeTruthy()
  })
})
