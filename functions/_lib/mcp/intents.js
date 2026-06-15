// Phase C save intents: pure, deterministic mutations of a decoded saveObject,
// composed from the proven server-side game helpers + the pure engine. Each
// throws a GameApiError on an invalid request and otherwise mutates the save in
// place, returning a small summary. Callers apply them between
// loadCharacterWithSave and writeSave, so a throw means nothing is persisted
// (atomic by construction). No value is created here — items only move between
// inventory, bank and equipment.

import itemsData from '../../../src/data/items.json' assert { type: 'json' }
import monstersData from '../../../src/data/monsters.json' assert { type: 'json' }
import prayersData from '../../../src/data/prayers.json' assert { type: 'json' }
import { GameApiError } from '../game/errors.js'
import {
  canonicalItemId,
  normalizeSaveItemIds,
  getInventory,
  addItemToInventory,
  removeItemFromInventory,
  addItemToBank,
  removeItemFromBank,
  bankQuantity,
} from '../game/inventory.js'
import { equipItem, unequipSlot, checkEquipRequirements, createEquipment } from '../../../src/engine/equipment.js'
import { getLevelFromXP } from '../../../src/engine/experience.js'
import { simulateIdleSkilling, simulateIdleAgility, simulateIdleCombat, simulateIdleGather } from '../../../src/engine/idleEngine.js'
import { GATHER_TASKS, findGatherTask } from '../../../src/engine/gatherTasks.js'
import { normaliseIdleCombatSetup, defaultIdleCombatSetup, isFoodItem, isPotionItem, getFoodHealAmount } from '../../../src/engine/idleSupplies.js'
import { simulateIdleThieving } from '../../../src/engine/thieving.js'
import { simulateIdleHunting } from '../../../src/engine/hunter.js'
import { applyTaskResult } from '../../../src/engine/applyTaskResult.js'
import skillsData from '../../../src/data/skills.json' assert { type: 'json' }
import { getDungeoneeringRewardCost } from '../../../src/engine/dungeoneeringTokens.js'
import { SLAYER_MASTERS, pickSlayerMonster, buildSlayerTask } from '../../../src/engine/slayerMasters.js'
import { SLAYER_TASK_SKIP_POINT_COST } from '../../../src/engine/slayerTasks.js'
import { getSlayerTaskReward } from '../../../src/engine/slayerRewards.js'
import questsData from '../../../src/data/quests.json' assert { type: 'json' }
import { checkQuestEligibility, getQuestPointsEarned, getCombatLevel } from '../../../src/engine/quests.js'
import { createQueuedQuestTask, simulateQuestIdleCascade, splitQuestXpRewards } from '../../../src/engine/questIdleCascade.js'
import { PRODUCTION_SKILLS, IDLE_AUTOBANK_GATHERING_SKILLS, COMBAT_SKILLS, ALL_SKILLS, TICK_DURATION, QUEST_QUEUE_MAX } from '../../../src/utils/constants.js'

const XP_CAP = 200000000

const EQUIPMENT_SLOTS = new Set(Object.keys(createEquipment()))

function resolveItem(rawItemId) {
  if (!rawItemId || typeof rawItemId !== 'string') throw new GameApiError('INVALID_ITEM_ID', 'Invalid item_id', 400)
  const itemId = canonicalItemId(itemsData, rawItemId)
  const item = itemsData[itemId] || itemsData[rawItemId]
  if (!item) throw new GameApiError('ITEM_NOT_FOUND', `No item with id '${rawItemId}'`, 404)
  return { itemId, item }
}

function isStackable(itemId) {
  return !!itemsData[itemId]?.stackable
}

export function depositToBank(save, rawItemId, quantity) {
  normalizeSaveItemIds(save, itemsData)
  const { itemId } = resolveItem(rawItemId)
  removeItemFromInventory(save, itemId, quantity) // throws if not enough in inventory
  addItemToBank(save, itemId, quantity)
  return { action: 'deposit', itemId, name: itemsData[itemId]?.name || itemId, quantity: Math.floor(Number(quantity)) }
}

export function withdrawFromBank(save, rawItemId, quantity) {
  normalizeSaveItemIds(save, itemsData)
  const { itemId } = resolveItem(rawItemId)
  removeItemFromBank(save, itemId, quantity) // throws if not enough in bank
  addItemToInventory(save, itemId, quantity, { stackable: isStackable(itemId) }) // throws if inventory full
  return { action: 'withdraw', itemId, name: itemsData[itemId]?.name || itemId, quantity: Math.floor(Number(quantity)) }
}

// Put an unequipped equipment entry back into the inventory, preserving ammo
// quantity and weapon charges. Respects the 28-slot cap.
function returnEntryToInventory(save, entry) {
  const inv = getInventory(save)
  const itemId = entry.itemId
  if (isStackable(itemId)) {
    const qty = Math.floor(Number(entry.quantity) || 1)
    const existing = inv.find((s) => s?.itemId === itemId && !s.noted)
    if (existing) { existing.quantity = (Number(existing.quantity) || 0) + qty; return }
    if (inv.length >= 28) throw new GameApiError('INVENTORY_FULL', 'Inventory is full', 409)
    inv.push({ itemId, quantity: qty })
    return
  }
  if (inv.length >= 28) throw new GameApiError('INVENTORY_FULL', 'Inventory is full', 409)
  const slot = { itemId, quantity: 1 }
  if (entry.charges && entry.charges > 0) slot.charges = entry.charges
  inv.push(slot)
}

export function equip(save, rawItemId) {
  normalizeSaveItemIds(save, itemsData)
  const { itemId, item } = resolveItem(rawItemId)
  if (!item.slot || !EQUIPMENT_SLOTS.has(item.slot)) {
    throw new GameApiError('NOT_EQUIPPABLE', `${item.name || itemId} cannot be equipped`, 400)
  }

  const inv = getInventory(save)
  const owned = inv.filter((s) => s?.itemId === itemId)
  if (owned.length === 0) throw new GameApiError('NOT_IN_INVENTORY', `${item.name || itemId} is not in the inventory`, 400)

  const completedQuests = new Set(Array.isArray(save.settings?.completedQuests) ? save.settings.completedQuests : [])
  const reqError = checkEquipRequirements(item, save.stats || {}, completedQuests)
  if (reqError) {
    const msg = reqError.reason === 'skill'
      ? `Requires ${reqError.skill} ${reqError.required} (you have ${reqError.current})`
      : `Requires the quest '${reqError.questUnlock}'`
    throw new GameApiError('EQUIP_REQUIREMENT', msg, 400)
  }

  if (!save.equipment || typeof save.equipment !== 'object') save.equipment = createEquipment()

  // Ammo equips the whole stack; everything else equips one.
  const isAmmo = item.slot === 'ammo'
  const available = owned.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0)
  const equipQty = isAmmo ? available : 1
  const sourceSlot = isAmmo ? { ...owned[0], quantity: available } : owned[0]

  const result = equipItem(save.equipment, item, itemsData, sourceSlot)
  if (!result.equipped) {
    const reason = result.reason === 'wrong_ammo_type' ? 'That ammo is not compatible with the equipped weapon' : 'Item cannot be equipped'
    throw new GameApiError('EQUIP_FAILED', reason, 400)
  }

  // Free the equipped item first (so swaps stay within the 28-slot cap), then
  // return anything that was unequipped.
  removeItemFromInventory(save, itemId, equipQty)
  for (const entry of result.unequipped) if (entry) returnEntryToInventory(save, entry)

  return {
    action: 'equip',
    slot: item.slot,
    itemId,
    name: item.name || itemId,
    unequipped: result.unequipped.filter(Boolean).map((e) => ({ itemId: e.itemId, name: itemsData[e.itemId]?.name || e.itemId })),
  }
}

export function unequip(save, slot) {
  if (!EQUIPMENT_SLOTS.has(slot)) throw new GameApiError('INVALID_SLOT', `Invalid equipment slot '${slot}'`, 400)
  const entry = save.equipment?.[slot]
  if (!entry) throw new GameApiError('NOTHING_EQUIPPED', `Nothing equipped in the ${slot} slot`, 400)
  returnEntryToInventory(save, entry) // throws if inventory full (before clearing the slot)
  unequipSlot(save.equipment, slot)
  return { action: 'unequip', slot, itemId: entry.itemId, name: itemsData[entry.itemId]?.name || entry.itemId }
}

export const EQUIP_SLOT_NAMES = [...EQUIPMENT_SLOTS]

// ── Idle activities (Phase C increments 2-3) ─────────────────────────────────
// Skills the idle engine drives via simulateIdleSkilling (type:'skill'):
// the three gathering skills (woodcutting/mining/fishing — auto-bank + tool
// speed handled inside the simulator) plus the production skills.
export const SKILL_IDLE_SKILLS = new Set([...IDLE_AUTOBANK_GATHERING_SKILLS, ...PRODUCTION_SKILLS, 'dungeoneering'])

// All non-combat skills an agent can train via MCP, including the three with
// their own simulators (agility/thieving/hunter). Combat, farming, prayer,
// magic, construction, dungeoneering and slayer use other systems.
export const SUPPORTED_IDLE_SKILLS = [...SKILL_IDLE_SKILLS, 'agility', 'thieving', 'hunter']

const SUPPORTED_IDLE_TYPES = new Set(['skill', 'agility', 'thieving', 'hunter', 'quest', 'combat', 'gather'])

export function isClaimableTask(task) {
  if (!task || !SUPPORTED_IDLE_TYPES.has(task.type)) return false
  if (task.type === 'skill') return SKILL_IDLE_SKILLS.has(task.skill)
  if (task.type === 'gather') return !task.gatherTask?.isClue && !task.gatherTask?.oneShot
  return true
}

// IDs for gather tasks that are safe to idle via MCP (no GP cost, not clue/oneShot).
export const GATHER_TASK_IDS = GATHER_TASKS
  .filter((t) => !t.isClue && !t.oneShot && !t.gpCost)
  .map((t) => t.id)

// Build (and validate) a type:'gather' idle task.
export function buildGatherTask(_save, taskId) {
  const gatherTask = findGatherTask(taskId)
  if (!gatherTask) {
    throw new GameApiError('UNKNOWN_GATHER_TASK', `No gather task with id '${taskId}'. Valid ids: ${GATHER_TASK_IDS.join(', ')}.`, 400)
  }
  if (gatherTask.isClue) {
    throw new GameApiError('CLUE_NOT_SUPPORTED', `'${gatherTask.name}' is a clue scroll task — complete clues in the game client.`, 400)
  }
  if (gatherTask.oneShot) {
    throw new GameApiError('ONE_SHOT_NOT_SUPPORTED', `'${gatherTask.name}' is a one-shot minigame task — complete it in the game client.`, 400)
  }
  if (gatherTask.gpCost) {
    throw new GameApiError('GP_COST_NOT_SUPPORTED', `'${gatherTask.name}' costs ${gatherTask.gpCost} GP per action which is not yet tracked by the MCP idle engine. Use the game client.`, 400)
  }
  return { type: 'gather', gatherTask }
}

function findSkillEntry(skill, key, id) {
  const list = Array.isArray(skillsData[skill]?.[key]) ? skillsData[skill][key] : []
  const entry = list.find((e) => e.id === id)
  if (!entry) throw new GameApiError('UNKNOWN_ACTION', `Unknown ${skill} option '${id}'. See pocketrpg://reference/skills.`, 400)
  return entry
}

function requireSkillLevel(save, skill, entry) {
  const level = getLevelFromXP(Number(save.stats?.[skill]?.xp) || 0)
  if (entry.level && level < entry.level) {
    throw new GameApiError('LEVEL_TOO_LOW', `${skill} ${entry.level} required (you have ${level})`, 400)
  }
}

// Build (and validate) a type:'skill' idle task — production + gathering.
export function buildSkillTask(save, skill, actionId) {
  if (!SKILL_IDLE_SKILLS.has(skill)) {
    throw new GameApiError('UNSUPPORTED_SKILL', `'${skill}' is not a simulateIdleSkilling skill.`, 400)
  }
  const action = findSkillEntry(skill, 'actions', actionId)
  // Dungeoneering 'reward' actions spend tokens to unlock gear — they don't idle.
  if (action.category === 'reward') {
    throw new GameApiError('USE_REWARD_CLAIM', `'${actionId}' is a reward unlock, not an idle action. Use claim_dungeoneering_reward.`, 400)
  }
  requireSkillLevel(save, skill, action)
  return { type: 'skill', skill, action, bankingEnabled: true }
}

// Build any supported idle task from skills.json, gated on the level requirement.
export function buildIdleTask(save, skill, actionId) {
  if (SKILL_IDLE_SKILLS.has(skill)) return buildSkillTask(save, skill, actionId)
  if (skill === 'agility') {
    const action = findSkillEntry('agility', 'actions', actionId)
    requireSkillLevel(save, 'agility', action)
    return { type: 'agility', action }
  }
  if (skill === 'thieving') {
    const npc = findSkillEntry('thieving', 'npcs', actionId)
    requireSkillLevel(save, 'thieving', npc)
    return { type: 'thieving', npc }
  }
  if (skill === 'hunter') {
    const action = findSkillEntry('hunter', 'actions', actionId)
    requireSkillLevel(save, 'hunter', action)
    return { type: 'hunter', action }
  }
  throw new GameApiError(
    'UNSUPPORTED_SKILL',
    `Idle training via MCP supports: ${SUPPORTED_IDLE_SKILLS.join(', ')}.`,
    400,
  )
}

// Decoded save inventory (compact occupied-slot array) → the fixed 28-slot
// array (null-padded) the idle engine expects.
export function toSlotArray(save) {
  const arr = new Array(28).fill(null)
  const inv = Array.isArray(save.inventory) ? save.inventory : []
  let i = 0
  for (const slot of inv) {
    if (!slot || typeof slot !== 'object') continue
    const itemId = slot.itemId ?? slot.id
    const quantity = Math.floor(Number(slot.quantity) || 0)
    if (!itemId || quantity < 1 || i >= 28) continue
    arr[i++] = { ...slot, itemId, quantity }
  }
  return arr
}

const named = (obj) => Object.entries(obj || {}).map(([itemId, quantity]) => ({ itemId, name: itemsData[itemId]?.name || itemId, quantity }))

// Helper: build the normalised state, call applyTaskResult, and write back any
// fields that may have been replaced (inventory is always a new array after
// toSlotArray; the others are shared references so mutations propagate).
function applyToSave(save, sim, type) {
  if (!save.stats || typeof save.stats !== 'object') save.stats = {}
  if (!save.bank || typeof save.bank !== 'object') save.bank = {}
  if (!save.equipment || typeof save.equipment !== 'object') save.equipment = {}
  if (!save.settings || typeof save.settings !== 'object') save.settings = {}
  const inv28 = toSlotArray(save)
  const state = { stats: save.stats, inventory: inv28, bank: save.bank, equipment: save.equipment, settings: save.settings }
  const result = applyTaskResult(state, sim, type)
  save.inventory = state.inventory  // may be sim.finalInventory or modified inv28
  return result
}

// Apply an idle simulation result to the save. Kept for backward compatibility
// with existing callers; delegates to the shared applyTaskResult.
export function applyIdleResult(save, sim, type) {
  const result = applyToSave(save, sim, type)
  return {
    skill: sim.skill,
    action: sim.actionName,
    actions: sim.actions || sim.laps || 0,
    xpGained: sim.xpGained || {},
    coinsGained: Number(sim.coinsGained) || 0,
    itemsBanked: named(result.banked),
    rewards: type === 'hunter'
      ? (sim.rewards || []).map((r) => ({ itemId: r.itemId, name: itemsData[r.itemId]?.name || r.itemId, quantity: r.quantity }))
      : undefined,
    itemsConsumed: named(sim.itemsConsumed),
    stoppedReason: sim.stoppedReason || null,
  }
}

// Run the right idle simulator for the task type and apply it. Pure over the
// save (no DB); the caller persists.
export function runIdleTask(save, task, elapsedMs) {
  if (!save.stats || typeof save.stats !== 'object') save.stats = {}
  if (!save.bank || typeof save.bank !== 'object') save.bank = {}
  if (!save.equipment || typeof save.equipment !== 'object') save.equipment = {}
  if (!save.settings || typeof save.settings !== 'object') save.settings = {}
  const inv28 = toSlotArray(save)
  let sim = null
  switch (task.type) {
    case 'skill':
      sim = simulateIdleSkilling(task, elapsedMs, save.bank, save.equipment, save.stats, itemsData, inv28)
      break
    case 'agility':
      sim = simulateIdleAgility(task, elapsedMs)
      break
    case 'thieving':
      sim = simulateIdleThieving(task, elapsedMs)
      break
    case 'hunter':
      sim = simulateIdleHunting(task, elapsedMs)
      break
    case 'gather':
      sim = simulateIdleGather(task, elapsedMs, inv28, save.stats || {}, itemsData, save.bank || {})
      break
    default:
      return { applied: false, reason: 'unsupported_type' }
  }
  if (!sim) return { applied: false, reason: 'no_progress' }
  const state = { stats: save.stats, inventory: inv28, bank: save.bank, equipment: save.equipment, settings: save.settings }
  const result = applyTaskResult(state, sim, task.type)
  save.inventory = state.inventory
  return {
    applied: true,
    skill: sim.skill,
    action: sim.actionName,
    actions: sim.actions || sim.laps || 0,
    xpGained: sim.xpGained || {},
    coinsGained: Number(sim.coinsGained) || 0,
    itemsBanked: named(result.banked),
    rewards: task.type === 'hunter'
      ? (sim.rewards || []).map((r) => ({ itemId: r.itemId, name: itemsData[r.itemId]?.name || r.itemId, quantity: r.quantity }))
      : undefined,
    itemsConsumed: named(sim.itemsConsumed),
    stoppedReason: sim.stoppedReason || null,
  }
}

// ── Idle combat setup (food / potions / prayers) ─────────────────────────────
// The food, boost/restore potions and protection/combat prayers the idle
// combat + boss-fight simulators consume, stored on settings.idleCombatSetup
// (same shape the game client persists). No items are created — this only
// records *which* of the character's own supplies to auto-use while fighting.

// Count how many of an item the character actually holds (inventory, unnoted, +
// bank), so the agent can see whether configured supplies are in stock.
function countOwned(save, itemId) {
  let n = 0
  for (const slot of getInventory(save)) {
    if (slot.itemId === itemId && !slot.noted) n += Number(slot.quantity) || 0
  }
  return n + bankQuantity(save, itemId)
}

// Validate + normalise a food/potion list from the tool ([{ item_id, quantity }]).
// Returns [{ itemId, quantity }] with ids canonicalised; throws on a bad id or
// the wrong item category so a typo can't silently disable healing.
function validateSupplyList(rawList, kind) {
  if (!Array.isArray(rawList)) {
    throw new GameApiError('INVALID_SETUP', `${kind} must be an array of { item_id, quantity } (pass [] to clear).`, 400)
  }
  const out = []
  const seen = new Set()
  for (const entry of rawList) {
    const rawId = entry?.item_id ?? entry?.itemId
    if (!rawId) throw new GameApiError('INVALID_SETUP', `Each ${kind} entry needs an item_id.`, 400)
    const itemId = canonicalItemId(itemsData, String(rawId))
    const item = itemsData[itemId]
    if (!item) throw new GameApiError('ITEM_NOT_FOUND', `No item with id '${rawId}'.`, 404)
    if (kind === 'food' && !isFoodItem(item)) {
      throw new GameApiError('NOT_FOOD', `${item.name} is not food (it heals nothing). List items with list_items type='food'.`, 400)
    }
    if (kind === 'potions' && !isPotionItem(item)) {
      throw new GameApiError('NOT_POTION', `${item.name} is not a potion. List items with list_items type='potion'.`, 400)
    }
    if (seen.has(itemId)) continue
    seen.add(itemId)
    out.push({ itemId, quantity: Math.max(1, Math.floor(Number(entry.quantity) || 0)) })
  }
  return out
}

// Resolve + validate a prayer selection against its slot and the character's
// Prayer level. '' / null clears the slot; undefined leaves it unchanged.
function resolvePrayerChoice(value, kind, prayerLevel, current) {
  if (value === undefined) return current
  if (value === null || value === '') return null
  const prayer = prayersData[value]
  if (!prayer) throw new GameApiError('UNKNOWN_PRAYER', `No prayer with id '${value}'. See get_reference topic='prayers'.`, 400)
  const isProtection = prayer.bonusType === 'protection'
  const isCombat = prayer.bonusType === 'stat' || prayer.bonusType === 'multi_stat'
  if (kind === 'protection' && !isProtection) {
    throw new GameApiError('WRONG_PRAYER_SLOT', `${prayer.name} is not a protection prayer.`, 400)
  }
  if (kind === 'combat' && !isCombat) {
    throw new GameApiError('WRONG_PRAYER_SLOT', `${prayer.name} is not a combat (stat-boost) prayer.`, 400)
  }
  if ((prayer.level || 1) > prayerLevel) {
    throw new GameApiError('PRAYER_LEVEL_TOO_LOW', `${prayer.name} needs Prayer level ${prayer.level} — you have ${prayerLevel}.`, 400)
  }
  return value
}

// Read-only summary of the stored setup, decorating each supply with its name
// and how many the character actually owns (so the agent can warn about gaps).
export function idleCombatSetupSummary(save) {
  const setup = normaliseIdleCombatSetup(save.settings?.idleCombatSetup)
  const decorate = (list) => list.map((e) => ({
    itemId: e.itemId,
    name: itemsData[e.itemId]?.name || e.itemId,
    quantity: e.quantity,
    available: countOwned(save, e.itemId),
  }))
  const prayerName = (id) => (id ? (prayersData[id]?.name || id) : null)
  const food = decorate(setup.food)
  return {
    food,
    potions: decorate(setup.potions),
    prayers: {
      protectionPrayerId: setup.prayers.protectionPrayerId,
      protectionPrayer: prayerName(setup.prayers.protectionPrayerId),
      combatPrayerId: setup.prayers.combatPrayerId,
      combatPrayer: prayerName(setup.prayers.combatPrayerId),
    },
    foodConfigured: food.length > 0,
    foodInStock: food.some((f) => f.available > 0),
  }
}

// Mutate settings.idleCombatSetup. Each field is optional: omit to leave it
// unchanged, pass [] (food/potions) or null (prayers) to clear it.
export function setIdleCombatSetup(save, { food, potions, protectionPrayerId, combatPrayerId }) {
  if (!save.settings || typeof save.settings !== 'object') save.settings = {}
  const current = normaliseIdleCombatSetup(save.settings.idleCombatSetup || defaultIdleCombatSetup())
  const prayerLevel = getLevelFromXP(Number(save.stats?.prayer?.xp) || 0)

  const next = normaliseIdleCombatSetup({
    food: food === undefined ? current.food : validateSupplyList(food, 'food'),
    potions: potions === undefined ? current.potions : validateSupplyList(potions, 'potions'),
    prayers: {
      protectionPrayerId: resolvePrayerChoice(protectionPrayerId, 'protection', prayerLevel, current.prayers.protectionPrayerId),
      combatPrayerId: resolvePrayerChoice(combatPrayerId, 'combat', prayerLevel, current.prayers.combatPrayerId),
    },
  })
  save.settings.idleCombatSetup = next
  return { idleCombatSetup: idleCombatSetupSummary(save) }
}

// A human-readable warning if a character would idle-fight without any healing
// (no food configured, or none of it in stock), else null. start_fight uses
// this to make the agent confirm before risking a death.
export function idleFoodWarning(save) {
  const setup = normaliseIdleCombatSetup(save.settings?.idleCombatSetup)
  if (setup.food.length === 0) {
    return 'No idle food is configured, so the character cannot heal and may die. Set food with set_idle_combat_setup, or confirm to fight without food.'
  }
  if (!setup.food.some((e) => countOwned(save, e.itemId) > 0)) {
    return 'None of the configured idle food is in the inventory or bank, so the character cannot heal and may die. Restock it, or confirm to fight without food.'
  }
  return null
}

// ── Quests (Phase C increment 4) ─────────────────────────────────────────────
// Quests are a timed idle task (type:'quest'): starting one runs the engine
// clock down over real time, exactly like skilling, and completing it records
// the quest, grants its XP/coins and unlocks its quest-gated items. The game
// client pops a modal to pick where combat/"any" XP lands; the agent resolves
// that up front by passing an xp_skill, stored on the task so the later claim
// is deterministic.

const QUEST_BY_ID = new Map(questsData.map((q) => [q.id, q]))
const UNIQUE_ALL_SKILLS = [...new Set(ALL_SKILLS)]

function completedQuestSet(save) {
  const list = Array.isArray(save.settings?.completedQuests) ? save.settings.completedQuests : []
  return new Set(list)
}

// The persisted quest queue (settings.questQueue holds full quest objects, each
// optionally carrying xpChoiceSkill — the same shape the game client saves).
function questQueueArr(save) {
  return Array.isArray(save.settings?.questQueue) ? save.settings.questQueue : []
}

// Compact view of the queue for tool responses.
function queueSummary(save) {
  return questQueueArr(save).map((q) => ({ id: q.id, name: q.name, xpChoiceSkill: q.xpChoiceSkill || null }))
}

export { queueSummary }

// Allowed skills for a quest's free XP choice ('combat' → combat skills only,
// 'any' → every skill). Quests never carry more than one such choice.
function allowedChoiceSkills(choiceType) {
  return choiceType === 'combat' ? COMBAT_SKILLS : UNIQUE_ALL_SKILLS
}

// Describe a quest's optional XP-skill choice (or null if it has none) so the
// agent can surface it and ask the player *before* starting — start_quest then
// applies the player's pick instead of silently defaulting to a skill.
export function questXpChoice(quest) {
  const { choices } = splitQuestXpRewards(quest?.xpReward || {})
  if (choices.length === 0) return null
  const choice = choices[0]
  return {
    type: choice.type, // 'combat' | 'any'
    amount: choice.amount,
    chooseFrom: allowedChoiceSkills(choice.type),
    note: `This quest awards ${choice.amount} XP to a skill of the player's choice — ask which, then pass it as xp_skill (do not default).`,
  }
}

// Build (and validate) a quest idle task. Throws if the quest is unknown, the
// character is ineligible, or a required XP-skill choice is missing/invalid.
export function buildQuestTask(save, questId, xpSkill) {
  const quest = QUEST_BY_ID.get(questId)
  if (!quest) {
    throw new GameApiError('UNKNOWN_QUEST', `No quest with id '${questId}'. See pocketrpg://reference/quests.`, 400)
  }
  const completed = completedQuestSet(save)
  const { eligible, reasons } = checkQuestEligibility(quest, save.stats || {}, completed, questsData)
  if (!eligible) {
    throw new GameApiError('QUEST_INELIGIBLE', `Cannot start '${quest.name}': ${reasons.join('; ')}.`, 400)
  }

  const choice = questXpChoice(quest)
  let xpChoiceSkill = null
  if (choice) {
    const allowed = choice.chooseFrom
    if (!xpSkill) {
      const label = choice.type === 'combat' ? 'a combat skill' : 'any skill'
      throw new GameApiError(
        'XP_CHOICE_REQUIRED',
        `'${quest.name}' awards ${choice.amount} XP to ${label} of the player's choice on completion. Ask the player which skill they want (do not default), then pass it as xp_skill (one of: ${allowed.join(', ')}).`,
        400,
      )
    }
    if (!allowed.includes(xpSkill)) {
      throw new GameApiError('INVALID_XP_SKILL', `xp_skill '${xpSkill}' is not valid here. Choose one of: ${allowed.join(', ')}.`, 400)
    }
    xpChoiceSkill = xpSkill
  }

  return { ...createQueuedQuestTask(quest), xpChoiceSkill }
}

// Append a quest to settings.questQueue so it auto-starts after the active one
// (and any earlier queued quests) finishes. activeQuestId is the id currently
// running in the idle slot, if any, so we never queue a duplicate of it.
// Requires the quest to be eligible *now* (so queueing can't bypass quest
// requirements), and resolves its XP choice up front like start_quest.
export function addQuestToQueueIntent(save, questId, xpSkill, activeQuestId) {
  if (!save.settings || typeof save.settings !== 'object') save.settings = {}
  const quest = QUEST_BY_ID.get(questId)
  if (!quest) {
    throw new GameApiError('UNKNOWN_QUEST', `No quest with id '${questId}'. See get_quests or pocketrpg://reference/quests.`, 400)
  }
  const completed = completedQuestSet(save)
  if (completed.has(questId)) {
    throw new GameApiError('QUEST_ALREADY_COMPLETE', `'${quest.name}' is already completed.`, 400)
  }
  if (activeQuestId && activeQuestId === questId) {
    throw new GameApiError('QUEST_ALREADY_ACTIVE', `'${quest.name}' is the quest currently in progress.`, 400)
  }
  const queue = [...questQueueArr(save)]
  if (queue.some((q) => q.id === questId)) {
    throw new GameApiError('QUEST_ALREADY_QUEUED', `'${quest.name}' is already in the queue.`, 400)
  }
  if (queue.length >= QUEST_QUEUE_MAX) {
    throw new GameApiError('QUEUE_FULL', `The quest queue is full (max ${QUEST_QUEUE_MAX}). Remove one first.`, 400)
  }
  const { eligible, reasons } = checkQuestEligibility(quest, save.stats || {}, completed, questsData)
  if (!eligible) {
    throw new GameApiError('QUEST_INELIGIBLE', `Cannot queue '${quest.name}': ${reasons.join('; ')}. Only quests you can start now may be queued.`, 400)
  }

  const choice = questXpChoice(quest)
  let xpChoiceSkill = null
  if (choice) {
    if (!xpSkill) {
      const label = choice.type === 'combat' ? 'a combat skill' : 'any skill'
      throw new GameApiError(
        'XP_CHOICE_REQUIRED',
        `'${quest.name}' awards ${choice.amount} XP to ${label} of the player's choice. Ask the player which skill they want (do not default), then pass it as xp_skill (one of: ${choice.chooseFrom.join(', ')}).`,
        400,
      )
    }
    if (!choice.chooseFrom.includes(xpSkill)) {
      throw new GameApiError('INVALID_XP_SKILL', `xp_skill '${xpSkill}' is not valid here. Choose one of: ${choice.chooseFrom.join(', ')}.`, 400)
    }
    xpChoiceSkill = xpSkill
  }

  queue.push(xpChoiceSkill ? { ...quest, xpChoiceSkill } : { ...quest })
  save.settings.questQueue = queue
  return { queued: { id: quest.id, name: quest.name, xpChoiceSkill }, queue: queueSummary(save) }
}

// Remove a quest from the queue (no effect on the active quest).
export function removeQuestFromQueueIntent(save, questId) {
  if (!save.settings || typeof save.settings !== 'object') save.settings = {}
  const queue = questQueueArr(save)
  if (!queue.some((q) => q.id === questId)) {
    throw new GameApiError('NOT_QUEUED', `'${questId}' is not in the quest queue.`, 400)
  }
  save.settings.questQueue = queue.filter((q) => q.id !== questId)
  return { removed: questId, queue: queueSummary(save) }
}

// Remove a quest from the queue if present, returning true when one was dropped.
// start_quest uses this so a quest can't be both active and queued.
export function dropFromQueue(save, questId) {
  const queue = questQueueArr(save)
  if (!queue.some((q) => q.id === questId)) return false
  save.settings.questQueue = queue.filter((q) => q.id !== questId)
  return true
}

function addQuestXp(save, skill, rawXp, gained) {
  const amount = Math.floor(Number(rawXp) || 0)
  if (amount <= 0 || !save.stats[skill]) return
  const newXP = Math.min((save.stats[skill].xp || 0) + amount, XP_CAP)
  save.stats[skill] = { ...save.stats[skill], xp: newXP, level: getLevelFromXP(newXP) }
  gained[skill] = (gained[skill] || 0) + amount
}

// Run a quest idle task over the elapsed window and apply every completion to
// the save. Mirrors the client load-time cascade (gameState.jsx): records the
// quest, applies fixed + chosen XP, banks coins. Returns the (partial-progress)
// finalTask the caller should persist — null once the quest is finished.
export function applyQuestTask(save, task, elapsedMs, now = Date.now()) {
  if (!save.settings || typeof save.settings !== 'object') save.settings = {}
  if (!save.stats || typeof save.stats !== 'object') save.stats = {}
  if (!save.bank || typeof save.bank !== 'object') save.bank = {}

  // The queue (settings.questQueue) auto-starts after the active quest, exactly
  // like the game client. Each queued entry carries its own xpChoiceSkill.
  const queue = questQueueArr(save)
  const cascade = simulateQuestIdleCascade({ activeTask: task, questQueue: queue, elapsedMs, now })
  const completedSet = completedQuestSet(save)
  const completed = []

  for (const entry of cascade.completed) {
    const quest = entry.quest
    // Guard against a quest being both active and queued: never grant the same
    // completion twice in one cascade.
    if (completedSet.has(quest.id)) continue
    completedSet.add(quest.id)

    const { fixed, choices } = splitQuestXpRewards(quest.xpReward || {})
    // Queued entries store their own choice on the quest object; the active task
    // carries it on the task. Fall back across both so the right skill is used.
    const chosenSkill = quest.xpChoiceSkill || task.xpChoiceSkill
    const gained = {}
    for (const [skill, xp] of Object.entries(fixed)) addQuestXp(save, skill, xp, gained)
    for (const choice of choices) addQuestXp(save, chosenSkill, choice.amount, gained)

    const coins = Number(quest.coinReward || 0) || 0
    if (coins > 0) {
      const existing = save.bank.coins
      save.bank.coins = existing
        ? { ...existing, quantity: (Number(existing.quantity) || 0) + coins }
        : { itemId: 'coins', quantity: coins }
    }

    completed.push({
      id: quest.id,
      name: quest.name,
      xpGained: gained,
      coinsGained: coins,
      itemUnlocks: (quest.itemUnlocks || []).map((id) => ({ itemId: id, name: itemsData[id]?.name || id })),
    })
  }

  save.settings.completedQuests = [...completedSet]
  // Persist the remaining queue (cascade.finalQueue already had completed/
  // promoted entries shifted off).
  save.settings.questQueue = Array.isArray(cascade.finalQueue) ? cascade.finalQueue : []

  // The cascade rebuilds the front task via createQueuedQuestTask, which drops
  // the task-level xpChoiceSkill. For a still-running active quest that's the
  // original task's choice; for a promoted queued quest it's the entry's own
  // choice (stored on finalTask.quest). Re-attach so a later claim resolves it.
  const finalTask = cascade.finalTask
    ? { ...cascade.finalTask, xpChoiceSkill: cascade.finalTask.quest?.xpChoiceSkill ?? task.xpChoiceSkill }
    : null

  return {
    type: 'quest',
    completed,
    finalTask,
    queue: queueSummary(save),
    ticksUsed: Math.floor((Number(cascade.elapsedMsUsed) || 0) / TICK_DURATION),
    ticksRemaining: finalTask?.ticksRemaining ?? 0,
  }
}

// Read-only quest status for an account: which quests are done, startable now,
// or locked (with the missing requirements), plus the total quest points.
export function questStatuses(save) {
  const completed = completedQuestSet(save)
  const stats = save.stats || {}
  const eligible = []
  const locked = []

  for (const quest of questsData) {
    if (completed.has(quest.id)) continue
    const status = checkQuestEligibility(quest, stats, completed, questsData)
    const base = { id: quest.id, name: quest.name, complexity: quest.complexity, durationSeconds: quest.durationSeconds }
    if (status.eligible) {
      const xpChoice = questXpChoice(quest)
      eligible.push({ ...base, coinReward: quest.coinReward || 0, xpReward: quest.xpReward || {}, ...(xpChoice ? { xpChoice } : {}) })
    } else {
      locked.push({ ...base, requirements: status.reasons })
    }
  }

  return {
    questPoints: getQuestPointsEarned(completed, questsData),
    combatLevel: getCombatLevel(stats),
    completedCount: completed.size,
    completed: [...completed],
    queue: queueSummary(save),
    queueMax: QUEST_QUEUE_MAX,
    eligible,
    locked,
  }
}

// ── Combat (Phase D increment 1) ─────────────────────────────────────────────
// Server-rolled idle combat against normal monsters via the pure
// `simulateIdleCombat` engine — the same simulator the client runs at load
// time. It only fights normal monsters (bosses/raids are blocked inside the
// simulator and gated again here) and uses the character's own configured idle
// food/potions/prayers from settings.idleCombatSetup. Slayer-task credit is
// deliberately left to the client for now (we pass slayerTask = null).

const VALID_STANCES = new Set(['accurate', 'aggressive', 'defensive', 'controlled'])

function resolveMonster(monsterId) {
  if (!monsterId || typeof monsterId !== 'string') throw new GameApiError('INVALID_MONSTER_ID', 'Invalid monster_id', 400)
  const monster = Array.isArray(monstersData) ? monstersData.find((m) => m.id === monsterId) : monstersData[monsterId]
  if (!monster) throw new GameApiError('MONSTER_NOT_FOUND', `No monster with id '${monsterId}'. See pocketrpg://reference/monsters.`, 404)
  return monster
}

// Build (and validate) a combat idle task. Refuses bosses (they need the
// client's explicit fight flow) and normalises the stance.
export function buildCombatTask(save, monsterId, stance) {
  const monster = resolveMonster(monsterId)
  if (monster.boss === true) {
    throw new GameApiError('BOSS_NOT_IDLEABLE', `${monster.name || monsterId} is a boss — fight it in the game client.`, 400)
  }
  const chosen = stance || save.settings?.combatStance || 'accurate'
  if (!VALID_STANCES.has(chosen)) {
    throw new GameApiError('INVALID_STANCE', `Invalid stance '${chosen}'. Use one of: ${[...VALID_STANCES].join(', ')}.`, 400)
  }
  return { type: 'combat', monster, stance: chosen, bankingEnabled: true, spell: save.settings?.activeCombatSpell || null }
}

function maxHpFromStats(stats) {
  return stats?.hitpoints ? getLevelFromXP(stats.hitpoints.xp || 0) : 10
}

// Run a combat idle task over the elapsed window and apply it to the save.
export function runCombatTask(save, task, elapsedMs) {
  if (!save.stats || typeof save.stats !== 'object') save.stats = {}
  if (!save.bank || typeof save.bank !== 'object') save.bank = {}
  if (!save.equipment || typeof save.equipment !== 'object') save.equipment = {}
  if (!save.settings || typeof save.settings !== 'object') save.settings = {}
  const stats = save.stats
  const setup = normaliseIdleCombatSetup(save.settings.idleCombatSetup)
  const currentHP = Number.isFinite(Number(save.settings.currentHP))
    ? Math.max(0, Math.floor(Number(save.settings.currentHP)))
    : maxHpFromStats(stats)
  const inv28 = toSlotArray(save)
  const sim = simulateIdleCombat(task, elapsedMs, stats, save.equipment, inv28, itemsData, null, save.bank, {
    currentHP,
    idleFood: setup.food,
    idlePotions: setup.potions,
    idlePrayers: setup.prayers,
    prayersData,
  })
  if (!sim) return { applied: false, reason: 'no_progress' }
  const state = { stats, inventory: inv28, bank: save.bank, equipment: save.equipment, settings: save.settings }
  const result = applyTaskResult(state, sim, 'combat')
  save.inventory = state.inventory
  const xpGained = {}
  for (const [skill, xp] of Object.entries(sim.xpGained || {})) {
    if (Math.floor(Number(xp) || 0) > 0) xpGained[skill] = Math.floor(Number(xp))
  }
  return {
    applied: true,
    type: 'combat',
    monster: task.monster?.name || task.monster?.id || null,
    monstersKilled: result.monstersKilled || 0,
    xpGained,
    lootBanked: named(result.banked),
    lootGained: named(sim.lootGained),
    itemsConsumed: named(sim.itemsConsumed),
    died: result.died,
    finalHP: result.finalHP,
    stoppedReason: result.stoppedReason,
  }
}

// ── Dungeoneering rewards (Phase D increment 2) ───────────────────────────────
// Training dungeoneering is just an idle 'skill' task (XP + tokens, handled by
// simulateIdleSkilling + applyIdleResult). Spending those tokens to unlock gear
// goes through the dungeoneering completion endpoint; this validates the unlock
// (exists / level / affordable) before the caller forwards it.

export function getDungeoneeringTokens(save) {
  const settings = Number(save?.settings?.dungeoneeringTokens)
  if (Number.isFinite(settings)) return Math.floor(settings)
  const top = Number(save?.dungeoneeringTokens)
  return Number.isFinite(top) ? Math.floor(top) : 0
}

export function planDungeoneeringReward(save, actionId) {
  const action = (skillsData.dungeoneering?.actions || []).find((a) => a.id === actionId && a.category === 'reward')
  if (!action) {
    throw new GameApiError('UNKNOWN_DUNGEONEERING_REWARD', `No dungeoneering reward '${actionId}'. See pocketrpg://reference/skills.`, 400)
  }
  const level = getLevelFromXP(Number(save.stats?.dungeoneering?.xp) || 0)
  const required = Math.max(1, Math.floor(Number(action.level) || 1))
  if (level < required) {
    throw new GameApiError('LEVEL_TOO_LOW', `Dungeoneering ${required} required (you have ${level}).`, 400)
  }
  const cost = getDungeoneeringRewardCost(action)
  const tokens = getDungeoneeringTokens(save)
  if (tokens < cost) {
    throw new GameApiError('INSUFFICIENT_TOKENS', `Need ${cost} dungeoneering tokens (you have ${tokens}).`, 400)
  }
  return { action, cost, product: action.product, productQty: Math.max(1, Math.floor(Number(action.productQty) || 1)) }
}

// ── Slayer (Phase D increment 3) ─────────────────────────────────────────────
// Slayer task state is client-authoritative save data (settings.slayerTask /
// slayerPoints / slayerTasksCompleted). Assigning a task creates no economic
// value — points and loot are only granted on completion through the normal
// combat flow — so it fits the save-intent pattern: enforce the master's
// requirements, pick an eligible monster and write the task. slayerStatus is a
// read-only summary of the current task, points and master eligibility.

const SLAYER_MASTER_BY_ID = new Map(SLAYER_MASTERS.map((m) => [m.id, m]))

function slayerLevelOf(save) {
  return getLevelFromXP(Number(save.stats?.slayer?.xp) || 0)
}

// Assign a new slayer task from a master, mirroring the client SlayerScreen:
// refuse while a task is active, enforce the master's combat/slayer
// requirements, pick an eligible monster and write settings.slayerTask.
// `options` (rng/history) is forwarded to the picker so callers can be
// deterministic.
export function assignSlayerTask(save, masterId, options = {}) {
  if (!save.settings || typeof save.settings !== 'object') save.settings = {}
  const master = SLAYER_MASTER_BY_ID.get(masterId)
  if (!master) {
    throw new GameApiError('UNKNOWN_SLAYER_MASTER', `No slayer master '${masterId}'. Masters: ${[...SLAYER_MASTER_BY_ID.keys()].join(', ')}.`, 400)
  }
  if (save.settings.slayerTask && save.settings.slayerTask.monsterId) {
    throw new GameApiError('SLAYER_TASK_ACTIVE', 'A slayer task is already active — finish it or skip it (skip_slayer_task) before getting a new one.', 400)
  }
  const slayerLevel = slayerLevelOf(save)
  const combatLevel = getCombatLevel(save.stats || {})
  if (combatLevel < master.combatReq) {
    throw new GameApiError('COMBAT_LEVEL_TOO_LOW', `${master.name} requires combat level ${master.combatReq} (you are ${combatLevel}).`, 400)
  }
  if (slayerLevel < master.slayerReq) {
    throw new GameApiError('SLAYER_LEVEL_TOO_LOW', `${master.name} requires slayer level ${master.slayerReq} (you have ${slayerLevel}).`, 400)
  }
  const pick = pickSlayerMonster(master, slayerLevel, options)
  if (!pick) {
    throw new GameApiError('NO_SLAYER_TASK', `${master.name} has no eligible task for slayer level ${slayerLevel}. Raise slayer or pick another master.`, 400)
  }
  const task = buildSlayerTask(master, pick.monsterId, pick.isBoss, options)
  save.settings.slayerTask = task
  return {
    action: 'assign_slayer_task',
    master: { id: master.id, name: master.name },
    task: {
      monsterId: task.monsterId,
      monsterName: task.monsterName,
      monstersRemaining: task.monstersRemaining,
      totalCount: task.totalCount,
      pointsOnComplete: task.pointsOnComplete,
      isBoss: task.isBoss,
    },
  }
}

// Read-only slayer summary: current task (with progress), points, tasks done,
// the points multiplier on the next completed task, skip costs, and each
// master's eligibility for the character.
export function slayerStatus(save) {
  const settings = (save.settings && typeof save.settings === 'object') ? save.settings : {}
  const slayerLevel = slayerLevelOf(save)
  const combatLevel = getCombatLevel(save.stats || {})
  const points = Math.max(0, Math.floor(Number(settings.slayerPoints) || 0))
  const tasksCompleted = Math.max(0, Math.floor(Number(settings.slayerTasksCompleted) || 0))

  const raw = settings.slayerTask
  let currentTask = null
  if (raw && raw.monsterId) {
    const total = Math.max(0, Math.floor(Number(raw.totalCount) || 0))
    const remaining = Math.max(0, Math.floor(Number(raw.monstersRemaining) || 0))
    const killed = Math.max(0, total - remaining)
    currentTask = {
      monsterId: raw.monsterId,
      monsterName: raw.monsterName || raw.monsterId,
      monstersRemaining: remaining,
      totalCount: total,
      killed,
      progressPct: total > 0 ? Math.floor((killed / total) * 100) : 0,
      masterId: raw.masterId || null,
      pointsOnComplete: Math.max(0, Math.floor(Number(raw.pointsOnComplete) || 0)),
      isBoss: !!raw.isBoss,
    }
  }

  const masters = SLAYER_MASTERS.map((m) => ({
    id: m.id,
    name: m.name,
    location: m.location,
    combatReq: m.combatReq,
    slayerReq: m.slayerReq,
    pointsPerTask: m.pointsPerTask,
    eligible: combatLevel >= m.combatReq && slayerLevel >= m.slayerReq,
  }))

  return {
    slayerLevel,
    combatLevel,
    slayerPoints: points,
    tasksCompleted,
    currentTask,
    nextTaskMultiplier: getSlayerTaskReward(1, tasksCompleted).multiplier,
    skipCosts: { points: SLAYER_TASK_SKIP_POINT_COST, credits: 1 },
    masters,
  }
}
