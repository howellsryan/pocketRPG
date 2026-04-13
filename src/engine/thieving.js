/**
 * Thieving Engine — pure logic for pickpocketing NPCs.
 * No UI imports.
 */

import { getLevelFromXP } from './experience.js'

/**
 * Create a thieving state object for a pickpocketing session.
 */
export function createThievingState(npc) {
  return {
    active: true,
    npc,
    ticksRemaining: 4, // Each pickpocket takes roughly 4 ticks (2.4 seconds)
    tickCount: 0
  }
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
  state.ticksRemaining--

  if (state.ticksRemaining <= 0) {
    // Calculate success based on level vs requirement
    // OSRS has a success rate formula, but for simplicity:
    // success_rate = 1 - (npc_level - player_thieving_level) / 100 (capped at 0-100%)
    // For now, we'll just make it always succeed for player level >= npc level
    // TODO: Implement proper OSRS success rates in future

    events.push({
      type: 'pickpocketSuccess',
      xp: state.npc.xp,
      coins: state.npc.coins || 0,
      npcName: state.npc.name,
      // Future: add drops array here for rare items
      drops: state.npc.drops || []
    })

    // Reset for next pickpocket
    state.ticksRemaining = 4
  }

  return { thievingState: state, events }
}

/**
 * Simulate idle thieving.
 * Returns { xpGained, coinsGained, actions, skill, actionName }
 */
export function simulateIdleThieving(task, elapsedMs) {
  if (!task || !task.npc) {
    console.log('[PocketRPG] simulateIdleThieving: no task or npc', task)
    return null
  }

  const TICK_MS = 600
  const TICKS_PER_ACTION = 4 // Each pickpocket takes ~4 ticks
  const totalTicks = Math.floor(elapsedMs / TICK_MS)
  const actions = Math.floor(totalTicks / TICKS_PER_ACTION)

  console.log(`[PocketRPG] simulateIdleThieving: elapsedMs=${elapsedMs}, totalTicks=${totalTicks}, actions=${actions}`)

  if (actions <= 0) {
    console.log('[PocketRPG] simulateIdleThieving: actions <= 0, returning null')
    return null
  }

  const xpGained = { thieving: task.npc.xp * actions }
  const coinsGained = (task.npc.coins || 0) * actions

  console.log(`[PocketRPG] simulateIdleThieving: npc=${task.npc.name}, xp=${xpGained.thieving}, coins=${coinsGained}`)

  return { xpGained, coinsGained, actions, skill: 'thieving', actionName: task.npc.name }
}
