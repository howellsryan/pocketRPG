import { requireAuth, json } from '../../_lib/auth.js'
import { auditLog } from '../../_lib/game/audit.js'
import { GRINDMAN_CREDITS_BLOCKED } from '../../../src/engine/grindman.js'

// Map of SKU → Stripe Price ID + product semantics. Price IDs live in
// the Stripe Dashboard and are referenced here by environment binding
// (STRIPE_PRICE_*). The server picks the price; the client only names
// the SKU, so a tampered request can't escalate the grant.
function priceConfig(env) {
  return {
    remove_ads:    { priceId: env.STRIPE_PRICE_REMOVE_ADS,    type: 'remove_ads', amount: 0    },
    credits_10:    { priceId: env.STRIPE_PRICE_CREDITS_10,    type: 'credits',    amount: 10   },
    credits_100:   { priceId: env.STRIPE_PRICE_CREDITS_100,   type: 'credits',    amount: 100  },
    credits_1000:  { priceId: env.STRIPE_PRICE_CREDITS_1000,  type: 'credits',    amount: 1000 },
  }
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  if (!env.STRIPE_API_KEY) return json({ error: 'Stripe not configured' }, 500)

  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const sku = String(body?.sku || '')
  const characterId = parseInt(body?.character_id || '0', 10)
  const price = priceConfig(env)[sku]
  if (!price || !price.priceId) return json({ error: 'Invalid SKU' }, 400)

  // Credit purchases must reference a character the caller owns. We
  // verify here so the webhook handler can trust the identity_id /
  // character_id metadata on the Checkout Session.
  if (price.type === 'credits') {
    if (!Number.isFinite(characterId) || characterId <= 0) {
      return json({ error: 'character_id required for credit purchases' }, 400)
    }
    const owns = await env.DB.prepare(
      'SELECT id, is_grindman FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
    ).bind(characterId, auth.identity.id).first()
    if (!owns) return json({ error: 'Character not found' }, 404)
    // A Grindman earns every credit it spends. This is the only place a paid
    // credit grant can begin — the webhook credits the character named in
    // SERVER-written session metadata, and the account type is fixed at
    // creation, so a session for a Grindman can never exist to be honoured.
    if (owns.is_grindman === 1) {
      return json({ error: GRINDMAN_CREDITS_BLOCKED, code: 'GRINDMAN_NO_CREDIT_PURCHASE' }, 403)
    }
  }

  // Server-issued client_reference_id. The webhook handler verifies the
  // session's metadata matches this string, so a tampered Stripe
  // session URL (e.g. someone editing the redirect) cannot redirect the
  // grant to another user.
  const targetCharacterId = price.type === 'credits' ? characterId : 0
  const clientRef = `${auth.identity.id}:${targetCharacterId}`

  const form = new URLSearchParams()
  form.append('mode', 'payment')
  // The client detects a successful return by the presence of a `payment`
  // query param (App.jsx) — it then shows the thank-you toast and re-pulls
  // credits to ride out webhook latency. Keep the success param named
  // `payment` to match that handler. The cancel URL deliberately uses a
  // different param so an abandoned checkout doesn't fire the toast.
  form.append('success_url', `${env.APP_BASE_URL}/?payment=success`)
  form.append('cancel_url',  `${env.APP_BASE_URL}/?checkout=cancel`)
  form.append('line_items[0][price]', price.priceId)
  form.append('line_items[0][quantity]', '1')
  form.append('client_reference_id', clientRef)
  form.append('metadata[identity_id]', String(auth.identity.id))
  form.append('metadata[character_id]', String(targetCharacterId))
  form.append('metadata[type]', price.type)
  form.append('metadata[amount]', String(price.amount))
  form.append('metadata[sku]', sku)
  // payment_intent_data metadata so refund / dispute webhooks can
  // resolve the original grant via the PaymentIntent id.
  form.append('payment_intent_data[metadata][identity_id]', String(auth.identity.id))
  form.append('payment_intent_data[metadata][character_id]', String(targetCharacterId))
  form.append('payment_intent_data[metadata][type]', price.type)
  form.append('payment_intent_data[metadata][amount]', String(price.amount))

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.STRIPE_API_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    await auditLog(env, 'stripe.create_session.failed', {
      identityId: auth.identity.id, characterId, sku, status: res.status, body: text.slice(0, 500),
    }, { swallow: true })
    return json({ error: 'Stripe session creation failed', status: res.status }, 502)
  }
  const session = await res.json()
  await auditLog(env, 'stripe.create_session', {
    identityId: auth.identity.id, characterId, sku, sessionId: session.id,
  }, { swallow: true })
  return json({ url: session.url, id: session.id })
}
