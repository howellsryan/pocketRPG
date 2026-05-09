import { describe, it, expect } from 'vitest'
import { onRequest } from '../functions/api/_middleware.js'

describe('api middleware', () => {
  it('adds request id on success', async () => {
    const context = { request: new Request('https://x/api/save', { method: 'GET' }), env: {}, data: {}, next: async () => new Response('ok', { status: 200 }) }
    const res = await onRequest(context as never)
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
  })

  it('handles thrown errors and audits failure', async () => {
    let inserted = false
    const context = {
      request: new Request('https://x/api/save', { method: 'GET', headers: { 'X-Character-Id': '12' } }),
      env: {
        DB: {
          prepare: () => ({
            bind: () => ({
              run: async () => {
                inserted = true
                return { ok: true }
              },
            }),
          }),
        },
      },
      data: {},
      next: async () => { throw new Error('x') },
    }
    const res = await onRequest(context as never)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('server_error')
    expect(body.requestId).toBeTruthy()
    expect(inserted).toBe(true)
  })
})
