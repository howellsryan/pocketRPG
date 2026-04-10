import { getLevelFromXP } from './experience.js'
import { COOKING_BURN_BASE_CHANCE } from '../utils/constants.js'

/**
 * Returns the tick-speed multiplier for a skill using the best available tool.
 * Checks both equipped weapon and inventory for the highest-tier tool the player
 * has the skill-level requirement for. Only applies if tool has matching toolFor field.
 * Bronze tools return 1.0 (no reduction).
 *
 * @param {string} skill - e.g. 'woodcutting' or 'mining'
 * @param {object} equipment - equipment state object { weapon: { itemId } | null, ... }
 * @param {object} itemsData - items.json lookup
 * @param {object} stats - stats object, e.g. { woodcutting: { xp: 0 } }
 * @param {array} inventory - inventory array (optional, used to find best tool)
 * @returns {number} multiplier, e.g. 0.9 means 10% faster (fewer ticks)
 */
export function getToolSpeedMultiplier(skill, equipment, itemsData, stats = {}, inventory = []) {
  // Try to find best available tool (equipped or in inventory)
  const bestTool = inventory && inventory.length > 0
    ? findBestToolForSkill(skill, equipment, inventory, itemsData, stats)
    : null

  let item = bestTool
  if (!item && equipment?.weapon) {
    item = itemsData[equipment.weapon.itemId]
    if (!item || item.toolFor !== skill) return 1.0
    // Check skill-level requirement
    if (item.requirements) {
      const skillXP = stats[skill]?.xp || 0
      const playerLevel = getLevelFromXP(skillXP)
      for (const [reqSkill, reqLevel] of Object.entries(item.requirements)) {
        if (reqSkill === skill && playerLevel < reqLevel) return 1.0
      }
    }
  }

  if (!item) return 1.0
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
export function canPerformAction(action, skillXP, inventory, itemsData, bank = {}, skill = null, equipment = {}, stats = {}) {
  const level = getLevelFromXP(skillXP)
  if (level < action.level) return { can: false, reason: `Requires ${action.skillName || 'skill'} level ${action.level}` }

  // Check for required tool (if skill uses tools)
  if (skill && ['mining', 'woodcutting', 'fishing'].includes(skill)) {
    if (!hasToolForSkill(skill, equipment, inventory, itemsData, stats)) {
      const toolName = skill === 'mining' ? 'pickaxe' : skill === 'woodcutting' ? 'axe' : 'rod'
      return { can: false, reason: `Need a ${toolName}` }
    }
  }

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

/**
 * Find the best tool available for a skill (equipped or in inventory)
 * Returns the tool item data that:
 * - has toolFor === skill
 * - player meets the skill-level requirement for
 * - is highest tier (highest skill requirement)
 * Returns null if no suitable tool found
 *
 * @param {string} skill - e.g. 'woodcutting' or 'mining'
 * @param {object} equipment - equipment state { weapon: { itemId } | null, ... }
 * @param {array} inventory - inventory array
 * @param {object} itemsData - items.json lookup
 * @param {object} stats - stats object with skill XP
 * @returns {object|null} best tool item data or null
 */
export function findBestToolForSkill(skill, equipment, inventory, itemsData, stats = {}) {
  const skillXP = stats[skill]?.xp || 0
  const playerLevel = getLevelFromXP(skillXP)

  const candidateTools = []

  // Check equipped weapon
  if (equipment?.weapon) {
    const item = itemsData[equipment.weapon.itemId]
    if (item && item.toolFor === skill) {
      // Check skill-level requirement
      const reqLevel = item.requirements?.[skill] || 0
      if (playerLevel >= reqLevel) {
        candidateTools.push({ ...item, tier: reqLevel })
      }
    }
  }

  // Check inventory for tools
  for (const slot of inventory) {
    if (!slot) continue
    const item = itemsData[slot.itemId]
    if (!item || item.toolFor !== skill) continue

    // Check skill-level requirement
    const reqLevel = item.requirements?.[skill] || 0
    if (playerLevel >= reqLevel) {
      // Avoid adding duplicates (e.g., if we already have equipped version)
      if (!candidateTools.some(t => t.id === item.id)) {
        candidateTools.push({ ...item, tier: reqLevel })
      }
    }
  }

  // Return the tool with highest tier (highest requirement level)
  if (candidateTools.length === 0) return null
  return candidateTools.reduce((best, current) =>
    current.tier > best.tier ? current : best
  )
}

/**
 * Check if a valid tool exists for a skill
 * @returns {boolean} true if player has a suitable tool
 */
export function hasToolForSkill(skill, equipment, inventory, itemsData, stats = {}) {
  return findBestToolForSkill(skill, equipment, inventory, itemsData, stats) !== null
}
