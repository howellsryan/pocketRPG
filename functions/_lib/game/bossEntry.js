/**
 * The server-side boss entry gate, shared by every path that can put a player
 * in front of a boss the server grants loot for: the co-op join and the
 * open-world lair handoff (§20 — "a client-only gate is no gate").
 *
 * Two save-shape rules are the whole reason this file exists, because reading
 * either one from the wrong place fails OPEN, silently:
 *
 *   - Kill counts are NOT in the save blob. saveload.js strips them on the way
 *     out (they are monotonic counters and lose under last-write-wins merges);
 *     the kill_counts table (migration 0019) is the source of truth. A gate
 *     that reads `saveObject.bossKillCounts` sees `{}` forever, which locked
 *     every player out of a kill-count-gated boss no matter how many kills
 *     they had.
 *   - Completed quests live under `settings`, not at the top level.
 */

import monstersData from '../../../src/data/monsters.json' assert { type: 'json' }
import questsData from '../../../src/data/quests.json' assert { type: 'json' }
import { getLevelFromXP } from '../../../src/engine/experience.js'
import { checkBossRequirementsPure, hasKillCountGate } from '../../../src/engine/combatRequirements.js'
import { completedQuestsFromSave } from '../../../src/engine/questGates.js'

/**
 * Boss kill counts for a character, straight from the authoritative table.
 * Raid counts are deliberately left out — no boss gate reads them.
 */
export async function loadBossKillCounts(env, characterId) {
  const result = await env.DB.prepare(
    `SELECT source_id, kill_count FROM kill_counts
      WHERE character_id = ? AND source_type = 'monsters'`,
  ).bind(characterId).all()
  const counts = {}
  for (const row of result?.results || []) {
    const id = typeof row?.source_id === 'string' ? row.source_id : null
    if (!id) continue
    counts[id] = Math.max(0, Math.floor(Number(row.kill_count) || 0))
  }
  return counts
}

/** Re-exported so the co-op paths have one import for the save-shape rules. */
export const completedQuestIds = completedQuestsFromSave

export function slayerLevelOf(saveObject) {
  const slayer = saveObject?.stats?.slayer
  if (typeof slayer === 'number') return Math.max(1, Math.floor(slayer))
  const level = Number(slayer?.level)
  if (Number.isFinite(level) && level > 0) return Math.floor(level)
  return getLevelFromXP(Number(slayer?.xp) || 0)
}

/**
 * Pure gate: slayer level, quest and kill-count prerequisites for one boss.
 * `bossKillCounts` is passed in rather than read here so this stays sync and
 * unit-testable; callers get it from loadBossKillCounts.
 *
 * Returns null when the player may enter, or the lock reason.
 */
/**
 * True when this monster has ANY entry requirement at all. Lets a caller skip
 * the save read and the kill-count query for an ungated one — most world lairs
 * (the cow pasture, the fiend pit, the dragon roost) gate nothing, and paying
 * two D1 round-trips to prove it on every entry is waste.
 */
export function bossHasEntryGate(bossId) {
  const monster = monstersData?.[bossId]
  if (!monster) return true
  // Kill-count gates go through hasKillCountGate rather than the raw field: the
  // Ashen Crucible's prerequisite is hardcoded in the engine, so a field check
  // reads "ungated" and skips the very query that would enforce it.
  return !!(monster.questRequirement || monster.slayerRequirement)
    || hasKillCountGate({ ...monster, id: bossId })
}

export function bossEntryFailure(bossId, saveObject, bossKillCounts = {}) {
  const monster = monstersData?.[bossId]
  if (!monster) return { reason: 'Boss is not available' }
  const gate = checkBossRequirementsPure({ ...monster, id: bossId }, {
    slayerLevel: slayerLevelOf(saveObject),
    completedQuests: completedQuestIds(saveObject),
    bossKillCounts: bossKillCounts && typeof bossKillCounts === 'object' ? bossKillCounts : {},
    questsData,
    monstersData,
  })
  return gate.locked ? { reason: gate.reason } : null
}
