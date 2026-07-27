// Builds the ordered statement plan to permanently delete an OAuth identity and
// all of its characters' data — the server side of the in-app "Delete account"
// flow required by App Review (Apple Guideline 5.1.1(v)).
//
// Returned as plain { sql, params } so the cascade is unit-testable without a
// live D1. The caller runs them as a single env.DB.batch() (atomic). Order
// matters: child rows are removed via a subquery over `characters`, so every
// such statement must run before `characters` itself is deleted.
//
// Financial records (purchase_grants, stripe_events) are intentionally retained
// for accounting/reconciliation; audit_events keeps an `account_deleted` record.
export function accountDeletionPlan(identityId, { now = Date.now() } = {}) {
  const ownedChars = 'SELECT id FROM characters WHERE owner_id = ?'
  const inOwned = `character_id IN (${ownedChars})`

  return [
    {
      sql: 'INSERT INTO audit_events (event_type, identity_id, character_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?)',
      params: ['account_deleted', identityId, null, JSON.stringify({ identityId }), now],
    },
    { sql: `DELETE FROM saves WHERE ${inOwned}`, params: [identityId] },
    { sql: `DELETE FROM character_idle_state WHERE ${inOwned}`, params: [identityId] },
    { sql: `DELETE FROM collection_log WHERE ${inOwned}`, params: [identityId] },
    { sql: `DELETE FROM trading_post_offers WHERE ${inOwned}`, params: [identityId] },
    { sql: `DELETE FROM kill_counts WHERE ${inOwned}`, params: [identityId] },
    { sql: `DELETE FROM action_nonces WHERE ${inOwned}`, params: [identityId] },
    { sql: `DELETE FROM pvp_waiting_room WHERE ${inOwned}`, params: [identityId] },
    {
      sql: `DELETE FROM pvp_invitations WHERE from_character IN (${ownedChars}) OR to_character IN (${ownedChars})`,
      params: [identityId, identityId],
    },
    {
      sql: `DELETE FROM pvp_matches WHERE character_a IN (${ownedChars}) OR character_b IN (${ownedChars})`,
      params: [identityId, identityId],
    },
    { sql: 'DELETE FROM characters WHERE owner_id = ?', params: [identityId] },
    { sql: 'DELETE FROM oauth_identities WHERE id = ?', params: [identityId] },
  ]
}
