import { json } from '../../_lib/auth.js'

// Verify Stripe webhook signature using Web Crypto (no Stripe SDK needed).
// Stripe signs with HMAC-SHA256: signed_payload = "{timestamp}.{rawBody}"
async function verifyStripeSignature(rawBody, sigHeader, secret) {
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

  if (event.type === 'checkout.session.completed') {
    const session = event.data?.object
    const refId = session?.client_reference_id
    const type = session?.metadata?.type        // 'remove_ads' | 'credits'
    const amount = parseInt(session?.metadata?.amount || '0', 10)

    if (!refId || !type) return json({ received: true })

    if (type === 'remove_ads') {
      // refId is an oauth_identities.id — grants removal for all characters on the account
      await env.DB.prepare(
        'UPDATE oauth_identities SET remove_ads = 1 WHERE id = ?',
      ).bind(refId).run()
    } else if (type === 'credits' && amount > 0) {
      // refId is a characters.id — credits are per-character
      await env.DB.prepare(
        'UPDATE characters SET credits = credits + ? WHERE id = ?',
      ).bind(amount, refId).run()
    }
  }

  return json({ received: true })
}
