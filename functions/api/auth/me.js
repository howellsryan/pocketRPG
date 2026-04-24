import { requireAuth, json } from '../../_lib/auth.js'

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  // Fetch remove_ads from DB — not stored in JWT so it reflects post-payment updates
  const row = await env.DB.prepare(
    'SELECT remove_ads FROM oauth_identities WHERE id = ?',
  ).bind(auth.identity.id).first()

  // If the client is acting on behalf of a selected character, return its
  // credit balance so the UI can render Credits in the header and refresh
  // after a Stripe webhook has processed a purchase.
  let character = null
  const charIdHeader = request.headers.get('X-Character-Id')
  const charId = charIdHeader ? parseInt(charIdHeader, 10) : null
  if (charId) {
    const charRow = await env.DB.prepare(
      'SELECT id, credits FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL',
    ).bind(charId, auth.identity.id).first()
    if (charRow) character = { id: charRow.id, credits: charRow.credits ?? 0 }
  }

  return json({
    identity: {
      ...auth.identity,
      remove_ads: row?.remove_ads === 1,
    },
    character,
    stripe_links: {
      remove_ads:   env.STRIPE_PAYMENT_LINK_REMOVE_ADS   || null,
      credits_10:   env.STRIPE_PAYMENT_LINK_CREDITS_10   || null,
      credits_100:  env.STRIPE_PAYMENT_LINK_CREDITS_100  || null,
      credits_1000: env.STRIPE_PAYMENT_LINK_CREDITS_1000 || null,
    },
  })
}
