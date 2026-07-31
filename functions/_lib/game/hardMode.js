// Server side of Hard Mode (§14). The doubled drop rates are a high-value
// grant, so the flag that unlocks them is server state: it lives in
// hard_mode_targets (migration 0035), is written only by /api/hard-mode, and is
// read back here on the kill. Nothing in a request body ever decides whether a
// kill rolled hard — a client that could claim hard mode could double its own
// drop rates for free.

import monstersData from '../../../src/data/monsters.json' assert { type: 'json' }
import raidsData from '../../../src/data/raids.json' assert { type: 'json' }
import { supportsHardMode } from '../../../src/engine/hardMode.js'

export const HARD_MODE_SOURCE_TYPES = new Set(['monsters', 'raids'])

/** Content-authored eligibility, server-side. */
export function hardModeTarget(sourceType, sourceId) {
  if (typeof sourceId !== 'string' || !sourceId) return null
  if (sourceType === 'monsters') return supportsHardMode(monstersData?.[sourceId]) ? monstersData[sourceId] : null
  if (sourceType === 'raids') return supportsHardMode(raidsData?.[sourceId]) ? raidsData[sourceId] : null
  return null
}

/** Whether this character has hard mode switched on for one boss/raid. */
export async function isHardModeEnabled(env, characterId, sourceType, sourceId) {
  // An entry that cannot be hard never needs the read: a normal boss's kill
  // stays a single-statement completion.
  if (!env?.DB || !characterId || !hardModeTarget(sourceType, sourceId)) return false
  const row = await env.DB.prepare(
    'SELECT 1 AS enabled FROM hard_mode_targets WHERE character_id = ? AND source_type = ? AND source_id = ?',
  ).bind(characterId, sourceType, sourceId).first()
  return !!row
}

/** Everything this character has switched on, for the client mirror. */
export async function listHardModeTargets(env, characterId) {
  if (!env?.DB || !characterId) return []
  const rows = await env.DB.prepare(
    'SELECT source_type, source_id FROM hard_mode_targets WHERE character_id = ?',
  ).bind(characterId).all()
  return (rows.results || [])
    .filter((r) => hardModeTarget(r.source_type, r.source_id))
    .map((r) => ({ sourceType: r.source_type, sourceId: r.source_id }))
}

/** Switch one boss/raid on or off. Idempotent in both directions. */
export async function setHardModeTarget(env, characterId, sourceType, sourceId, enabled, now = Date.now()) {
  if (enabled) {
    await env.DB.prepare(
      `INSERT INTO hard_mode_targets (character_id, source_type, source_id, enabled_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(character_id, source_type, source_id) DO NOTHING`,
    ).bind(characterId, sourceType, sourceId, now).run()
    return
  }
  await env.DB.prepare(
    'DELETE FROM hard_mode_targets WHERE character_id = ? AND source_type = ? AND source_id = ?',
  ).bind(characterId, sourceType, sourceId).run()
}
