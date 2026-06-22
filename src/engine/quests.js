/**
 * Quest Engine — pure logic for quest progression, eligibility, and idle simulation.
 * No UI imports.
 */

import { getLevelFromXP } from './experience.js'
import { combatLevelFromStats } from './combatLevel.js'
import { TICK_DURATION } from '../utils/constants.js'

/**
 * Compute the total quest points a player has from a Set-like of completed quest IDs.
 * Quest points are awarded by complexity tier (PocketRPG-flavoured approximation).
 */
const QUEST_POINTS_BY_COMPLEXITY = {
  Novice: 1,
  Intermediate: 1,
  Experienced: 2,
  Master: 3,
  Grandmaster: 5,
  Special: 10, // Recipe for Disaster
}

export function getQuestPointsEarned(completedQuestIds, questsData) {
  let points = 0
  for (const id of completedQuestIds) {
    const q = questsData.find(x => x.id === id)
    if (!q) continue
    points += QUEST_POINTS_BY_COMPLEXITY[q.complexity] || 1
  }
  return points
}

/**
 * Convert the effective player combat level from the stats object.
 * Mirrors the PocketRPG combat level formula.
 */
// Delegates to the single source of truth in src/engine/combatLevel.js.
// Kept as a named re-export here because the MCP quest-eligibility path
// imports it from this module.
export function getCombatLevel(stats) {
  return combatLevelFromStats(stats)
}

/**
 * Returns { eligible: true } or { eligible: false, reasons: string[] } for a quest.
 */
export function checkQuestEligibility(quest, stats, completedQuestIds, questsData) {
  const reasons = []
  if (!quest) return { eligible: false, reasons: ['Unknown quest'] }
  if (completedQuestIds.has(quest.id)) return { eligible: false, reasons: ['Already complete'] }

  // Skill requirements
  for (const [skill, req] of Object.entries(quest.skillRequirements || {})) {
    const xp = stats?.[skill]?.xp || 0
    const lvl = getLevelFromXP(xp)
    if (lvl < req) reasons.push(`${skill.charAt(0).toUpperCase() + skill.slice(1)} ${req}`)
  }

  // Quest prerequisites
  for (const prereqId of quest.questRequirements || []) {
    if (!completedQuestIds.has(prereqId)) {
      const prereq = questsData.find(q => q.id === prereqId)
      reasons.push(`Complete ${prereq ? prereq.name : prereqId}`)
    }
  }

  // Quest points
  if (quest.questPointRequirement > 0) {
    const qp = getQuestPointsEarned(completedQuestIds, questsData)
    if (qp < quest.questPointRequirement) {
      reasons.push(`${quest.questPointRequirement} Quest points (have ${qp})`)
    }
  }

  // Combat level
  if (quest.combatLevelRequirement > 0) {
    const cb = getCombatLevel(stats)
    if (cb < quest.combatLevelRequirement) {
      reasons.push(`Combat level ${quest.combatLevelRequirement} (have ${cb})`)
    }
  }

  return { eligible: reasons.length === 0, reasons }
}

/**
 * Build an active-task payload for a quest. Matches the shape consumed by the
 * tick loop and idle engine.
 */
export function createQuestState(quest) {
  const totalTicks = Math.max(1, Math.ceil(quest.durationSeconds * 1000 / TICK_DURATION))
  return {
    active: true,
    quest,
    totalTicks,
    ticksRemaining: totalTicks,
    startedAt: Date.now(),
  }
}

/**
 * Advance a running quest by one tick.
 * Returns { questState, events[] }
 *   events: [{ type: 'questComplete', quest }]
 */
export function processQuestTick(questState) {
  const state = { ...questState }
  const events = []
  state.ticksRemaining = Math.max(0, state.ticksRemaining - 1)

  if (state.ticksRemaining <= 0) {
    state.active = false
    events.push({ type: 'questComplete', quest: state.quest })
  }

  return { questState: state, events }
}

/**
 * Simulate idle quest progress while the tab is hidden.
 * Returns null if no time elapsed, otherwise:
 *   { completed: boolean, ticksUsed, ticksRemaining, quest }
 */
export function simulateIdleQuest(task, elapsedMs) {
  if (!task || !task.quest || task.type !== 'quest') return null
  const totalTicks = task.totalTicks || Math.ceil(task.quest.durationSeconds * 1000 / TICK_DURATION)
  const startingRemaining = task.ticksRemaining != null ? task.ticksRemaining : totalTicks
  const ticksElapsed = Math.floor(elapsedMs / TICK_DURATION)
  const ticksUsed = Math.min(startingRemaining, ticksElapsed)
  const ticksRemaining = Math.max(0, startingRemaining - ticksElapsed)
  const completed = ticksRemaining <= 0
  return {
    completed,
    ticksUsed,
    ticksRemaining,
    quest: task.quest,
    xpGained: completed ? { ...task.quest.xpReward } : null,
    coinsGained: completed ? task.quest.coinReward : 0,
    itemUnlocks: completed ? [...(task.quest.itemUnlocks || [])] : [],
  }
}

/**
 * Format a duration in seconds to "1h 15m" / "45m" / "30s".
 */
export function formatQuestDuration(totalSeconds) {
  const hrs = Math.floor(totalSeconds / 3600)
  const mins = Math.floor((totalSeconds % 3600) / 60)
  const secs = Math.floor(totalSeconds % 60)
  if (hrs > 0 && mins > 0) return `${hrs}h ${mins}m`
  if (hrs > 0) return `${hrs}h`
  if (mins > 0 && secs > 0) return `${mins}m ${secs}s`
  if (mins > 0) return `${mins}m`
  return `${secs}s`
}
