import { getLevelFromXP } from './experience.js'
import { COOKING_BURN_BASE_CHANCE } from '../utils/constants.js'

/**
 * Returns the tick-speed multiplier for a skill given the equipped weapon.
 * Only applies when the weapon has a matching toolFor field AND the player meets
 * the skill-level requirement. Bronze tools return 1.0 (no reduction).
 *
 * @param {string} skill - e.g. 'woodcutting' or 'mining'
 * @param {object} equipment - equipment state object { weapon: { itemId } | null, ... }
 * @param {object} itemsData - items.json lookup
 * @param {object} stats - stats object, e.g. { woodcutting: { xp: 0 } }
 * @returns {number} multiplier, e.g. 0.9 means 10% faster (fewer ticks)
 */
export function getToolSpeedMultiplier(skill, equipment, itemsData, stats = {}) {
  if (!equipment?.weapon) return 1.0
  const item = itemsData[equipment.weapon.itemId]
  if (!item || item.toolFor !== skill) return 1.0

  // Check skill-level requirement on the tool (e.g. mithril axe needs wc 20)
  if (item.requirements) {
    const skillXP = stats[skill]?.xp || 0
    const playerLevel = getLevelFromXP(skillXP)
    for (const [reqSkill, reqLevel] of Object.entries(item.requirements)) {
      if (reqSkill === skill && playerLevel < reqLevel) return 1.0
    }
  }

  return item.speedMultiplier ?? 1.0
}

/**
 * Create a skilling session state
 */
export function createSkillingState(skill, action) {
  return {
    active: true,
    skill,             // e.g. 'mining'
    action,            // action object from skills data { id, name, level, ticks, xp, product, ... }
    ticksRemaining: action.ticks,
    totalActions: 0,
    totalXP: 0,
    stopped: false
  }
}

/**
 * Process one skilling tick.
 * Returns { skillingState, events[] }
 * events: { type: 'actionComplete'|'inventoryFull'|'xp'|'levelUp'|'burned', ... }
 */
export function processSkillingTick(skillingState) {
  const state = { ...skillingState }
  const events = []

  if (!state.active || state.stopped) return { skillingState: state, events }

  state.ticksRemaining--

  if (state.ticksRemaining <= 0) {
    // Action completed
    state.totalActions++
    state.totalXP += state.action.xp

    events.push({
      type: 'actionComplete',
      skill: state.skill,
      action: state.action,
      xp: state.action.xp,
      product: state.action.product || null
    })

    // Reset for next action
    state.ticksRemaining = state.action.ticks
  }

  return { skillingState: state, events }
}

/**
 * Check if player can perform this skilling action
 */
export function canPerformAction(action, skillXP, inventory, itemsData, bank = {}) {
  const level = getLevelFromXP(skillXP)
  if (level < action.level) return { can: false, reason: `Requires ${action.skillName || 'skill'} level ${action.level}` }

  // Check required materials (inventory + bank combined)
  if (action.materials) {
    for (const [itemId, qty] of Object.entries(action.materials)) {
      const invCount = inventory.filter(s => s && s.itemId === itemId).reduce((sum, s) => sum + s.quantity, 0)
      const bankCount = bank[itemId]?.quantity || 0
      if (invCount + bankCount < qty) {
        const item = itemsData[itemId]
        return { can: false, reason: `Need ${qty} ${item?.name || itemId}` }
      }
    }
  }

  return { can: true }
}

/**
 * Check if food burns during cooking
 * Burn chance decreases linearly from base to 0 at burnStopLevel
 */
export function checkBurn(cookingLevel, recipe) {
  if (!recipe.burnStopLevel) return false
  if (cookingLevel >= recipe.burnStopLevel) return false

  const range = recipe.burnStopLevel - recipe.level
  const progress = cookingLevel - recipe.level
  const burnChance = COOKING_BURN_BASE_CHANCE * (1 - progress / range)
  return Math.random() < burnChance
}

/**
 * Get available actions for a skill at a given level
 */
export function getAvailableActions(skillActions, skillXP) {
  const level = getLevelFromXP(skillXP)
  return skillActions.filter(a => a.level <= level)
}
