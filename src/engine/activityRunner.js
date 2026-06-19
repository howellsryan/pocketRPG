/**
 * Activity Runner — drives the active background task at the App level so that
 * skilling / gathering / agility / thieving / hunter keep progressing (and
 * applying XP + items) while the player is on any in-app screen, not only while
 * the activity's own screen is mounted.
 *
 * Combat is excluded (it is modal and runs on its own screen). Quests and
 * one-shot minigames already progress via the App tick and are not handled here.
 */

import { getEffectiveToolActionTicks } from './skilling.js'
import { simulateIdleSkilling, simulateIdleGather, simulateIdleAgility } from './idleEngine.js'
import { simulateIdleThieving } from './thieving.js'
import { simulateIdleHunting } from './hunter.js'
import { TICK_DURATION } from '../utils/constants.js'

const THIEVING_TICKS_PER_ACTION = 4

// Coordination flag: a mounted activity screen bumps this every tick while it is
// actively driving the current task. The App-level runner backs off while the
// timestamp is fresh so the same action is never applied twice.
let lastScreenTickAt = 0
const SCREEN_TICK_GRACE_MS = 1500

/** Called by an activity screen's tick while it is actively driving the task. */
export function markScreenTick() {
  lastScreenTickAt = Date.now()
}

/** True when a mounted screen drove the active task within the grace window. */
export function isScreenRecentlyDriving() {
  return Date.now() - lastScreenTickAt < SCREEN_TICK_GRACE_MS
}

const RUNNABLE_TYPES = new Set(['skill', 'gather', 'agility', 'thieving', 'hunter'])

/** True when the App-level runner should progress this task in the background. */
export function isRunnableBackgroundTask(task) {
  if (!task || !RUNNABLE_TYPES.has(task.type)) return false
  if (task.type === 'skill') {
    // Long-form unlocks (dungeoneering rewards) progress like quests, not here.
    if (task.action?.category === 'reward') return false
    if (!task.action) return false
  }
  if (task.type === 'gather') {
    // One-shot minigames and clue scrolls are handled by the App tick / clue flow.
    if (task.gatherTask?.oneShot || task.gatherTask?.isClue) return false
    if (!task.gatherTask) return false
  }
  if ((task.type === 'agility' || task.type === 'hunter') && !task.action) return false
  if (task.type === 'thieving' && !task.npc) return false
  return true
}

/** Effective tick cost of one action, used for the progress cadence. */
export function getActionTicksForTask(task, ctx = {}) {
  switch (task.type) {
    case 'skill':
      return Math.max(1, Math.ceil(
        getEffectiveToolActionTicks(task.skill, task.action.ticks, ctx.equipment, ctx.itemsData, ctx.stats, ctx.inventory)
      ))
    case 'gather':   return Math.max(1, Math.ceil(task.gatherTask.ticks || 1))
    case 'agility':  return Math.max(1, Math.ceil(task.action.ticks || 1))
    case 'hunter':   return Math.max(1, Math.ceil(task.action.ticks || 1))
    case 'thieving': return task.npc?.pickpocketTicks || THIEVING_TICKS_PER_ACTION
    default:         return 1
  }
}

/** Number of actions completed by a sim result (sims use `actions` or `laps`). */
export function resultActions(result) {
  if (!result) return 0
  return result.actions ?? result.laps ?? 0
}

/**
 * Simulate the task over an arbitrary elapsed window and return the sim result.
 * The App-level runner accumulates real ticks and replays them here so that
 * variable-cost steps (agility-scaled auto-bank trips) get enough time to
 * complete, instead of being starved by a fixed one-action window.
 *
 * Only call this once the accumulated window covers at least one action's ticks
 * (see getActionTicksForTask); below that the skilling/gather sims return null,
 * which is indistinguishable from running out of materials.
 */
export function simulateTaskWindow(task, elapsedMs, ctx = {}) {
  switch (task.type) {
    case 'skill':
      return simulateIdleSkilling(task, elapsedMs, ctx.bank, ctx.equipment, ctx.stats, ctx.itemsData, ctx.inventory)
    case 'gather':
      return simulateIdleGather(task, elapsedMs, ctx.inventory, ctx.stats, ctx.itemsData, ctx.bank)
    case 'agility':
      return simulateIdleAgility(task, elapsedMs)
    case 'thieving':
      return simulateIdleThieving(task, elapsedMs)
    case 'hunter':
      return simulateIdleHunting(task, elapsedMs)
    default:
      return null
  }
}
