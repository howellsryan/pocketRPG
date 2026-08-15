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
 * @param {Record<string, {name?:string}>} [ctx.monstersData] - names prerequisite bosses
 */
export function checkBossRequirementsPure(monster, ctx = {}) {
  const {
    slayerLevel = 0,
    completedQuests = new Set(),
    bossKillCounts = {},
    bossKillCountsLoaded = true,
    questsData = [],
    monstersData = {},
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

  // Kill counts live in D1, not the save (§14), so on the client they arrive a
  // fetch AFTER the rest of the state. A gate cannot be judged before they land
  // — that would tell a player who cleared a prerequisite years ago to go and
  // clear it — but it cannot be waved through either: a hub row that reads as
  // available invites a tap the fetch then refuses. Say what is actually true.
  // `pending` marks a transient lock, not a verdict about the player, so a
  // caller can present it as news rather than as a refusal.
  if (!bossKillCountsLoaded && hasKillCountGate(monster)) {
    return { locked: true, pending: true, reason: `Checking your kill counts for ${monster.name}` }
  }

  const unmetKill = unmetKillCountRequirement(monster, bossKillCounts)
  if (unmetKill) {
    if (unmetKill.requiredId === 'ember_tyrant' && monster.id === 'ashen_crucible') {
      return { locked: true, reason: 'Defeat Ember Tyrant first to unlock Ashen Crucible' }
    }
    const name = monstersData?.[unmetKill.requiredId]?.name || unmetKill.requiredId.replace(/_/g, ' ')
    const times = unmetKill.needed === 1 ? '' : ` ${unmetKill.needed} times`
    return { locked: true, reason: `Defeat ${name}${times} to challenge ${monster.name}` }
  }

  return { locked: false }
}

/**
 * The first kill-count prerequisite this monster does not meet, or null when it
 * is fully unlocked. `killCountRequirement` maps a monster id to the kills
 * needed; the Ashen Crucible's Ember Tyrant gate predates that field and stays
 * hardcoded here rather than in the content.
 *
 * Kill counts live in D1, not the save (§14), so a caller that cannot see them
 * must decide for itself what an absent map means: the combat gate answers
 * "checking" (bossKillCountsLoaded, above), while the slayer pool fails CLOSED
 * — an unverifiable count there would hand out a task the combat screen and the
 * server both refuse to start.
 */
export function unmetKillCountRequirement(monster, bossKillCounts = {}) {
  const counts = bossKillCounts && typeof bossKillCounts === 'object' ? bossKillCounts : {}
  const requirements = { ...(monster?.killCountRequirement || {}) }
  if (monster?.id === 'ashen_crucible' && requirements.ember_tyrant === undefined) requirements.ember_tyrant = 1
  for (const [requiredId, requiredKills] of Object.entries(requirements)) {
    const needed = Math.max(1, Math.floor(Number(requiredKills) || 1))
    if ((Number(counts[requiredId]) || 0) >= needed) continue
    return { requiredId, needed }
  }
  return null
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

/**
 * Whether this monster is gated on kill counts at all — the data-driven field
 * or the Ashen Crucible's hardcoded prerequisite. One funnel, so a caller
 * deciding whether it needs the counts at all cannot miss the hardcoded one.
 */
export function hasKillCountGate(monster) {
  return unmetKillCountRequirement(monster, {}) !== null
}
