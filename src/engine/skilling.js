import { getLevelFromXP } from './experience.js'
import { addItem, canFit } from './inventory.js'
import {
  COOKING_BURN_BASE_CHANCE, GATHERING_SKILLS, IDLE_AUTOBANK_GATHERING_SKILLS,
  GATHER_AUTOBANK_CONSTRUCTION_LEVEL,
} from '../utils/constants.js'

/**
 * Gathering skills that can use a tool. These actions can always be performed —
 * even bare-handed — but holding a suitable tool grants a faster catch time.
 */
export const TOOL_SKILLS = ['mining', 'woodcutting', 'fishing']

/**
 * Action-time penalty applied to a tool-using skill when the player has no
 * suitable tool. Bare-handed gathering takes this many times the base (basic
 * tool) action time, so any tool — including the basic tier — is faster.
 */
export const NO_TOOL_ACTION_TICK_MULTIPLIER = 2


/**
 * Woodcutting axe speed progression.
 *
 * The value is the share of the maximum possible per-action tick reduction.
 * Maximum reduction is half the base action time, rounded down to game-tick
 * granularity.
 */
export const WOODCUTTING_AXE_REDUCTION_TIERS = {
  bronze_axe: 0.00,
  iron_axe: 0.10,
  steel_axe: 0.20,
  black_axe: 0.30,
  mithril_axe: 0.45,
  adamant_axe: 0.60,
  runeforged_axe: 0.75,
  dragon_axe: 0.88,
  infernal_axe: 0.94,
  shardglass_axe: 1.00,
  third_age_axe: 1.00,
  '2nd_age_axe': 1.00,
}

/**
 * Legacy multiplier map retained for callers or item data that still expect a
 * multiplier. New woodcutting timing should use getEffectiveToolActionTicks().
 */
export const WOODCUTTING_AXE_SPEED_MULTIPLIERS = {
  bronze_axe: 1.00,
  iron_axe: 0.90,
  steel_axe: 0.85,
  black_axe: 0.80,
  mithril_axe: 0.75,
  adamant_axe: 0.70,
  runeforged_axe: 0.62,
  dragon_axe: 0.56,
  infernal_axe: 0.53,
  shardglass_axe: 0.50,
  third_age_axe: 0.50,
  '2nd_age_axe': 0.50,
}

export function getConfiguredToolSpeedMultiplier(skill, item) {
  if (!item) return 1.0
  if (skill === 'woodcutting') {
    const configured = WOODCUTTING_AXE_SPEED_MULTIPLIERS[item.id]
    if (configured != null) return configured
  }
  return item.speedMultiplier ?? 1.0
}

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
  return getConfiguredToolSpeedMultiplier(skill, item)
}

/**
 * Returns the effective integer action ticks after applying the best available
 * tool for the skill.
 */
export function getEffectiveToolActionTicks(skill, baseTicks, equipment, itemsData, stats = {}, inventory = []) {
  const safeBaseTicks = Math.max(1, Math.floor(Number(baseTicks) || 1))

  // Tool-using gathering skills can always be performed; bare-handed is slower
  // than holding even the basic tier of tool.
  if (TOOL_SKILLS.includes(skill)) {
    const bestTool = findBestToolForSkill(skill, equipment, inventory, itemsData, stats)
    if (!bestTool) {
      return Math.max(1, Math.floor(safeBaseTicks * NO_TOOL_ACTION_TICK_MULTIPLIER))
    }

    if (skill === 'woodcutting') {
      const tier = WOODCUTTING_AXE_REDUCTION_TIERS[bestTool.id]

      if (typeof tier === 'number') {
        if (tier <= 0) return safeBaseTicks

        const bestPossibleTicks = Math.max(1, Math.floor(safeBaseTicks / 2))
        const maxReductionTicks = safeBaseTicks - bestPossibleTicks

        if (maxReductionTicks <= 0) return safeBaseTicks

        const reductionTicks = tier >= 1
          ? maxReductionTicks
          : Math.max(1, Math.ceil(maxReductionTicks * tier))

        return Math.max(bestPossibleTicks, safeBaseTicks - reductionTicks)
      }
    }
  }

  const multiplier = getToolSpeedMultiplier(skill, equipment, itemsData, stats, inventory)
  return Math.max(1, Math.floor(safeBaseTicks * multiplier))
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
    totalDungeoneeringTokens: 0,
    stopped: false,
    justCompleted: false,  // flag to delay reset to next tick
    bankDelayTicksRemaining: 0, // >0 while an auto-bank trip holds the action
  }
}

/**
 * Whether a skill auto-banks its output when the inventory fills during live or
 * idle skilling (vs. stopping the action). Mirrors idleEngine's rule so live and
 * idle behave identically: production skills always bank; mining/woodcutting/
 * fishing always bank; other gatherers (farming) require the Construction unlock.
 */
export function skillAutoBanksWhenFull(skill, stats = {}) {
  if (!GATHERING_SKILLS.includes(skill)) return true
  if (IDLE_AUTOBANK_GATHERING_SKILLS.includes(skill)) return true
  return getLevelFromXP(stats?.construction?.xp || 0) >= GATHER_AUTOBANK_CONSTRUCTION_LEVEL
}

/**
 * Deposit a completed action's output ({ itemId: qty }) into the inventory,
 * banking the whole inventory first when it can't fit. Mutates `inventory`.
 *
 * Returns:
 *   - { stopped: true } when the inventory is full and auto-bank is disabled —
 *     nothing was deposited; the caller must stop the action.
 *   - { bankTrip: true, banked } when a bank trip cleared the inventory; `banked`
 *     is the { itemId: qty } map moved to the bank. The caller applies the
 *     agility-scaled delay.
 *   - {} on a normal deposit with room to spare.
 */
export function depositSkillingOutput(inventory, drops, itemsData = {}, autoBank = true) {
  if (canFit(inventory, drops, itemsData)) {
    for (const [itemId, qty] of Object.entries(drops)) {
      if (qty > 0) addItem(inventory, itemId, qty, itemsData[itemId]?.stackable || false)
    }
    return {}
  }
  if (!autoBank) return { stopped: true }

  const banked = {}
  for (let i = 0; i < inventory.length; i++) {
    if (!inventory[i]) continue
    banked[inventory[i].itemId] = (banked[inventory[i].itemId] || 0) + inventory[i].quantity
    inventory[i] = null
  }
  for (const [itemId, qty] of Object.entries(drops)) {
    if (qty > 0) addItem(inventory, itemId, qty, itemsData[itemId]?.stackable || false)
  }
  return { bankTrip: true, banked }
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

  // Bank-trip pause: after an auto-bank on a full inventory, the action is held
  // for an agility-scaled delay (mirrors idle skilling's bank-trip time cost)
  // before the next action resumes.
  if (state.bankDelayTicksRemaining > 0) {
    state.bankDelayTicksRemaining--
    if (state.bankDelayTicksRemaining <= 0) events.push({ type: 'bankTripComplete', skill: state.skill })
    return { skillingState: state, events }
  }

  // Check justCompleted FIRST to reset before checking for new completion
  if (state.justCompleted) {
    state.ticksRemaining = state.action.ticks
    state.justCompleted = false
  } else {
    state.ticksRemaining--
  }

  if (state.ticksRemaining <= 0) {
    // Action completed — mark for reset on next tick so progress bar shows 100%
    state.totalActions++
    state.totalXP += state.action.xp

    events.push({
      type: 'actionComplete',
      skill: state.skill,
      action: state.action,
      xp: state.action.xp,
      product: state.action.product || null
    })

    state.justCompleted = true
  }

  return { skillingState: state, events }
}

/**
 * Check if player can perform this skilling action
 */
export function canPerformAction(action, skillXP, inventory, itemsData, bank = {}, skill = null, equipment = {}, stats = {}) {
  const level = getLevelFromXP(skillXP)
  if (level < action.level) return { can: false, reason: `Requires ${action.skillName || 'skill'} level ${action.level}` }

  // Tool-using gathering skills (mining/woodcutting/fishing) no longer require a
  // tool — the action can always be performed, just slower bare-handed. Tool
  // speed is applied via getEffectiveToolActionTicks().

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
        candidateTools.push({ ...item, id: equipment.weapon.itemId, tier: reqLevel })
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
      if (!candidateTools.some(t => t.id === slot.itemId)) {
        candidateTools.push({ ...item, id: slot.itemId, tier: reqLevel })
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

/**
 * Bird's nest bonus drop. Woodcutting actions have a flat chance, identical for
 * every tree, of yielding an empty bird's nest in addition to the logs.
 */
export const BIRD_NEST_ITEM_ID = 'empty_bird_s_nest'
export const BIRD_NEST_DROP_CHANCE = 1 / 256

/**
 * Roll for bonus gather drops awarded alongside the primary product of a
 * gathering action. Currently only woodcutting (bird's nests). Returns a drops
 * map ({ itemId: qty }) that may be empty.
 *
 * @param {string} skill - gathering skill id, e.g. 'woodcutting'
 * @param {() => number} [rng] - injectable RNG for tests (defaults to Math.random)
 * @returns {Record<string, number>}
 */
export function rollGatherBonusDrops(skill, rng = Math.random) {
  const drops = {}
  if (skill === 'woodcutting' && rng() < BIRD_NEST_DROP_CHANCE) {
    drops[BIRD_NEST_ITEM_ID] = 1
  }
  return drops
}

export function getEquippedSkillXpMultiplier(skill, equipment, itemsData) {
  if (!equipment?.weapon) return 1
  const weapon = itemsData?.[equipment.weapon.itemId]
  if (!weapon) return 1
  if (skill === 'fishing') {
    const pct = Number(weapon.otherBonus?.fishingXpPercent || 0)
    if (pct > 0) return 1 + (pct / 100)
  }
  return 1
}
