// Server side of Hard Mode (§14). The doubled drop rates are a high-value
// grant, so the flag that unlocks them is server state: it lives in
// hard_mode_targets (migration 0038), is written only by /api/hard-mode, and is
// read back here on the kill. No request body can ever turn hard mode ON — a
// client that could claim it could double its own drop rates for free.

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

/**
 * Whether THIS kill rolls at hard-mode rates.
 *
 * The server's switch is the ceiling and the only thing that can turn the
 * doubling on. The client may only turn it DOWN, by reporting which record it
 * actually fought (`hardModeActive` on the monster the fight was built from).
 *
 * That downgrade exists because the two can legitimately disagree: the switch
 * lives in D1 and the client holds a mirror, so a fight built before the mirror
 * lands — or one running while the switch is flipped on another device — is an
 * ordinary boss. Paying it hard-mode rates would hand out doubled drops for a
 * fight nobody fought hard. A missing field means an older client and keeps the
 * server's own answer, so this can never quietly stop paying a real hard kill.
 */
export async function hardModeForKill(env, characterId, sourceType, sourceId, body) {
  if (body?.hardMode === false) return false
  return isHardModeEnabled(env, characterId, sourceType, sourceId)
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
