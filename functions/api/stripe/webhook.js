import { json } from '../../_lib/auth.js'
import { auditLog } from '../../_lib/game/audit.js'

const REPLAY_WINDOW_SEC = 5 * 60

// Constant-time compare of two equal-length hex strings. The previous
// implementation used `===` which short-circuits on the first differing
// byte and leaks signature bytes through timing.
function constantTimeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// Stripe HMAC-SHA256 signature scheme:
//   signed_payload = "{timestamp}.{rawBody}"
//   header = "t={ts},v1={hex1},v1={hex2}"
async function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false
  const parts = sigHeader.split(',')
  const tPart = parts.find(p => p.startsWith('t='))
  const v1Parts = parts.filter(p => p.startsWith('v1='))
  if (!tPart || v1Parts.length === 0) return false

  const timestamp = tPart.slice(2)
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > REPLAY_WINDOW_SEC) return false

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

  return v1Parts.some(p => constantTimeEqualHex(p.slice(3), computed))
}

// Production webhook accepts only live-mode events; preview accepts only
// test-mode. APP_BASE_URL discriminates: pocketrpg.co.uk is prod, anything
// else is preview/test. Misrouted events 400 so Stripe surfaces the
// misconfiguration rather than silently granting from the wrong account.
function isLiveModeExpected(env) {
  const url = env.APP_BASE_URL || ''
  return url.includes('pocketrpg.co.uk')
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

  // Livemode guard.
  const expectLive = isLiveModeExpected(env)
  if (Boolean(event.livemode) !== Boolean(expectLive)) {
    return json({ error: 'livemode_mismatch' }, 400)
  }

  // Idempotency: INSERT OR IGNORE on event_id. Stripe retries on any
  // non-2xx (timeouts, transient 5xx). Without this guard a slow D1
  // write that doesn't complete before Stripe's retry timer would
  // double-credit the buyer.
  const insertRes = await env.DB.prepare(
    `INSERT INTO stripe_events (event_id, event_type, livemode, received_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(event_id) DO NOTHING`
  ).bind(event.id, event.type, event.livemode ? 1 : 0, Date.now()).run()
  if (!insertRes?.meta?.changes) {
    return json({ received: true, duplicate: true })
  }

  // Dispatch. If a handler throws, delete the idempotency row so the
  // next Stripe retry can re-attempt — without this, a transient grant
  // failure would silently drop the purchase.
  try {
    if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(env, event)
    } else if (event.type === 'charge.refunded' || event.type === 'charge.dispute.funds_withdrawn') {
      await handleRefundOrDispute(env, event)
    } else if (event.type === 'charge.dispute.created') {
      await handleDisputeCreated(env, event)
    }
    // Other event types are silently ignored (kept in stripe_events
    // for completeness so we don't reprocess them on Stripe retries).
    return json({ received: true })
  } catch (err) {
    await env.DB.prepare('DELETE FROM stripe_events WHERE event_id = ?').bind(event.id).run().catch(() => {})
    await auditLog(env, 'stripe.webhook.handler_failed', {
      eventId: event.id, eventType: event.type, error: err?.message || String(err),
    }, { swallow: true })
    return json({ error: 'handler_failed' }, 500)
  }
}

async function handleCheckoutCompleted(env, event) {
  const session = event.data?.object
  if (!session) throw new Error('missing_session')

  // Hard guards: only fully-paid, positive-total sessions credit.
  if (session.payment_status !== 'paid') return
  if (!Number.isFinite(session.amount_total) || session.amount_total <= 0) {
    throw new Error('invalid_amount_total')
  }

  // Identity / type / amount come from session.metadata, which was set
  // server-side by /api/stripe/create-session. We cross-check against
  // client_reference_id (same source) to detect tampering before
  // mutating any account state.
  const identityId = parseInt(session.metadata?.identity_id || '0', 10)
  const characterId = parseInt(session.metadata?.character_id || '0', 10)
  const type = session.metadata?.type
  const amount = parseInt(session.metadata?.amount || '0', 10)
  const expectedRef = `${identityId}:${characterId}`
  if (session.client_reference_id !== expectedRef) {
    throw new Error('client_reference_id_mismatch')
  }
  if (!identityId || !type) throw new Error('missing_identity_or_type')

  if (type === 'remove_ads') {
    await env.DB.prepare(
      'UPDATE oauth_identities SET remove_ads = 1 WHERE id = ?'
    ).bind(identityId).run()
    await recordGrant(env, { event, identityId, characterId: null, type, amount: 0, session })
  } else if (type === 'credits' && amount > 0) {
    // Re-verify ownership at grant time. The check at create-session was
    // a UX hint; this is the gate that actually protects the grant.
    const owns = await env.DB.prepare(
      'SELECT id FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
    ).bind(characterId, identityId).first()
    if (!owns) throw new Error('character_not_owned_by_identity')
    await env.DB.prepare(
      'UPDATE characters SET credits = credits + ? WHERE id = ?'
    ).bind(amount, characterId).run()
    await recordGrant(env, { event, identityId, characterId, type, amount, session })
  } else {
    throw new Error('unknown_grant_type')
  }
  await auditLog(env, 'stripe.purchase.granted', {
    eventId: event.id, identityId, characterId: characterId || null, type, amount,
    amount_total: session.amount_total, currency: session.currency,
  }, { swallow: true })
}

async function recordGrant(env, { event, identityId, characterId, type, amount, session }) {
  await env.DB.prepare(
    `INSERT INTO purchase_grants
       (event_id, identity_id, character_id, type, amount, amount_total, currency,
        stripe_session_id, stripe_payment_intent_id, livemode, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    event.id, identityId, characterId || null, type, amount,
    session.amount_total, session.currency,
    session.id, session.payment_intent || null,
    event.livemode ? 1 : 0, Date.now()
  ).run()
}

async function handleRefundOrDispute(env, event) {
  const pi = event.data?.object?.payment_intent
  if (!pi) return
  const grant = await env.DB.prepare(
    'SELECT * FROM purchase_grants WHERE stripe_payment_intent_id = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(pi).first()
  if (!grant) return
  if (grant.reversed_at) return // already reversed

  if (grant.type === 'credits' && grant.character_id) {
    // Decrement, floored at 0. Player may have already spent some of
    // the granted credits; we can't recover the spent ones from the
    // economy, but we stop the rest of the grant from being usable.
    await env.DB.prepare(
      'UPDATE characters SET credits = MAX(0, credits - ?) WHERE id = ?'
    ).bind(grant.amount, grant.character_id).run()
  } else if (grant.type === 'remove_ads') {
    await env.DB.prepare(
      'UPDATE oauth_identities SET remove_ads = 0 WHERE id = ?'
    ).bind(grant.identity_id).run()
  }
  await env.DB.prepare(
    'UPDATE purchase_grants SET reversed_at = ?, reversal_reason = ? WHERE event_id = ?'
  ).bind(Date.now(), event.type, grant.event_id).run()
  await auditLog(env, 'stripe.purchase.reversed', {
    grantEventId: grant.event_id, eventId: event.id, reason: event.type,
    identityId: grant.identity_id, characterId: grant.character_id,
    type: grant.type, amount: grant.amount,
  }, { swallow: true })
}

async function handleDisputeCreated(env, event) {
  const pi = event.data?.object?.payment_intent
  if (!pi) return
  await env.DB.prepare(
    `UPDATE purchase_grants SET disputed_at = ? WHERE stripe_payment_intent_id = ? AND disputed_at IS NULL`
  ).bind(Date.now(), pi).run()
  await auditLog(env, 'stripe.purchase.disputed', { paymentIntent: pi, eventId: event.id }, { swallow: true })
}
