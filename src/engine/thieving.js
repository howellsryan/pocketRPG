/**
 * Thieving Engine — pure logic for pickpocketing NPCs.
 * No UI imports.
 */

import { getLevelFromXP } from './experience.js'
import { rollMasterFarmerSeeds } from './seedDrops.js'

/**
 * Roll a single gem from an NPC's gem table (e.g. Tzraar). Each entry is an
 * independent cumulative slice, mirroring the hunter main-table roll so gems
 * land at the same absolute rate as the Jeweller. Returns an itemId or null
 * (the leftover probability yields nothing).
 */
export function rollGemReward(gems, rng = Math.random) {
  if (!Array.isArray(gems) || !gems.length) return null
  let roll = rng()
  for (const gem of gems) {
    roll -= gem.chance || 0
    if (roll <= 0) return gem.itemId
  }
  return null
}

/** Roll `count` gems, aggregated into { itemId: quantity } (skips misses). */
export function rollGemRewards(count, gems, rng = Math.random) {
  const out = {}
  for (let i = 0; i < count; i++) {
    const id = rollGemReward(gems, rng)
    if (id) out[id] = (out[id] || 0) + 1
  }
  return out
}

/**
 * Create a thieving state object for a pickpocketing session.
 */
export function createThievingState(npc) {
  return {
    active: true,
    npc,
    // Each pickpocket takes roughly 4 ticks (2.4s) unless the NPC overrides it
    // (e.g. the Master Farmer is slower at 8 ticks).
    ticksRemaining: getPickpocketTicks(npc),
    tickCount: 0,
    justCompleted: false
  }
}

// Ticks per successful pickpocket for an NPC (default 4). Exported because a
// thieving npc carries no `ticks` field at all, so anything reading one — the
// training planner's time estimate — reads every npc as a single tick.
export function getPickpocketTicks(npc) {
  return npc?.pickpocketTicks || 4
}

/**
 * Process one tick of thieving.
 * Returns { thievingState, events[] }
 * events: { type: 'pickpocketSuccess', xp, coins, npcName } or
 *         { type: 'pickpocketFailure', npcName }
 */
export function processThievingTick(thievingState) {
  const state = { ...thievingState }
  const events = []
  state.tickCount++

  // Check justCompleted FIRST to reset before checking for new completion
  if (state.justCompleted) {
    state.ticksRemaining = getPickpocketTicks(state.npc)
    state.justCompleted = false
  } else {
    state.ticksRemaining--
  }

  if (state.ticksRemaining <= 0) {
    // Calculate success based on level vs requirement
    // PocketRPG has a success rate formula, but for simplicity:
    // success_rate = 1 - (npc_level - player_thieving_level) / 100 (capped at 0-100%)
    // For now, we'll just make it always succeed for player level >= npc level
    // TODO: Implement proper PocketRPG success rates in future

    events.push({
      type: 'pickpocketSuccess',
      xp: state.npc.xp,
      coins: state.npc.coins || 0,
      npcName: state.npc.name,
      // Future: add drops array here for rare items
      drops: state.npc.drops || []
    })

    state.justCompleted = true
  }

  return { thievingState: state, events }
}

/**
 * Simulate idle thieving.
 * Returns { xpGained, coinsGained, actions, skill, actionName }
 */
export function simulateIdleThieving(task, elapsedMs) {
  if (!task || !task.npc) return null

  const TICK_MS = 600
  const TICKS_PER_ACTION = getPickpocketTicks(task.npc) // Master Farmer is slower
  const totalTicks = Math.floor(elapsedMs / TICK_MS)
  const actions = Math.floor(totalTicks / TICKS_PER_ACTION)

  if (actions <= 0) return null

  const xpGained = { thieving: task.npc.xp * actions }

  // Master Farmer rewards one seed per pickpocket instead of coins.
  if (task.npc.seedReward) {
    return {
      xpGained,
      coinsGained: 0,
      itemsGained: rollMasterFarmerSeeds(actions),
      actions,
      skill: 'thieving',
      actionName: task.npc.name,
    }
  }

  // Tzraar and other gem targets reward gems (at the Jeweller's rate) not coins.
  if (task.npc.gemReward) {
    return {
      xpGained,
      coinsGained: 0,
      itemsGained: rollGemRewards(actions, task.npc.gems),
      actions,
      skill: 'thieving',
      actionName: task.npc.name,
    }
  }

  const coinsGained = (task.npc.coins || 0) * actions

  return { xpGained, coinsGained, actions, skill: 'thieving', actionName: task.npc.name }
}
