// PvP match tick loop (Phase 2B).
//
// Pure logic: no DB/network/UI imports. Server and client can both execute
// this module on the same input and get identical results.

import { addItem } from './inventory.js'
import { equipItem, unequipSlot, getAttackSpeed } from './equipment.js'
import { rollMeleeAttack, rollRangedAttack, rollMagicAttack } from './combatPrimitives.js'

const VALID_STANCES = new Set(['accurate', 'aggressive', 'defensive', 'controlled', 'rapid', 'longrange'])

function cloneCombatant(c) {
  return {
    ...c,
    stats: { ...c.stats },
    equipment: Object.fromEntries(Object.entries(c.equipment || {}).map(([k, v]) => [k, v ? { ...v } : null])),
    inventory: Array.isArray(c.inventory) ? c.inventory.map((s) => (s ? { ...s } : null)) : [],
    activePotions: { ...(c.activePotions || {}) },
    spell: c.spell ? { ...c.spell } : null,
  }
}

function cloneState(state) {
  const combatants = {}
  for (const [id, c] of Object.entries(state.combatants || {})) {
    combatants[id] = cloneCombatant(c)
  }
  return {
    ...state,
    combatants,
    recentEvents: Array.isArray(state.recentEvents) ? [...state.recentEvents] : [],
  }
}

function asPair(state) {
  const ids = Object.keys(state.combatants).map(Number).sort((a, b) => a - b)
  if (ids.length !== 2) throw new Error('pvpEngine requires exactly two combatants')
  return [state.combatants[String(ids[0])], state.combatants[String(ids[1])], ids]
}

function clampCooldowns(c) {
  c.attackTimer = Math.max(0, c.attackTimer || 0)
  c.eatCooldown = Math.max(0, c.eatCooldown || 0)
  c.potionCooldown = Math.max(0, c.potionCooldown || 0)
}

function rapidAdjustedSpeed(combatant, itemsData) {
  const base = getAttackSpeed(combatant.equipment, itemsData)
  if (combatant.combatType === 'ranged' && combatant.stance === 'rapid') {
    return Math.max(1, base - 1)
  }
  return base
}

function attackSnapshot(attacker, defender, itemsData) {
  if (attacker.combatType === 'ranged') return rollRangedAttack(attacker, defender, itemsData)
  if (attacker.combatType === 'magic') return rollMagicAttack(attacker, defender, itemsData)
  return rollMeleeAttack(attacker, defender, itemsData)
}

function resolveSwing(attacker, defender, itemsData, events) {
  const weapon = itemsData?.[attacker?.equipment?.weapon?.itemId]
  const spec = weapon?.specialAttack
  const queued = !!attacker.specialAttackQueued
  attacker.specialAttackQueued = false

  if (!queued || !spec) {
    return attackSnapshot(attacker, defender, itemsData)
  }

  const energyCost = Math.max(0, Number(spec.energyCost) || 0)
  const currentEnergy = Math.max(0, Number(attacker.specialAttackEnergy) || 0)
  if (currentEnergy < energyCost) {
    events.push({ type: 'spec_failed', characterId: attacker.characterId, reason: 'insufficient_energy' })
    return attackSnapshot(attacker, defender, itemsData)
  }

  attacker.specialAttackEnergy = Math.max(0, currentEnergy - energyCost)

  // PvP v1: consume queue + energy server-authoritatively. We keep the
  // combat math deterministic by applying the same attack roll path and
  // annotate the event for UI/logging.
  const swing = attackSnapshot(attacker, defender, itemsData)
  return {
    ...swing,
    special: true,
    specType: spec.type || 'special',
    energyCost,
  }
}

function terminalResult(next, winnerId, loserId, reason, events) {
  return {
    stateNext: next,
    events,
    terminal: { winner: winnerId, loser: loserId, reason },
  }
}

function applyIntent(combatant, intentAction, itemsData, events) {
  if (!intentAction || typeof intentAction !== 'object') return

  if (intentAction.type === 'change_stance') {
    if (VALID_STANCES.has(intentAction.stance)) combatant.stance = intentAction.stance
    return
  }

  if (intentAction.type === 'change_combat_spell') {
    combatant.spell = intentAction.spellId ? { id: intentAction.spellId } : null
    return
  }

  if (intentAction.type === 'queue_special') {
    combatant.specialAttackQueued = true
    return
  }

  if (intentAction.type === 'toggle_prayer') {
    // Protection prayers intentionally disabled in PvP v1.
    if (typeof intentAction.prayerId === 'string' && !intentAction.prayerId.startsWith('protect_')) {
      combatant.activeCombatPrayer = combatant.activeCombatPrayer === intentAction.prayerId ? null : intentAction.prayerId
    }
    return
  }

  if (intentAction.type === 'equip') {
    const i = intentAction.inventorySlot
    if (typeof i !== 'number' || i < 0 || i >= combatant.inventory.length) return
    const slot = combatant.inventory[i]
    if (!slot) return
    const item = itemsData?.[slot.itemId]
    if (!item?.slot) return
    const result = equipItem(combatant.equipment, item, itemsData, slot)
    if (!result?.equipped) return

    // Equipment-swap timer rule: timer cannot be lowered by swapping.
    combatant.attackTimer = Math.max(combatant.attackTimer || 0, rapidAdjustedSpeed(combatant, itemsData))

    combatant.inventory[i] = null
    for (const uneq of result.unequipped || []) {
      addItem(combatant.inventory, uneq.itemId, uneq.quantity || 1, !!itemsData?.[uneq.itemId]?.stackable)
    }
    return
  }

  if (intentAction.type === 'unequip') {
    const eqSlot = intentAction.equipmentSlot
    if (!eqSlot) return
    const removed = unequipSlot(combatant.equipment, eqSlot)
    if (!removed) return
    addItem(combatant.inventory, removed.itemId, removed.quantity || 1, !!itemsData?.[removed.itemId]?.stackable)
    return
  }

  if (intentAction.type === 'eat') {
    const i = intentAction.inventorySlot
    if ((combatant.eatCooldown || 0) > 0 || typeof i !== 'number') return
    const slot = combatant.inventory[i]
    const item = slot ? itemsData?.[slot.itemId] : null
    if (!slot || !item?.heal) return
    combatant.hp = Math.min(combatant.maxHP, combatant.hp + item.heal)
    combatant.eatCooldown = 3
    slot.quantity -= 1
    if (slot.quantity <= 0) combatant.inventory[i] = null
    events.push({ type: 'eat', characterId: combatant.characterId, itemId: item.id, heal: item.heal })
    return
  }

  if (intentAction.type === 'drink_potion') {
    const i = intentAction.inventorySlot
    if ((combatant.potionCooldown || 0) > 0 || typeof i !== 'number') return
    const slot = combatant.inventory[i]
    const item = slot ? itemsData?.[slot.itemId] : null
    if (!slot || !item || !item.id?.includes('potion')) return
    combatant.activePotions[item.id] = Math.max(combatant.activePotions[item.id] || 0, 100)
    combatant.potionCooldown = 3
    slot.quantity -= 1
    if (slot.quantity <= 0) combatant.inventory[i] = null
    events.push({ type: 'drink', characterId: combatant.characterId, itemId: item.id })
  }
}

/**
 * Canonical state builder for Phase 2B.
 */
export function createPvpState(aCombatant, bCombatant, now = Date.now(), rngSeed = 0) {
  const a = cloneCombatant(aCombatant)
  const b = cloneCombatant(bCombatant)
  const combatants = {
    [String(a.characterId)]: {
      ...a,
      hp: a.hp ?? a.currentHP ?? a.maxHP,
      attackTimer: a.attackTimer ?? 0,
      eatCooldown: a.eatCooldown ?? 0,
      potionCooldown: a.potionCooldown ?? 0,
    },
    [String(b.characterId)]: {
      ...b,
      hp: b.hp ?? b.currentHP ?? b.maxHP,
      attackTimer: b.attackTimer ?? 0,
      eatCooldown: b.eatCooldown ?? 0,
      potionCooldown: b.potionCooldown ?? 0,
    },
  }

  return {
    tick: 0,
    startedAt: now,
    combatants,
    recentEvents: [],
    rngSeed,
  }
}

/**
 * processPvpTick(state, intents, itemsData)
 * - applies intents in deterministic order
 * - decrements cooldowns/timers
 * - resolves simultaneous attacks from start-of-step snapshots
 * - trims recentEvents to last 20
 */
export function processPvpTick(state, intents, itemsData) {
  const next = cloneState(state)
  const events = []
  const [left, right, ids] = asPair(next)

  // 1) apply intents in deterministic order
  const orderedIntents = [...(intents || [])].sort((x, y) => {
    const byTick = (x.tick_number || 0) - (y.tick_number || 0)
    if (byTick !== 0) return byTick
    const byChar = (x.characterId || 0) - (y.characterId || 0)
    if (byChar !== 0) return byChar
    return (x.characterSeq || 0) - (y.characterSeq || 0)
  })

  for (const intent of orderedIntents) {
    const cid = String(intent?.characterId)
    const c = next.combatants[cid]
    if (!c) continue
    const action = intent?.action || {}
    if (action.type === 'forfeit') {
      events.push({ type: 'forfeit', characterId: c.characterId })
      const opponent = c.characterId === left.characterId ? right : left
      next.tick = (next.tick || 0) + 1
      next.recentEvents = [...next.recentEvents, ...events].slice(-20)
      return terminalResult(next, opponent.characterId, c.characterId, 'forfeit', events)
    }
    applyIntent(c, action, itemsData, events)
  }

  // 2) decrement timers/cooldowns and potion durations
  for (const c of [left, right]) {
    c.attackTimer = (c.attackTimer || 0) - 1
    c.eatCooldown = (c.eatCooldown || 0) - 1
    c.potionCooldown = (c.potionCooldown || 0) - 1
    for (const [pid, ticks] of Object.entries(c.activePotions || {})) {
      c.activePotions[pid] = Math.max(0, (ticks || 0) - 1)
      if (c.activePotions[pid] <= 0) delete c.activePotions[pid]
    }
    clampCooldowns(c)
  }

  // 3) simultaneous attacks (snapshot first, apply after)
  const leftCanAttack = left.hp > 0 && left.attackTimer === 0 && left.eatCooldown === 0
  const rightCanAttack = right.hp > 0 && right.attackTimer === 0 && right.eatCooldown === 0

  const leftSwing = leftCanAttack ? resolveSwing(left, right, itemsData, events) : null
  const rightSwing = rightCanAttack ? resolveSwing(right, left, itemsData, events) : null

  const leftDamage = leftSwing ? Math.max(0, Math.min(right.hp, leftSwing.damage || 0)) : 0
  const rightDamage = rightSwing ? Math.max(0, Math.min(left.hp, rightSwing.damage || 0)) : 0

  if (leftSwing) {
    events.push({ type: 'attack', attackerCharacterId: left.characterId, defenderCharacterId: right.characterId, ...leftSwing, damage: leftDamage })
    left.attackTimer = rapidAdjustedSpeed(left, itemsData)
  }
  if (rightSwing) {
    events.push({ type: 'attack', attackerCharacterId: right.characterId, defenderCharacterId: left.characterId, ...rightSwing, damage: rightDamage })
    right.attackTimer = rapidAdjustedSpeed(right, itemsData)
  }

  right.hp = Math.max(0, right.hp - leftDamage)
  left.hp = Math.max(0, left.hp - rightDamage)

  // mirror legacy field for compatibility with existing callers
  left.currentHP = left.hp
  right.currentHP = right.hp

  next.tick = (next.tick || 0) + 1
  next.recentEvents = [...next.recentEvents, ...events].slice(-20)

  const leftDead = left.hp <= 0
  const rightDead = right.hp <= 0

  if (leftDead || rightDead) {
    if (leftDead && rightDead) {
      const winner = ids[0] // lower characterId tie-break
      const loser = ids[1]
      return terminalResult(next, winner, loser, 'death', events)
    }
    const winner = leftDead ? right.characterId : left.characterId
    const loser = leftDead ? left.characterId : right.characterId
    return terminalResult(next, winner, loser, 'death', events)
  }

  return {
    stateNext: next,
    events,
    terminal: null,
  }
}

// Back-compat with earlier Phase 2B API name.
export function applyPvpTick(state, intents, itemsData) {
  const out = processPvpTick(state, intents, itemsData)
  return { state: out.stateNext, events: out.events, terminal: out.terminal }
}
