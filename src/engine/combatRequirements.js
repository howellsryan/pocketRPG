/**
 * Combat content-gating — pure requirement checks for bosses and raids.
 * No UI imports. Extracted from CombatScreen.jsx so the gates can be unit
 * tested in isolation (a regression here wrongly locks or unlocks content).
 *
 * Each checker takes the content definition plus an explicit context object of
 * the player progression it reads, and returns:
 *   { locked: false } | { locked: true, reason: string }
 *
 * The same data-driven gates (slayer level, quest completion, kill-count
 * prerequisites) back both the slayer-master assignment and the combat screen,
 * so keeping this logic in one tested place avoids drift.
 */

import { questRequirementMet } from './questGates.js'

/**
 * @param {object} monster - monster definition (id, name, slayerRequirement?, questRequirement?)
 * @param {object} ctx
 * @param {number} ctx.slayerLevel - player's current Slayer level
 * @param {Set<string>|{has:(id:string)=>boolean}} ctx.completedQuests
 * @param {Record<string, number>} ctx.bossKillCounts
 * @param {Array<{id:string,name:string}>} ctx.questsData
 */
export function checkBossRequirementsPure(monster, ctx = {}) {
  const {
    slayerLevel = 0,
    completedQuests = new Set(),
    bossKillCounts = {},
    questsData = [],
  } = ctx

  if (!monster) return { locked: false }

  if (monster.slayerRequirement && slayerLevel < monster.slayerRequirement) {
    return { locked: true, reason: `Need Slayer level ${monster.slayerRequirement} to fight ${monster.name}` }
  }

  // Quest gates are data-driven (monster.questRequirement) so the slayer master
  // assignment and this combat gate share one source of truth.
  if (!questRequirementMet(completedQuests, monster.questRequirement)) {
    const questName = questsData.find((q) => q.id === monster.questRequirement)?.name
      || monster.questRequirement.replace(/_/g, ' ')
    return { locked: true, reason: `Complete ${questName} to fight ${monster.name}` }
  }

  // Kill-count prerequisite: the Ashen Crucible unlocks only after a first
  // Ember Tyrant kill.
  if (monster.id === 'ashen_crucible' && (!bossKillCounts['ember_tyrant'] || bossKillCounts['ember_tyrant'] < 1)) {
    return { locked: true, reason: 'Defeat Ember Tyrant first to unlock Ashen Crucible' }
  }

  return { locked: false }
}

/**
 * @param {object} raid - raid definition (id)
 * @param {object} ctx
 * @param {Set<string>|{has:(id:string)=>boolean}} ctx.completedQuests
 */
export function checkRaidRequirementsPure(raid, ctx = {}) {
  const { completedQuests = new Set() } = ctx

  if (!raid) return { locked: false }

  if (raid.id === 'theatre_of_blood' && !questRequirementMet(completedQuests, 'a_night_at_the_theatre')) {
    return { locked: true, reason: 'Complete A Night at the Theatre to access Crimson Night Theatre' }
  }

  return { locked: false }
}
