import { getLevelFromXP } from './experience.js'
import { freeSlots, findItem, countItem } from './inventory.js'
import { COOKING_BURN_BASE_CHANCE } from '../utils/constants.js'

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
 * Held tool that shaves one game tick (~1 second) off every bow-fletching
 * action. Carrying it in the inventory or the weapon slot is enough.
 */
export const BOWYERS_KNIFE_ID = 'bowyers_knife'
export const BOWYERS_KNIFE_BOW_TICK_REDUCTION = 1

/**
 * True when a fletching action produces a bow (unstrung or strung). Every bow
 * product id contains "bow" (shortbow_u … magic_shortbow); arrows, bolts and
 * wooden stocks never do.
 */
export function isBowFletchingAction(skill, action) {
  if (skill !== 'fletching') return false
  const product = action?.product
  return typeof product === 'string' && product.includes('bow')
}

/** True when the player is carrying (inventory) or wielding a Bowyer's Knife. */
export function hasBowyersKnife(equipment = {}, inventory = []) {
  if (equipment?.weapon?.itemId === BOWYERS_KNIFE_ID) return true
  return Array.isArray(inventory) && inventory.some((s) => s && s.itemId === BOWYERS_KNIFE_ID)
}

function getToolAdjustedActionTicks(skill, safeBaseTicks, equipment, itemsData, stats, inventory) {
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
 * Returns the effective integer action ticks after applying the best available
 * tool for the skill. Pass `action` to also apply product-specific perks — the
 * Bowyer's Knife shaves one tick off fletching-bow actions.
 */
export function getEffectiveToolActionTicks(skill, baseTicks, equipment, itemsData, stats = {}, inventory = [], action = null) {
  const safeBaseTicks = Math.max(1, Math.floor(Number(baseTicks) || 1))
  const toolTicks = getToolAdjustedActionTicks(skill, safeBaseTicks, equipment, itemsData, stats, inventory)

  if (isBowFletchingAction(skill, action) && hasBowyersKnife(equipment, inventory)) {
    return Math.max(1, toolTicks - BOWYERS_KNIFE_BOW_TICK_REDUCTION)
  }
  return toolTicks
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
  }
}

/**
 * True when a full inventory blocks this action from completing during active
 * (live/background) play — i.e. its next output has nowhere to go. When true the
 * driver holds the action and raises the global "inventory full" prompt instead
 * of completing it; the check is re-evaluated each tick so the action resumes on
 * its own once a slot frees up.
 *
 * Not blocked when: the action has no inventory-bound output (alchemy banks
 * coins; material-only actions produce nothing), any free slot exists, the
 * product stacks onto an existing slot, or a consumed material sits in the
 * inventory (using it frees a slot for the product).
 */
export function skillingActionBlockedByFullInventory(action, inventory = [], itemsData = {}) {
  if (!action) return false
  if (action.type === 'alchemy') return false
  const producesToInventory = !!(action.product || action.dropTable)
  if (!producesToInventory) return false
  if (freeSlots(inventory) > 0) return false
  if (action.product && itemsData[action.product]?.stackable && findItem(inventory, action.product) !== -1) return false
  if (action.materials) {
    for (const matId of Object.keys(action.materials)) {
      if (countItem(inventory, matId) > 0) return false
    }
  }
  return true
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
      // A scale-charged tool (e.g. shardglass) with no charges left provides
      // no bonus at all — it doesn't count as a candidate until recharged.
      const chargesOk = !item.scaleCharged || (equipment.weapon.charges || 0) > 0
      if (playerLevel >= reqLevel && chargesOk) {
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
    const chargesOk = !item.scaleCharged || (slot.charges || 0) > 0
    if (playerLevel >= reqLevel && chargesOk) {
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

/**
 * Shardglass gathering perk. The shardglass axe/pickaxe are scale-charged
 * tools (`scaleCharged: true`, `chargeItemId: shardglass_shards`) — charges
 * are loaded via the normal charge UI, same as any other scale-charged
 * weapon. While gathering with the matching shardglass tool, each action
 * consumes SHARDGLASS_SHARDS_PER_GATHER charges from the tool itself (not
 * loose shards from the inventory) and doubles the gathered output (ore,
 * gems, logs). Bonus drops added afterwards (e.g. bird's nests) are
 * unaffected. Once the tool runs out of charges it stops counting as a
 * candidate tool at all (see findBestToolForSkill), so both the doubling and
 * its gathering-speed bonus are lost until it's recharged.
 */
export const SHARDGLASS_SHARDS_PER_GATHER = 2
export const SHARDGLASS_GATHER_TOOLS = {
  mining: 'shardglass_pickaxe',
  woodcutting: 'shardglass_axe',
}

/** True when the best available tool for `skill` is its shardglass tool. */
export function usesShardglassGatherTool(skill, equipment, inventory, itemsData, stats = {}) {
  const toolId = SHARDGLASS_GATHER_TOOLS[skill]
  if (!toolId) return false
  const best = findBestToolForSkill(skill, equipment, inventory, itemsData, stats)
  return best?.id === toolId
}

/**
 * Resolves which copy of the shardglass tool for `skill` is actually in play
 * — mirrors findBestToolForSkill's own resolution: the equipped copy wins
 * only while it still has charges, otherwise a charged spare in the
 * inventory takes over (a depleted equipped tool is exactly as unusable as
 * not holding it). Returns { equipped, charges, inventoryIndex }; charges is
 * 0 and inventoryIndex is -1 when the tool isn't carried at all.
 */
export function resolveShardglassToolSource(skill, equipment, inventory) {
  const toolId = SHARDGLASS_GATHER_TOOLS[skill]
  if (!toolId) return { equipped: false, charges: 0, inventoryIndex: -1 }
  if (equipment?.weapon?.itemId === toolId && (equipment.weapon.charges || 0) > 0) {
    return { equipped: true, charges: equipment.weapon.charges || 0, inventoryIndex: -1 }
  }
  const inventoryIndex = inventory ? inventory.findIndex(s => s && s.itemId === toolId) : -1
  const charges = inventoryIndex !== -1 ? (inventory[inventoryIndex].charges || 0) : 0
  return { equipped: false, charges, inventoryIndex }
}

/** Current charges on the shardglass tool for `skill` — equipped or held in inventory — or 0 if not carried. */
export function getShardglassToolCharges(skill, equipment, inventory) {
  return resolveShardglassToolSource(skill, equipment, inventory).charges
}

/**
 * Doubles every quantity in `drops` (mutated in place) when at least
 * SHARDGLASS_SHARDS_PER_GATHER charges remain, returning the charge total
 * left after the action (unchanged when there weren't enough to fire). Pure
 * on the charge count itself — callers own persisting the result back onto
 * the tool (equipped weapon or inventory slot).
 */
export function consumeShardglassGatherCharge(drops, currentCharges) {
  if (currentCharges < SHARDGLASS_SHARDS_PER_GATHER) return currentCharges
  for (const itemId of Object.keys(drops)) drops[itemId] *= 2
  return currentCharges - SHARDGLASS_SHARDS_PER_GATHER
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
