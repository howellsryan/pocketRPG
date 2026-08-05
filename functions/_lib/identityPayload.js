// The identity + character half of what a boot needs, shared by /api/auth/me
// and /api/bootstrap so the two can never answer differently.
//
// The character row here is a deliberate superset of the one `getOwnedCharacter`
// reads: selecting `username` alongside the credits and account-mode fields
// makes this single read serve as bootstrap's ownership check too, instead of
// costing a second identical SELECT.

export function identityStatement(env, identityId) {
  // remove_ads is read from D1 rather than the JWT so it reflects a purchase
  // made since the token was issued.
  return env.DB.prepare('SELECT remove_ads FROM oauth_identities WHERE id = ?').bind(identityId)
}

export function characterStatement(env, characterId, identityId) {
  return env.DB.prepare(
    `SELECT id, username, credits, is_ironman, is_one_life,
            COALESCE(total_pvp_kills, 0) AS total_pvp_kills,
            last_updated_total_pvp_kills
       FROM characters
      WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
  ).bind(characterId, identityId)
}

export function mapIdentity(identity, row) {
  return { ...identity, remove_ads: row?.remove_ads === 1 }
}

/** The character payload, or null when the row is absent or not owned. */
export function mapCharacter(row) {
  if (!row) return null
  return {
    id: row.id,
    username: row.username,
    credits: row.credits ?? 0,
    // Authoritative account-type flags. The client mirrors these into its
    // one-life / ironman gates (incl. the One-Life death wipe) at boot, so a
    // returning session that skips the character picker can't drift out of
    // sync with the server row and treat a one-life death as a respawn.
    is_ironman: row.is_ironman === 1,
    is_one_life: row.is_one_life === 1,
    total_pvp_kills: row.total_pvp_kills ?? 0,
    last_updated_total_pvp_kills: row.last_updated_total_pvp_kills ?? null,
  }
}

// Credit / remove-ads purchases go through POST /api/stripe/create-session,
// which authenticates the buyer and produces a server-issued Checkout Session
// URL. The four link fields are no longer published; left as `null` so an older
// client that still reads them falls through to the new flow.
export const STRIPE_LINKS = Object.freeze({
  remove_ads: null, credits_10: null, credits_100: null, credits_1000: null,
})

export const STRIPE_SKUS = Object.freeze({
  remove_ads: 'remove_ads',
  credits_10: 'credits_10',
  credits_100: 'credits_100',
  credits_1000: 'credits_1000',
})
