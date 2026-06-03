// Headless PvE boss-fight simulation (Phase D). Drives the *real* combat engine
// (createCombatState + processCombatTick) tick-by-tick against a boss, tracking
// the player's HP and auto-eating from the configured idle food. It is
// deliberately CONSERVATIVE: no prayers, potions or special attacks are used,
// so a simulated victory is always something the player could genuinely achieve
// (it never over-credits). A win is the gate for granting the kill through the
// normal server-rolled completion endpoint; a loss/death grants nothing.

import itemsData from '../../../src/data/items.json' assert { type: 'json' }
import { createCombatState, processCombatTick, applyEat } from '../../../src/engine/combat.js'
import { combatTypeFromEquipment } from '../../../src/engine/combatant.js'
import { getLevelFromXP } from '../../../src/engine/experience.js'
import { normaliseIdleCombatSetup, getFoodHealAmount } from '../../../src/engine/idleSupplies.js'
import { GameApiError } from '../game/errors.js'

const XP_CAP = 200000000
// Safety bound on the loop. A single boss dies in well under this many ticks
// for any viable setup; the cap only stops a hopeless (0-damage) stalemate.
const MAX_FIGHT_TICKS = 20000
const EAT_HP_FRACTION = 0.5

function playerLevels(stats) {
  return {
    attack: getLevelFromXP(stats.attack?.xp || 0),
    strength: getLevelFromXP(stats.strength?.xp || 0),
    defence: getLevelFromXP(stats.defence?.xp || 0),
    ranged: getLevelFromXP(stats.ranged?.xp || 0),
    magic: getLevelFromXP(stats.magic?.xp || 0),
  }
}

function maxHpFromStats(stats) {
  return stats?.hitpoints ? getLevelFromXP(stats.hitpoints.xp || 0) : 10
}

function countItem(save, itemId) {
  let n = 0
  for (const slot of (save.inventory || [])) if (slot?.itemId === itemId) n += Number(slot.quantity) || 0
  const b = save.bank?.[itemId]
  if (b) n += Number(b.quantity) || 0
  return n
}

// Ordered food queue from the idle config, with available counts + heal amount.
function buildFoodQueue(save, setup) {
  const queue = []
  for (const entry of setup.food) {
    const heal = getFoodHealAmount(itemsData[entry.itemId])
    if (heal <= 0) continue
    const remaining = countItem(save, entry.itemId)
    if (remaining > 0) queue.push({ itemId: entry.itemId, heal, remaining })
  }
  return queue
}

// Simulate a full boss fight over the real engine. Returns the outcome; the
// save is NOT mutated here (the caller applies applyBossFightOutcome).
export function simulateBossFight(save, monster) {
  const equipment = save.equipment || {}
  const combatType = combatTypeFromEquipment(equipment, itemsData)
  if (combatType === 'magic') {
    throw new GameApiError('MAGIC_UNSUPPORTED', 'Magic boss fights are not simulated yet — use kill_boss (credit skip) for magic setups.', 400)
  }

  const stats = save.stats || {}
  const levels = playerLevels(stats)
  const maxHP = maxHpFromStats(stats)
  let hp = Number.isFinite(Number(save.settings?.currentHP))
    ? Math.max(1, Math.min(maxHP, Math.floor(Number(save.settings.currentHP))))
    : maxHP
  const eatThreshold = Math.max(1, Math.floor(maxHP * EAT_HP_FRACTION))

  const setup = normaliseIdleCombatSetup(save.settings?.idleCombatSetup)
  const foodQueue = buildFoodQueue(save, setup)
  const foodConsumed = {}
  const ammoConsumed = {}
  let chargesConsumed = 0

  let state = createCombatState(monster, combatType, save.settings?.combatStance || 'accurate', save.settings?.activeCombatSpell || null)
  let died = false
  let ticks = 0

  while (state.active && ticks < MAX_FIGHT_TICKS) {
    ticks++
    // Auto-eat before the tick when low and able (eating costs attack ticks).
    if (hp <= eatThreshold && hp < maxHP && state.eatCooldown <= 0) {
      const food = foodQueue.find((f) => f.remaining > 0)
      if (food) {
        hp = Math.min(maxHP, hp + food.heal)
        food.remaining--
        foodConsumed[food.itemId] = (foodConsumed[food.itemId] || 0) + 1
        state = applyEat(state)
      }
    }

    const playerStats = { ...levels, currentHP: hp }
    const { combatState, events } = processCombatTick(state, playerStats, equipment, itemsData, {}, save.inventory || [], null)
    state = combatState

    for (const ev of events) {
      if (ev.type === 'monsterHit' || ev.type === 'dragonfireHit') {
        hp = Math.max(0, hp - (Number(ev.damage) || 0))
      } else if ((ev.type === 'specialHit' || ev.type === 'sangHeal') && Number(ev.healAmount) > 0) {
        hp = Math.min(maxHP, hp + Math.floor(Number(ev.healAmount)))
      } else if (ev.type === 'consumeAmmo' && ev.itemId) {
        ammoConsumed[ev.itemId] = (ammoConsumed[ev.itemId] || 0) + (Number(ev.qty) || 1)
      } else if (ev.type === 'consumeCharge') {
        chargesConsumed += (Number(ev.qty) || 1)
      }
    }

    if (hp <= 0) { died = true; break }
  }

  const victory = !died && !state.active
  return {
    victory,
    died,
    monsterId: monster.id,
    ticks,
    maxHP,
    finalHP: died ? 0 : hp,
    xpGained: { ...(state.xpGained || {}) },
    foodConsumed,
    ammoConsumed,
    chargesConsumed,
    stoppedReason: died ? 'died' : (victory ? 'victory' : 'tick_cap'),
  }
}

function removeItemInventoryThenBank(save, itemId, qty) {
  let left = Math.floor(Number(qty) || 0)
  if (left <= 0) return
  const inv = Array.isArray(save.inventory) ? save.inventory : []
  for (const slot of inv) {
    if (left <= 0) break
    if (slot?.itemId === itemId) {
      const take = Math.min(left, Number(slot.quantity) || 0)
      slot.quantity = (Number(slot.quantity) || 0) - take
      left -= take
    }
  }
  save.inventory = inv.filter((s) => !(s && (Number(s.quantity) || 0) <= 0))
  const b = save.bank?.[itemId]
  if (left > 0 && b) {
    const nq = (Number(b.quantity) || 0) - left
    if (nq <= 0) delete save.bank[itemId]
    else save.bank[itemId] = { ...b, quantity: nq }
  }
}

// Apply a fight outcome to the save: combat XP, HP (no wipe — a death resets to
// max), and the food/ammo/charges the fight consumed. Loot is granted
// separately by the caller (the server-rolled completion endpoint) on victory.
export function applyBossFightOutcome(save, outcome) {
  if (!save.stats || typeof save.stats !== 'object') save.stats = {}
  if (!save.settings || typeof save.settings !== 'object') save.settings = {}
  if (!save.equipment || typeof save.equipment !== 'object') save.equipment = {}

  for (const [skill, xp] of Object.entries(outcome.xpGained || {})) {
    const amount = Math.floor(Number(xp) || 0)
    if (amount > 0 && save.stats[skill]) {
      const newXP = Math.min((save.stats[skill].xp || 0) + amount, XP_CAP)
      save.stats[skill] = { ...save.stats[skill], xp: newXP, level: getLevelFromXP(newXP) }
    }
  }

  save.settings.currentHP = outcome.died
    ? outcome.maxHP
    : Math.max(1, Math.min(outcome.maxHP, Math.floor(outcome.finalHP)))

  for (const [itemId, qty] of Object.entries(outcome.foodConsumed || {})) {
    removeItemInventoryThenBank(save, itemId, qty)
  }

  for (const [itemId, qty] of Object.entries(outcome.ammoConsumed || {})) {
    if (save.equipment.ammo?.itemId === itemId) {
      const remaining = Math.max(0, (Number(save.equipment.ammo.quantity) || 0) - qty)
      save.equipment.ammo = remaining > 0 ? { ...save.equipment.ammo, quantity: remaining } : null
    }
  }
  if (outcome.chargesConsumed > 0 && save.equipment.weapon) {
    const remaining = Math.max(0, (Number(save.equipment.weapon.charges) || 0) - outcome.chargesConsumed)
    save.equipment.weapon = { ...save.equipment.weapon, charges: remaining }
  }
}
