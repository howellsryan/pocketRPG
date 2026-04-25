/**
 * Hunter Engine — pure logic for hunting actions.
 * No UI imports.
 */

import { getLevelFromXP } from './experience.js'

export function createHunterState(action) {
  return {
    active: true,
    action,
    ticksRemaining: action.ticks,
    tickCount: 0,
    justCompleted: false
  }
}

export function processHunterTick(hunterState) {
  const state = { ...hunterState }
  const events = []
  state.tickCount++

  if (state.justCompleted) {
    state.ticksRemaining = state.action.ticks
    state.justCompleted = false
  } else {
    state.ticksRemaining--
  }

  if (state.ticksRemaining <= 0) {
    const rewards = rollHunterRewards(state.action)

    events.push({
      type: 'hunterSuccess',
      xp: state.action.xp,
      rewards,
      actionName: state.action.name
    })

    state.justCompleted = true
  }

  return { hunterState: state, events }
}

function rollHunterRewards(action) {
  const results = []

  if (!action.rewardTables) return results

  for (const table of action.rewardTables) {
    const roll = Math.random()
    let cumulative = 0

    for (const reward of table.rewards) {
      cumulative += reward.chance
      if (roll <= cumulative) {
        results.push({
          itemId: reward.itemId,
          quantity: typeof reward.quantity === 'object'
            ? Math.floor(Math.random() * (reward.quantity[1] - reward.quantity[0] + 1)) + reward.quantity[0]
            : reward.quantity
        })
        break
      }
    }
  }

  return results
}

export function simulateIdleHunting(task, elapsedMs) {
  if (!task || !task.action) return null

  const TICK_MS = 600
  const totalTicks = Math.floor(elapsedMs / TICK_MS)
  const actions = Math.floor(totalTicks / task.action.ticks)

  if (actions <= 0) return null

  const xpGained = { hunter: task.action.xp * actions }
  const rewards = []

  for (let i = 0; i < actions; i++) {
    const actionRewards = rollHunterRewards(task.action)
    for (const reward of actionRewards) {
      const existing = rewards.find(r => r.itemId === reward.itemId)
      if (existing) {
        existing.quantity += reward.quantity
      } else {
        rewards.push({ ...reward })
      }
    }
  }

  return { xpGained, rewards, actions, skill: 'hunter', actionName: task.action.name }
}
