import { requireAuth, json } from '../../_lib/auth.js'
import {
  identityStatement, characterStatement, mapIdentity, mapCharacter,
  STRIPE_LINKS, STRIPE_SKUS,
} from '../../_lib/identityPayload.js'

// The identity/character half of a boot. /api/bootstrap returns this same
// payload alongside the rest of the boot data in one request; this route stays
// for the character picker (which has no character selected yet) and for
// clients that predate bootstrap.
export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const row = await identityStatement(env, auth.identity.id).first()

  // If the client is acting on behalf of a selected character, return its
  // credit balance so the UI can render Credits in the header and refresh
  // after a Stripe webhook has processed a purchase.
  const charIdHeader = request.headers.get('X-Character-Id')
  const charId = charIdHeader ? parseInt(charIdHeader, 10) : null
  const charRow = charId
    ? await characterStatement(env, charId, auth.identity.id).first()
    : null

  return json({
    identity: mapIdentity(auth.identity, row),
    character: mapCharacter(charRow),
    stripe_links: STRIPE_LINKS,
    stripe_skus: STRIPE_SKUS,
  })
}
