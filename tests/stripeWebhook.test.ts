import { describe, it, expect } from 'vitest'
import { onRequestPost, validateStripeCheckoutEvent } from '../functions/api/stripe/webhook.js'

function buildSig(rawBody: string, secret: string, timestamp: number) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  ).then((key) => crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`)))
    .then((mac) => {
      const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('')
      return `t=${timestamp},v1=${hex}`
    })
}

function mockEnv() {
  const seen = new Set<string>()
  const credits: Record<string, number> = {}
  const removeAds: Record<string, number> = {}
  return {
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    STRIPE_LIVE_MODE: 'false',
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: any[]) {
            return {
              async run() {
                if (sql.includes('INSERT OR IGNORE INTO processed_webhook_events')) {
                  const eventId = args[0]
                  const changes = seen.has(eventId) ? 0 : 1
                  seen.add(eventId)
                  return { meta: { changes } }
                }
                if (sql.includes('UPDATE characters SET credits = credits + ? WHERE id = ?')) {
                  const amount = Number(args[0])
                  const id = String(args[1])
                  credits[id] = (credits[id] || 0) + amount
                  return { meta: { changes: 1 } }
                }
                if (sql.includes('UPDATE oauth_identities SET remove_ads = 1 WHERE id = ?')) {
                  const id = String(args[0])
                  removeAds[id] = 1
                  return { meta: { changes: 1 } }
                }
                return { meta: { changes: 1 } }
              },
            }
          },
        }
      },
    },
    _state: { credits, removeAds },
  }
}

describe('stripe webhook hardening', () => {
  it('rejects invalid credit amounts via semantic validation', () => {
    const event: any = {
      type: 'checkout.session.completed',
      data: { object: { payment_status: 'paid', livemode: false, client_reference_id: '12', metadata: { type: 'credits', amount: '999' } } },
    }
    const out = validateStripeCheckoutEvent(event, { STRIPE_LIVE_MODE: 'false' } as any)
    expect(out.ok).toBe(false)
  })

  it('processes a valid event exactly once', async () => {
    const env: any = mockEnv()
    const event = {
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: { payment_status: 'paid', livemode: false, client_reference_id: '42', metadata: { type: 'credits', amount: '100' } } },
    }
    const raw = JSON.stringify(event)
    const sig = await buildSig(raw, env.STRIPE_WEBHOOK_SECRET, Math.floor(Date.now() / 1000))

    const req1 = new Request('https://example.test/api/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': sig }, body: raw })
    const res1 = await onRequestPost({ request: req1, env })
    expect(res1.status).toBe(200)
    expect(env._state.credits['42']).toBe(100)

    const req2 = new Request('https://example.test/api/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': sig }, body: raw })
    const res2 = await onRequestPost({ request: req2, env })
    const json2 = await res2.json()
    expect(json2.duplicate).toBe(true)
    expect(env._state.credits['42']).toBe(100)
  })
})
