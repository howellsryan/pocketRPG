// Headless PvE boss-fight simulation (Phase D). Drives the *real* combat engine
// (createCombatState + processCombatTick) tick-by-tick against a boss, tracking
// the player's HP and auto-eating from the configured idle food. It is
// deliberately CONSERVATIVE: no prayers, potions or special attacks are used,
// so a simulated victory is always something the player could genuinely achieve
// (it never over-credits). A win is the gate for granting the kill through the
// normal server-rolled completion endpoint; a loss/death grants nothing.

import itemsData from '../../../src/data/items.json' assert { type: 'json' }
import spellsData from '../../../src/data/spells.json' assert { type: 'json' }
import monstersData from '../../../src/data/monsters.json' assert { type: 'json' }
import { createCombatState, processCombatTick, applyEat, setCombatTarget } from '../../../src/engine/combat.js'
import { isAddAlive } from '../../../src/engine/bossAdds.js'
import { combatTypeFromEquipment } from '../../../src/engine/combatant.js'
import { getLevelFromXP } from '../../../src/engine/experience.js'
import { normaliseIdleCombatSetup, getFoodHealAmount } from '../../../src/engine/idleSupplies.js'
import { GameApiError } from '../game/errors.js'
import { isGrindmanSave } from '../../../src/engine/grindman.js'
import { bankXp } from '../../../src/engine/xpBank.js'

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

  // Resolve the magic setup. A powered staff (Trident/Sanguine) casts off its
  // own charges with no spell or runes; a regular staff/wand needs the active
  // combat spell (and consumes its runes per cast, from the inventory only —
  // exactly as the client does). Magic with neither is refused, mirroring the
  // client's "select a spell" gate.
  const weaponItem = equipment.weapon ? itemsData[equipment.weapon.itemId] : null
  const isPoweredStaff = !!weaponItem?.poweredStaff
  let spell = null
  if (combatType === 'magic' && !isPoweredStaff) {
    const spellId = save.settings?.activeCombatSpell?.id
    spell = spellId ? spellsData[spellId] : null
    if (!spell) {
      throw new GameApiError('NO_SPELL_SELECTED', 'A magic setup needs an active combat spell. Select one in the game client, or equip a powered staff (e.g. Trident), before using fight_boss.', 400)
    }
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
  const runesConsumed = {}
  let chargesConsumed = 0

  // The magic spell path reads runes from the inventory passed to the engine and
  // stops casting once they run out. Drive it off a CLONE so depletion is
  // reflected during the sim without mutating the real save (the caller applies
  // runesConsumed via applyBossFightOutcome).
  const workingInventory = (save.inventory || []).map((s) => (s ? { ...s } : s))

  let state = createCombatState(monster, combatType, save.settings?.combatStance || 'accurate', spell, monstersData)
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

    // Adds hit alongside the boss and never stop, so clear them first — the same
    // call a player makes with the target toggle.
    state = setCombatTarget(state, isAddAlive(state) ? 'add' : 'boss')

    const playerStats = { ...levels, currentHP: hp }
    const { combatState, events } = processCombatTick(state, playerStats, equipment, itemsData, {}, workingInventory, null)
    state = combatState

    let landedHit = false
    for (const ev of events) {
      if (ev.type === 'monsterHit' || ev.type === 'dragonfireHit') {
        hp = Math.max(0, hp - (Number(ev.damage) || 0))
      } else if ((ev.type === 'specialHit' || ev.type === 'sangHeal') && Number(ev.healAmount) > 0) {
        hp = Math.min(maxHP, hp + Math.floor(Number(ev.healAmount)))
      } else if (ev.type === 'consumeAmmo' && ev.itemId) {
        ammoConsumed[ev.itemId] = (ammoConsumed[ev.itemId] || 0) + (Number(ev.qty) || 1)
      } else if (ev.type === 'consumeCharge') {
        chargesConsumed += (Number(ev.qty) || 1)
      } else if (ev.type === 'playerHit' && Number(ev.damage) > 0) {
        landedHit = true
      }
    }

    // Consume a spell's runes on a landed cast — same rule the client uses: only
    // on a successful hit, drained from the inventory clone so the engine sees
    // depletion and stops casting when runes run out.
    if (landedHit && state.runesConsumed) {
      for (const [runeId, qty] of Object.entries(state.runesConsumed)) {
        deductFromInventory(workingInventory, runeId, Number(qty) || 0)
        runesConsumed[runeId] = (runesConsumed[runeId] || 0) + (Number(qty) || 0)
      }
      state.runesConsumed = null
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
    runesConsumed,
    chargesConsumed,
    stoppedReason: died ? 'died' : (victory ? 'victory' : 'tick_cap'),
  }
}

// Drain `qty` of an item from a working inventory array in place (used to track
// rune depletion during the magic sim).
function deductFromInventory(inventory, itemId, qty) {
  let left = Math.floor(Number(qty) || 0)
  for (let i = 0; i < inventory.length && left > 0; i++) {
    const slot = inventory[i]
    if (slot?.itemId !== itemId) continue
    const take = Math.min(left, Number(slot.quantity) || 0)
    slot.quantity = (Number(slot.quantity) || 0) - take
    left -= take
    if (slot.quantity <= 0) inventory[i] = null
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

  const isGrindman = isGrindmanSave(save)
  for (const [skill, xp] of Object.entries(outcome.xpGained || {})) {
    bankXp(save.stats, skill, xp, { isGrindman })
  }

  save.settings.currentHP = outcome.died
    ? outcome.maxHP
    : Math.max(1, Math.min(outcome.maxHP, Math.floor(outcome.finalHP)))

  for (const [itemId, qty] of Object.entries(outcome.foodConsumed || {})) {
    removeItemInventoryThenBank(save, itemId, qty)
  }

  // Spell runes are cast from the inventory (the engine and client never read
  // bank runes in combat), so drain them inventory-first to match.
  for (const [itemId, qty] of Object.entries(outcome.runesConsumed || {})) {
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
