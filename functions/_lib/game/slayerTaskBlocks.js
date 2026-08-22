// Server side of the Slayer task block list (CLAUDE.md §20's neighbourhood —
// player-authored Slayer content — and §14: a block is a purchase, so the
// list itself is server state, never the save. Assignment stays
// client-authoritative (functions/_lib/mcp/intents.js's assignSlayerTask
// comment), so this table's only job is telling every assignment path which
// monsters to skip.
//
// active toggles for free and keeps the row (and the purchase) intact;
// deleting the row is the only way to lose the purchase, which is why the
// endpoint's DELETE is the one operation the client warns about before
// calling.

import { slayerTaskBlocksStatement } from './characterReads.js'
import { SLAYER_TASK_BLOCK_COST, SLAYER_TASK_BLOCK_MAX } from '../../../src/engine/slayerTaskBlocks.js'

export { SLAYER_TASK_BLOCK_COST, SLAYER_TASK_BLOCK_MAX }

export function mapSlayerTaskBlocks(result) {
  return (result?.results || []).map((r) => ({ monsterId: r.monster_id, active: !!r.active }))
}

/** Every block this character has purchased, active or not — for the client mirror. */
export async function listSlayerTaskBlocks(env, characterId) {
  if (!env?.DB || !characterId) return []
  return mapSlayerTaskBlocks(await slayerTaskBlocksStatement(env, characterId).all())
}

/** The set assignment must refuse right now. A toggled-off block still holds
 * its slot but must not narrow the pool — read live here rather than trusting
 * the save's mirror, same reasoning as loadBossKillCounts (§14). */
export async function activeBlockedMonsterIds(env, characterId) {
  if (!env?.DB || !characterId) return new Set()
  const rows = await env.DB.prepare(
    'SELECT monster_id FROM slayer_task_blocks WHERE character_id = ? AND active = 1',
  ).bind(characterId).all()
  return new Set((rows?.results || []).map((r) => r.monster_id))
}

/** Insert gated on the cap AND the row not already existing, in the same
 * statement — the caller has already debited credits and must refund when
 * this inserts nothing, so the check has to be atomic with the write rather
 * than a separate SELECT the caller's own request could race against itself. */
export async function insertSlayerTaskBlock(env, characterId, monsterId, now = Date.now()) {
  const result = await env.DB.prepare(`
    INSERT INTO slayer_task_blocks (character_id, monster_id, active, created_at)
    SELECT ?1, ?2, 1, ?3
     WHERE NOT EXISTS (SELECT 1 FROM slayer_task_blocks WHERE character_id = ?1 AND monster_id = ?2)
       AND (SELECT COUNT(*) FROM slayer_task_blocks WHERE character_id = ?1) < ${SLAYER_TASK_BLOCK_MAX}
  `).bind(characterId, monsterId, now).run()
  return (result?.meta?.changes || 0) > 0
}

/** Idempotent in both directions — flips a row that already reads the
 * requested value harmlessly. */
export async function setSlayerTaskBlockActive(env, characterId, monsterId, active) {
  const result = await env.DB.prepare(
    'UPDATE slayer_task_blocks SET active = ? WHERE character_id = ? AND monster_id = ?',
  ).bind(active ? 1 : 0, characterId, monsterId).run()
  return (result?.meta?.changes || 0) > 0
}

/** Deletes the purchase outright — the caller's UI is what warns this needs
 * repurchasing; nothing here is refundable. */
export async function removeSlayerTaskBlock(env, characterId, monsterId) {
  const result = await env.DB.prepare(
    'DELETE FROM slayer_task_blocks WHERE character_id = ? AND monster_id = ?',
  ).bind(characterId, monsterId).run()
  return (result?.meta?.changes || 0) > 0
}
