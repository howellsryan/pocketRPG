// Server-side combat level computation. Delegates to the single source of
// truth in src/engine/combatLevel.js (which pulls no JSX/Preact, only
// experience.js), so the server can never drift from the client. Reads stats
// from a parsed save_data JSON blob.
//
// We intentionally re-derive CB from the save rather than trusting the
// client to send it — the waiting-room CB column is a server-authoritative
// snapshot taken at join time and refreshed on heartbeat.

import { combatLevelFromStats } from '../../src/engine/combatLevel.js'

export function getCombatLevelFromSave(save) {
  if (!save || typeof save !== 'object') return 3
  return combatLevelFromStats(save.stats || {})
}

// Read the denormalized CB column off `characters`. Populated on every save
// PUT (see functions/api/save.js + migration 0012) so PvP hot paths no
// longer parse a full save blob just to read combat level. Returns 3
// (lowest) if the character is missing/deleted or hasn't been backfilled.
export async function readCombatLevel(env, characterId) {
  const row = await env.DB.prepare(
    'SELECT combat_level FROM characters WHERE id = ? AND deleted_at IS NULL'
  ).bind(characterId).first()
  const cb = Number(row?.combat_level)
  if (!Number.isFinite(cb) || cb < 3) return 3
  return Math.floor(cb)
}
