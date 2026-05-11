import { json } from '../../_lib/auth.js'

const ALLOWED_CREDIT_AMOUNTS = new Set([10, 100, 1000])

// Verify Stripe webhook signature using Web Crypto (no Stripe SDK needed).
// Stripe signs with HMAC-SHA256: signed_payload = "{timestamp}.{rawBody}"
export async function verifyStripeSignature(rawBody, sigHeader, secret) {
  const parts = sigHeader.split(',')
  const tPart = parts.find(p => p.startsWith('t='))
  const v1Parts = parts.filter(p => p.startsWith('v1='))
  if (!tPart || v1Parts.length === 0) return false

  const timestamp = tPart.slice(2)
  const signatures = v1Parts.map(p => p.slice(3))

  // Reject webhooks older than 5 minutes to prevent replay attacks
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > 300) return false

  const signedPayload = `${timestamp}.${rawBody}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload))
  const computed = Array.from(new Uint8Array(mac))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  return signatures.some(sig => sig === computed)
}

export function validateStripeCheckoutEvent(event, env) {
  if (event?.type !== 'checkout.session.completed') return { ok: false, reason: 'ignored_event_type' }
  const session = event?.data?.object
  if (!session) return { ok: false, reason: 'missing_session' }

  if (session.payment_status !== 'paid') return { ok: false, reason: 'payment_not_paid' }

  const expectedLiveMode = String(env.STRIPE_LIVE_MODE || '').trim()
  if (expectedLiveMode === 'true' && session.livemode !== true) return { ok: false, reason: 'livemode_mismatch' }
  if (expectedLiveMode === 'false' && session.livemode !== false) return { ok: false, reason: 'livemode_mismatch' }

  const refId = session.client_reference_id
  const type = session.metadata?.type
  const amount = parseInt(session.metadata?.amount || '0', 10)

  if (!refId || !type) return { ok: false, reason: 'missing_metadata' }

  if (type === 'credits') {
    if (!ALLOWED_CREDIT_AMOUNTS.has(amount)) return { ok: false, reason: 'invalid_credit_amount' }
    if (!Number.isFinite(parseInt(refId, 10))) return { ok: false, reason: 'invalid_character_ref' }
  } else if (type === 'remove_ads') {
    if (!Number.isFinite(parseInt(refId, 10))) return { ok: false, reason: 'invalid_identity_ref' }
  } else {
    return { ok: false, reason: 'invalid_purchase_type' }
  }

  return { ok: true, session, refId, type, amount }
}

async function markEventOnce(env, eventId, eventType, refId, amount) {
  const now = Date.now()
  const insert = await env.DB.prepare(
    `INSERT OR IGNORE INTO processed_webhook_events (event_id, event_type, ref_id, amount, processed_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(eventId, eventType, refId, amount, now).run()
  return insert.meta?.changes === 1
}

export async function onRequestPost({ request, env }) {
  const sigHeader = request.headers.get('stripe-signature')
  if (!sigHeader) return json({ error: 'Missing Stripe-Signature header' }, 400)

  const webhookSecret = env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) return json({ error: 'Webhook secret not configured' }, 500)

  const rawBody = await request.text()

  const valid = await verifyStripeSignature(rawBody, sigHeader, webhookSecret)
  if (!valid) return json({ error: 'Invalid signature' }, 400)

  let event
  try { event = JSON.parse(rawBody) } catch { return json({ error: 'Invalid JSON' }, 400) }

  const eventId = event?.id
  if (!eventId || typeof eventId !== 'string') return json({ error: 'Missing event id' }, 400)

  const check = validateStripeCheckoutEvent(event, env)
  if (!check.ok) {
    // Acknowledge ignored/non-actionable events to stop retries.
    return json({ received: true, ignored: true, reason: check.reason })
  }

  const { refId, type, amount } = check
  const firstSeen = await markEventOnce(env, eventId, event.type, String(refId), amount)
  if (!firstSeen) return json({ received: true, duplicate: true })

  if (type === 'remove_ads') {
    // refId is an oauth_identities.id — grants removal for all characters on the account
    await env.DB.prepare(
      'UPDATE oauth_identities SET remove_ads = 1 WHERE id = ?',
    ).bind(refId).run()
  } else {
    // refId is a characters.id — credits are per-character
    await env.DB.prepare(
      'UPDATE characters SET credits = credits + ? WHERE id = ?',
    ).bind(amount, refId).run()
  }

  return json({ received: true })
}
