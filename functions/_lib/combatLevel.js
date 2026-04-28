// Server-side combat level computation. Mirrors src/engine/quests.js's
// getCombatLevel but lives here so Pages Functions don't pull JSX/Preact
// transitively. Reads stats from a parsed save_data JSON blob.
//
// We intentionally re-derive CB from the save rather than trusting the
// client to send it — the waiting-room CB column is a server-authoritative
// snapshot taken at join time and refreshed on heartbeat.

import { getLevelFromXP } from '../../src/engine/experience.js'

export function getCombatLevelFromSave(save) {
  if (!save || typeof save !== 'object') return 3
  const stats = save.stats || {}
  const lvl = (skill) => {
    const xp = stats?.[skill]?.xp || 0
    return getLevelFromXP(xp)
  }
  const atk = lvl('attack')
  const str = lvl('strength')
  const def = lvl('defence')
  const hp = lvl('hitpoints')
  const pray = lvl('prayer')
  const ranged = lvl('ranged')
  const magic = lvl('magic')
  const base = 0.25 * (def + hp + Math.floor(pray / 2))
  const melee = 0.325 * (atk + str)
  const range = 0.325 * (Math.floor(ranged / 2) + ranged)
  const mage  = 0.325 * (Math.floor(magic / 2) + magic)
  return Math.max(3, Math.floor(base + Math.max(melee, range, mage)))
}

// Read save row → parse → compute CB. Returns 3 (lowest) if no save exists.
export async function readCombatLevel(env, characterId) {
  const row = await env.DB.prepare(
    'SELECT save_data FROM saves WHERE character_id = ?'
  ).bind(characterId).first()
  if (!row?.save_data) return 3
  try {
    return getCombatLevelFromSave(JSON.parse(row.save_data))
  } catch {
    return 3
  }
}
