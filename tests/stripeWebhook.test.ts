import { describe, it, expect, beforeEach } from 'vitest'
import { onRequestPost } from '../functions/api/stripe/webhook.js'

const WEBHOOK_SECRET = 'whsec_test_secret_for_unit_tests'
const LIVE_BASE = 'https://pocketrpg.co.uk'

async function signedRequest(event: any, { secret = WEBHOOK_SECRET, ts = Math.floor(Date.now() / 1000) }: { secret?: string; ts?: number } = {}) {
  const rawBody = JSON.stringify(event)
  const signedPayload = `${ts}.${rawBody}`
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload))
  const sig = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('')
  return new Request('https://example.com/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': `t=${ts},v1=${sig}` },
    body: rawBody,
  })
}

// FakeDB tracks stripe_events, purchase_grants, characters credits,
// and oauth_identities.remove_ads in JS Maps. The patterns the webhook
// uses are small enough to enumerate exactly.
function makeDb({ characters = [{ id: 7, owner_id: 3, credits: 0 }] }: { characters?: any[] } = {}) {
  const events = new Map<string, any>()
  const grants = new Map<string, any>()
  const charMap = new Map(characters.map((c: any) => [c.id, { ...c }]))
  const identityRemoveAds = new Map<number, number>()
  const DB = {
    prepare(stmt: string) {
      const sql = stmt.trim().replace(/\s+/g, ' ')
      let bound: any[] = []
      const api = {
        bind(...args: any[]) { bound = args; return api },
        async run() {
          if (sql.startsWith('INSERT INTO stripe_events')) {
            const [event_id, event_type, livemode, received_at] = bound
            if (events.has(event_id)) return { meta: { changes: 0 } }
            events.set(event_id, { event_id, event_type, livemode, received_at })
            return { meta: { changes: 1 } }
          }
          if (sql.startsWith('DELETE FROM stripe_events WHERE event_id = ?')) {
            events.delete(bound[0])
            return { meta: { changes: 1 } }
          }
          if (sql.startsWith('UPDATE oauth_identities SET remove_ads = 1 WHERE id = ?')) {
            identityRemoveAds.set(bound[0], 1)
            return { meta: { changes: 1 } }
          }
          if (sql.startsWith('UPDATE oauth_identities SET remove_ads = 0 WHERE id = ?')) {
            identityRemoveAds.set(bound[0], 0)
            return { meta: { changes: 1 } }
          }
          if (sql.startsWith('UPDATE characters SET credits = credits + ? WHERE id = ?')) {
            const [amount, id] = bound
            const c = charMap.get(id)
            if (c) c.credits = (c.credits || 0) + amount
            return { meta: { changes: c ? 1 : 0 } }
          }
          if (sql.startsWith('UPDATE characters SET credits = MAX(0, credits - ?) WHERE id = ?')) {
            const [amount, id] = bound
            const c = charMap.get(id)
            if (c) c.credits = Math.max(0, (c.credits || 0) - amount)
            return { meta: { changes: c ? 1 : 0 } }
          }
          if (sql.startsWith('INSERT INTO purchase_grants')) {
            const [event_id, identity_id, character_id, type, amount, amount_total, currency, session_id, pi, livemode, created_at] = bound
            grants.set(event_id, { event_id, identity_id, character_id, type, amount, amount_total, currency, session_id, pi, livemode, created_at })
            return { meta: { changes: 1 } }
          }
          if (sql.startsWith('UPDATE purchase_grants SET reversed_at = ?, reversal_reason = ? WHERE event_id = ?')) {
            const [reversed_at, reason, eventId] = bound
            const g = grants.get(eventId)
            if (g) { g.reversed_at = reversed_at; g.reversal_reason = reason }
            return { meta: { changes: g ? 1 : 0 } }
          }
          if (sql.startsWith('UPDATE purchase_grants SET disputed_at = ?')) {
            const [disputed_at, pi] = bound
            for (const g of grants.values()) {
              if (g.pi === pi && !g.disputed_at) g.disputed_at = disputed_at
            }
            return { meta: { changes: 1 } }
          }
          // For the audit_events insert, just no-op.
          if (sql.startsWith('INSERT INTO audit_events')) {
            return { meta: { changes: 1 } }
          }
          return { meta: { changes: 0 } }
        },
        async first() {
          if (sql.startsWith('SELECT id FROM characters WHERE id = ?')) {
            const [id, owner_id] = bound
            const c = charMap.get(id)
            return c && c.owner_id === owner_id ? { id } : null
          }
          if (sql.startsWith('SELECT * FROM purchase_grants WHERE stripe_payment_intent_id = ?')) {
            const [pi] = bound
            const matching = [...grants.values()].filter(g => g.pi === pi).sort((a, b) => b.created_at - a.created_at)
            return matching[0] || null
          }
          return null
        },
      }
      return api
    },
  }
  return { events, grants, charMap, identityRemoveAds, DB }
}

function liveCheckoutSession(overrides: any = {}) {
  return {
    id: 'evt_checkout_1',
    type: 'checkout.session.completed',
    livemode: true,
    data: {
      object: {
        id: 'cs_test_abc',
        payment_status: 'paid',
        amount_total: 1099,
        currency: 'usd',
        client_reference_id: '3:7',
        payment_intent: 'pi_test_abc',
        metadata: { identity_id: '3', character_id: '7', type: 'credits', amount: '10', sku: 'credits_10' },
        ...overrides,
      },
    },
  }
}

describe('Stripe webhook hardening', () => {
  let env: any
  let dbState: ReturnType<typeof makeDb>
  beforeEach(() => {
    dbState = makeDb()
    env = {
      DB: dbState.DB,
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      APP_BASE_URL: LIVE_BASE,
    }
  })

  it('400s when stripe-signature header is missing', async () => {
    const req = new Request('https://example.com', { method: 'POST', body: '{}' })
    const res = await onRequestPost({ request: req, env })
    expect(res.status).toBe(400)
  })

  it('400s on invalid signature', async () => {
    const req = new Request('https://example.com', {
      method: 'POST',
      headers: { 'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=ffff` },
      body: JSON.stringify(liveCheckoutSession()),
    })
    const res = await onRequestPost({ request: req, env })
    expect(res.status).toBe(400)
  })

  it('400s when livemode does not match deployment environment', async () => {
    const req = await signedRequest({ ...liveCheckoutSession(), livemode: false })
    const res = await onRequestPost({ request: req, env })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('livemode_mismatch')
  })

  it('credits the character once on first delivery, idempotent on replay', async () => {
    const event = liveCheckoutSession()
    const res1 = await onRequestPost({ request: await signedRequest(event), env })
    expect(res1.status).toBe(200)
    expect(dbState.charMap.get(7)?.credits).toBe(10)
    expect(dbState.grants.size).toBe(1)

    const res2 = await onRequestPost({ request: await signedRequest(event), env })
    expect(res2.status).toBe(200)
    const body2 = await res2.json()
    expect(body2.duplicate).toBe(true)
    expect(dbState.charMap.get(7)?.credits).toBe(10)
    expect(dbState.grants.size).toBe(1)
  })

  it('rejects a checkout session whose client_reference_id does not match metadata', async () => {
    const tampered = liveCheckoutSession({ client_reference_id: '999:42' })
    const res = await onRequestPost({ request: await signedRequest(tampered), env })
    expect(res.status).toBe(500)
    expect(dbState.charMap.get(7)?.credits).toBe(0)
  })

  it('ignores a checkout session whose payment_status is not "paid"', async () => {
    const event = { ...liveCheckoutSession(), data: { object: { ...liveCheckoutSession().data.object, payment_status: 'unpaid' } } }
    const res = await onRequestPost({ request: await signedRequest(event), env })
    expect(res.status).toBe(200)
    expect(dbState.charMap.get(7)?.credits).toBe(0)
    expect(dbState.grants.size).toBe(0)
  })

  it('rejects a checkout session for a character the identity does not own', async () => {
    dbState = makeDb({ characters: [{ id: 7, owner_id: 99, credits: 0 }] })
    env.DB = dbState.DB
    const res = await onRequestPost({ request: await signedRequest(liveCheckoutSession()), env })
    expect(res.status).toBe(500)
    expect(dbState.charMap.get(7)?.credits).toBe(0)
  })

  it('reverses a credit grant on charge.refunded', async () => {
    await onRequestPost({ request: await signedRequest(liveCheckoutSession()), env })
    expect(dbState.charMap.get(7)?.credits).toBe(10)

    const refund = {
      id: 'evt_refund_1',
      type: 'charge.refunded',
      livemode: true,
      data: { object: { payment_intent: 'pi_test_abc' } },
    }
    const res = await onRequestPost({ request: await signedRequest(refund), env })
    expect(res.status).toBe(200)
    expect(dbState.charMap.get(7)?.credits).toBe(0)
    const grant = [...dbState.grants.values()][0]
    expect(grant.reversed_at).toBeGreaterThan(0)
    expect(grant.reversal_reason).toBe('charge.refunded')
  })

  it('flags but does not auto-reverse on charge.dispute.created', async () => {
    await onRequestPost({ request: await signedRequest(liveCheckoutSession()), env })
    const dispute = {
      id: 'evt_dispute_1',
      type: 'charge.dispute.created',
      livemode: true,
      data: { object: { payment_intent: 'pi_test_abc' } },
    }
    const res = await onRequestPost({ request: await signedRequest(dispute), env })
    expect(res.status).toBe(200)
    expect(dbState.charMap.get(7)?.credits).toBe(10)
    const grant = [...dbState.grants.values()][0]
    expect(grant.disputed_at).toBeGreaterThan(0)
    expect(grant.reversed_at).toBeUndefined()
  })

  it('removes the idempotency row on handler failure so Stripe retries succeed', async () => {
    const bad = liveCheckoutSession({ client_reference_id: 'nope' })
    const res = await onRequestPost({ request: await signedRequest(bad), env })
    expect(res.status).toBe(500)
    expect(dbState.events.size).toBe(0)
  })
})
