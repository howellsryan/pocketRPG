import { requireAuth, json } from '../../_lib/auth.js'

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  // Fetch remove_ads from DB — not stored in JWT so it reflects post-payment updates
  const row = await env.DB.prepare(
    'SELECT remove_ads FROM oauth_identities WHERE id = ?',
  ).bind(auth.identity.id).first()

  return json({
    identity: {
      ...auth.identity,
      remove_ads: row?.remove_ads === 1,
    },
    stripe_links: {
      remove_ads:   env.STRIPE_PAYMENT_LINK_REMOVE_ADS   || null,
      credits_10:   env.STRIPE_PAYMENT_LINK_CREDITS_10   || null,
      credits_100:  env.STRIPE_PAYMENT_LINK_CREDITS_100  || null,
      credits_1000: env.STRIPE_PAYMENT_LINK_CREDITS_1000 || null,
    },
  })
}
