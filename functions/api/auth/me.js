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
      `SELECT id, credits,
              COALESCE(total_pvp_kills, 0) AS total_pvp_kills,
              last_updated_total_pvp_kills
         FROM characters
        WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
    ).bind(charId, auth.identity.id).first()
    if (charRow) {
      character = {
        id: charRow.id,
        credits: charRow.credits ?? 0,
        total_pvp_kills: charRow.total_pvp_kills ?? 0,
        last_updated_total_pvp_kills: charRow.last_updated_total_pvp_kills ?? null,
      }
    }
  }

  return json({
    identity: {
      ...auth.identity,
      remove_ads: row?.remove_ads === 1,
    },
    character,
    // Credit / remove-ads purchases now go through POST /api/stripe/
    // create-session, which authenticates the buyer and produces a
    // server-issued Checkout Session URL. The four STRIPE_PAYMENT_LINK_*
    // fields are no longer published; left as `null` so an older client
    // that still reads them just falls through to the new flow.
    stripe_links: { remove_ads: null, credits_10: null, credits_100: null, credits_1000: null },
    stripe_skus: {
      remove_ads:   'remove_ads',
      credits_10:   'credits_10',
      credits_100:  'credits_100',
      credits_1000: 'credits_1000',
    },
  })
}
