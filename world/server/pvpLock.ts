// Minimal "is this character in an active PvP match?" check for the world
// Worker. Deliberately a lean 2-query mirror of functions/_lib/pvp.js's
// assertNotInActiveMatch rather than an import of it — that module pulls in the
// PvP bot/save graph, which has no business in the world bundle. Used to refuse
// world entry (session exchange + DO hello) and as defence-in-depth in the grant
// flush, so a locked PvP match can never be mutated through a world session.
export async function isCharacterInActiveMatch(env: { DB: D1Database }, characterId: number): Promise<boolean> {
  const row = await env.DB.prepare('SELECT active_match_id FROM characters WHERE id = ?')
    .bind(characterId).first<{ active_match_id: number | null }>()
  const activeMatchId = row?.active_match_id ?? null
  if (!activeMatchId) return false
  const match = await env.DB.prepare("SELECT id FROM pvp_matches WHERE id = ? AND status = 'active'")
    .bind(activeMatchId).first<{ id: number }>()
  if (match?.id) return true
  // active_match_id pointed at a match that's no longer active — confirm the
  // character isn't in some other active match before treating them as free.
  const other = await env.DB.prepare(
    "SELECT id FROM pvp_matches WHERE status = 'active' AND (character_a = ? OR character_b = ?) LIMIT 1"
  ).bind(characterId, characterId).first<{ id: number }>()
  return Boolean(other?.id)
}
