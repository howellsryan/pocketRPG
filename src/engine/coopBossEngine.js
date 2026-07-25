// Co-operative boss fights: N players versus one shared boss.
//
// The combat model is the open world's (world/server/combat.ts): every member
// runs their own `processCombatTick` session against a SHARED boss HP record,
// rather than a bespoke N-vs-1 engine. That keeps every authored boss mechanic
// — adds, forms, resistances, specials, prayer, bolt procs — working for free.
//
// Two invariants make the shared boss behave like one monster rather than one
// monster per attacker:
//   1. Only the target member's session is allowed to resolve a boss swing
//      (`monsterAttackTimer` is held off the floor for everyone else), or the
//      boss would attack once per member every tick.
//   2. The boss's add lives on the shared record and only the target member's
//      session advances its spawn countdown, or N members would each spawn one.
//
// State is persisted as JSON per tick, so members store only the mutable engine
// fields; the monster itself is rebuilt from `monstersData` on every tick.

import { createCombatState, processCombatTick } from './combat.js'
import { getLevelFromXP } from './experience.js'
import { isConsumableFood, isConsumablePotion, isComboConsumable, applyConsumableEffect } from './consumables.js'
import { getCombatType } from './equipment.js'

export const COOP_MAX_MEMBERS = 8
export const COOP_TICK_MS = 600
/** Bosses playable co-operatively. Deliberately an allowlist rather than "every
 * boss": each one's mechanics need checking against the shared-HP model before
 * it opens up. Shared with the server so both sides gate on one list.
 *
 * `respawnTicks` paces the farm loop. A group melts a low-HP boss far faster
 * than a solo player, so the short default only suits bosses with enough HP to
 * take real time to kill — anything squishy needs a longer wait between kills
 * or its GP/hr runs away from the §4 boss guardrails. */
export const COOP_BOSSES = {
  // 2000 HP: a group still needs a sustained fight, so the short default holds.
  corporeal_horror: { respawnTicks: 10 },
  // 255 HP and ~20k coins a kill — eight players would otherwise clear it every
  // few seconds. 30s between kills keeps the loop closer to the solo pace.
  warlord_grondar: { respawnTicks: 50 },
}
export const COOP_BOSS_IDS = new Set(Object.keys(COOP_BOSSES))
/** Fallback for a boss added to the map without explicit pacing. */
export const COOP_RESPAWN_TICKS = 10

export function isCoopBossId(bossId) {
  return typeof bossId === 'string' && Object.prototype.hasOwnProperty.call(COOP_BOSSES, bossId)
}

export function coopRespawnTicks(bossId) {
  return COOP_BOSSES[bossId]?.respawnTicks ?? COOP_RESPAWN_TICKS
}
const COOP_EAT_TICK_COST = 3
const COOP_VALID_STANCES = new Set(['accurate', 'aggressive', 'controlled', 'defensive', 'rapid', 'longrange'])
const COMBAT_STAT_KEYS = ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'prayer']
/** Monster fields the engine mutates in place for multi-form bosses; carried on
 * the shared record so a form switch is seen by every member, not just whoever
 * triggered it. */
const MUTABLE_MONSTER_FIELDS = [
  'currentForm', 'formAttackCount', 'formSwitchThreshold', 'attackStyle',
  'attackBonus', 'strengthBonus', 'defenceBonus', 'formMaxHit', 'hitpoints',
]

function levelFrom(statValue) {
  if (typeof statValue === 'number') return Number.isFinite(statValue) && statValue > 0 ? Math.floor(statValue) : 1
  const explicit = Number(statValue?.level)
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit)
  const xp = Number(statValue?.xp)
  if (Number.isFinite(xp) && xp >= 0) return getLevelFromXP(xp)
  return 1
}

export function combatStatLevels(savePayload) {
  const stats = savePayload?.stats || {}
  const out = {}
  for (const key of COMBAT_STAT_KEYS) out[key] = levelFrom(stats[key])
  return out
}

function cloneCoopInventory(inventory) {
  return Array.isArray(inventory) ? inventory.map((s) => (s ? { ...s } : null)) : []
}

function cloneCoopEquipment(equipment) {
  return Object.fromEntries(Object.entries(equipment || {}).map(([slot, item]) => [slot, item ? { ...item } : null]))
}

export function cloneCoopState(state) {
  const members = {}
  for (const [id, m] of Object.entries(state.members || {})) {
    members[id] = {
      ...m,
      stats: { ...m.stats },
      equipment: cloneCoopEquipment(m.equipment),
      inventory: cloneCoopInventory(m.inventory),
      combat: { ...m.combat, activePotions: { ...(m.combat?.activePotions || {}) } },
      xpGained: { ...(m.xpGained || {}) },
    }
  }
  return {
    ...state,
    boss: { ...state.boss, add: state.boss?.add ? { ...state.boss.add } : null, monster: { ...(state.boss?.monster || {}) } },
    members,
    recentEvents: Array.isArray(state.recentEvents) ? [...state.recentEvents] : [],
  }
}

/** A fresh, empty instance of a boss. Members join into it afterwards. */
export function createCoopBossState(bossId, monstersData, now = Date.now()) {
  const monster = monstersData?.[bossId]
  if (!monster) return null
  const seed = createCombatState(monster, 'melee', 'accurate', null, monstersData)
  return {
    tick: 0,
    bossId,
    startedAt: now,
    boss: {
      currentHP: seed.monster.currentHP,
      maxHP: seed.monster.currentHP,
      attackSpeed: seed.monster.attackSpeed || 4,
      monster: pickMutableMonsterFields(seed.monster),
      add: null,
      addSpawnCountdown: seed.addSpawnCountdown,
      addsDefeated: 0,
      killedAt: null,
      respawnCountdown: 0,
    },
    members: {},
    targetCharId: null,
    recentEvents: [],
  }
}

function pickMutableMonsterFields(monster) {
  const out = {}
  for (const field of MUTABLE_MONSTER_FIELDS) {
    if (monster?.[field] !== undefined) out[field] = monster[field]
  }
  return out
}

/** Seeds a member's compact combat record from their save snapshot. */
export function createCoopMember({ characterId, username, savePayload, itemsData, now = Date.now() }) {
  const stats = combatStatLevels(savePayload)
  const equipment = cloneCoopEquipment(savePayload?.equipment)
  const inventory = cloneCoopInventory(savePayload?.inventory)
  const maxHP = stats.hitpoints
  const savedHP = Number(savePayload?.player?.currentHP)
  const hp = Number.isFinite(savedHP) && savedHP > 0 ? Math.min(savedHP, maxHP) : maxHP
  const stance = savePayload?.settings?.combatStance
  const savedSpell = savePayload?.settings?.activeCombatSpell ?? savePayload?.activeCombatSpell
  return {
    characterId,
    username,
    hp,
    maxHP,
    stats,
    equipment,
    inventory,
    status: 'alive',
    damage: 0,
    damageTick: 0,
    xpGained: {},
    joinedAt: now,
    combat: {
      combatType: getCombatType(equipment, itemsData),
      stance: COOP_VALID_STANCES.has(stance) ? stance : 'accurate',
      spellId: typeof savedSpell === 'string' ? savedSpell : (savedSpell?.id ?? null),
      playerAttackTimer: 0,
      monsterAttackTimer: 0,
      eatCooldown: 0,
      potionCooldown: 0,
      comboCooldown: 0,
      specialAttackEnergy: 100,
      specialAttackQueued: false,
      activeProtectionPrayer: null,
      activeCombatPrayer: null,
      prayerPoints: stats.prayer,
      maxPrayerPoints: stats.prayer,
      prayerDrainAccumulator: 0,
      activePotions: {},
      addTargeted: false,
    },
  }
}

export function addCoopMember(state, member) {
  const next = cloneCoopState(state)
  // One attack delay before the boss can swing at a new arrival, matching the
  // live game's first-hit rule (createCombatState seeds the same way).
  member.combat.monsterAttackTimer = next.boss.attackSpeed || 4
  next.members[String(member.characterId)] = member
  if (!next.targetCharId) next.targetCharId = String(member.characterId)
  return next
}

export function removeCoopMember(state, characterId) {
  const next = cloneCoopState(state)
  delete next.members[String(characterId)]
  if (next.targetCharId === String(characterId)) next.targetCharId = null
  reselectTarget(next)
  return next
}

export function livingMembers(state) {
  return Object.values(state.members || {}).filter((m) => m.status === 'alive')
}

export function memberCount(state) {
  return Object.keys(state.members || {}).length
}

/** Loot owner: most damage dealt to the boss; equal totals resolve to whoever
 * reached the total first. Same rule the open world uses (npc.ts). */
export function topDamageCharacterId(state) {
  let best = null
  for (const m of Object.values(state.members || {})) {
    if (!(m.damage > 0)) continue
    if (!best || m.damage > best.damage || (m.damage === best.damage && m.damageTick < best.damageTick)) best = m
  }
  return best ? String(best.characterId) : null
}

export function damageTable(state) {
  return Object.values(state.members || {})
    .map((m) => ({ characterId: m.characterId, username: m.username, damage: m.damage, hp: m.hp, maxHP: m.maxHP, status: m.status }))
    .sort((a, b) => b.damage - a.damage)
}

/** Points the boss at the living member who has dealt the most damage, so it
 * focuses the biggest threat instead of whoever engaged first. The current
 * target is kept on a tie so the indicator does not flicker. */
export function reselectTarget(state) {
  const alive = livingMembers(state)
  if (alive.length === 0) {
    state.targetCharId = null
    return
  }
  const current = alive.find((m) => String(m.characterId) === state.targetCharId)
  let best = current || alive[0]
  for (const m of alive) if (m.damage > best.damage) best = m
  state.targetCharId = String(best.characterId)
}

function hydrateCombatState(state, member, monstersData, spellsData) {
  const monster = monstersData?.[state.bossId]
  if (!monster) return null
  const spell = member.combat.spellId ? spellsData?.[member.combat.spellId] ?? null : null
  const engine = createCombatState(monster, member.combat.combatType, member.combat.stance, spell, monstersData)
  Object.assign(engine.monster, state.boss.monster || {})
  engine.monster.currentHP = state.boss.currentHP
  engine.playerAttackTimer = member.combat.playerAttackTimer
  engine.monsterAttackTimer = member.combat.monsterAttackTimer
  engine.eatCooldown = member.combat.eatCooldown
  engine.potionCooldown = member.combat.potionCooldown
  engine.comboCooldown = member.combat.comboCooldown
  engine.specialAttackEnergy = member.combat.specialAttackEnergy
  engine.specialAttackQueued = member.combat.specialAttackQueued
  engine.activeProtectionPrayer = member.combat.activeProtectionPrayer
  engine.activeCombatPrayer = member.combat.activeCombatPrayer
  engine.prayerPoints = member.combat.prayerPoints
  engine.maxPrayerPoints = member.combat.maxPrayerPoints
  engine.prayerDrainAccumulator = member.combat.prayerDrainAccumulator
  engine.activePotions = { ...(member.combat.activePotions || {}) }
  engine.add = state.boss.add ? { ...state.boss.add } : null
  engine.addSpawnCountdown = state.boss.addSpawnCountdown
  engine.addsDefeated = state.boss.addsDefeated
  engine.addTargeted = !!member.combat.addTargeted && !!engine.add
  return engine
}

function dehydrateCombatState(engine, member) {
  member.combat.playerAttackTimer = engine.playerAttackTimer
  member.combat.monsterAttackTimer = engine.monsterAttackTimer
  member.combat.eatCooldown = engine.eatCooldown
  member.combat.potionCooldown = engine.potionCooldown
  member.combat.comboCooldown = engine.comboCooldown
  member.combat.specialAttackEnergy = engine.specialAttackEnergy
  member.combat.specialAttackQueued = engine.specialAttackQueued
  member.combat.activeProtectionPrayer = engine.activeProtectionPrayer
  member.combat.activeCombatPrayer = engine.activeCombatPrayer
  member.combat.prayerPoints = engine.prayerPoints
  member.combat.maxPrayerPoints = engine.maxPrayerPoints
  member.combat.prayerDrainAccumulator = engine.prayerDrainAccumulator
  member.combat.activePotions = { ...(engine.activePotions || {}) }
  member.combat.addTargeted = !!engine.addTargeted
}

function playerStatsFor(member) {
  return {
    attack: member.stats.attack,
    strength: member.stats.strength,
    defence: member.stats.defence,
    ranged: member.stats.ranged,
    magic: member.stats.magic,
    currentHP: member.hp,
  }
}

function removeFromInventory(inventory, itemId, qty) {
  let remaining = Math.max(0, Math.floor(Number(qty) || 0))
  for (let i = 0; i < inventory.length && remaining > 0; i++) {
    const slot = inventory[i]
    if (!slot || slot.itemId !== itemId) continue
    const take = Math.min(slot.quantity || 1, remaining)
    slot.quantity = (slot.quantity || 1) - take
    remaining -= take
    if (slot.quantity <= 0) inventory[i] = null
  }
  return remaining === 0
}

function applyCoopIntent(state, member, action, itemsData, spellsData, events) {
  if (!action || typeof action !== 'object') return
  switch (action.type) {
    case 'change_stance':
      if (COOP_VALID_STANCES.has(action.stance)) member.combat.stance = action.stance
      return
    case 'change_combat_spell':
      member.combat.spellId = action.spellId && spellsData?.[action.spellId] ? action.spellId : null
      return
    case 'queue_special':
      member.combat.specialAttackQueued = !member.combat.specialAttackQueued
      return
    case 'target_add':
      member.combat.addTargeted = !!action.value && !!state.boss.add
      return
    case 'toggle_prayer': {
      const key = action.slot === 'protection' ? 'activeProtectionPrayer' : 'activeCombatPrayer'
      const turningOn = member.combat[key] !== action.prayerId
      if (turningOn && (member.combat.prayerPoints || 0) <= 0) return
      member.combat[key] = turningOn ? action.prayerId : null
      return
    }
    case 'eat': {
      const i = action.inventorySlot
      if (typeof i !== 'number') return
      const slot = member.inventory[i]
      const item = slot ? itemsData?.[slot.itemId] : null
      if (!slot || !isConsumableFood(item)) return
      const combo = isComboConsumable(item)
      if (combo ? member.combat.comboCooldown > 0 : member.combat.eatCooldown > 0) return
      const target = { hp: member.hp, maxHP: member.maxHP, currentHP: member.hp, stats: member.stats }
      const res = applyConsumableEffect(target, item, slot.itemId, 'eat')
      member.hp = Math.min(member.maxHP, target.hp ?? target.currentHP ?? member.hp)
      if (combo) {
        member.combat.comboCooldown = COOP_EAT_TICK_COST
      } else {
        member.combat.eatCooldown = COOP_EAT_TICK_COST
        member.combat.playerAttackTimer = Math.max(member.combat.playerAttackTimer, COOP_EAT_TICK_COST)
      }
      slot.quantity -= 1
      if (slot.quantity <= 0) member.inventory[i] = null
      events.push({ type: 'eat', characterId: member.characterId, itemId: item.id, heal: res?.healed ?? 0, hp: member.hp })
      return
    }
    case 'drink_potion': {
      const i = action.inventorySlot
      if (typeof i !== 'number' || member.combat.comboCooldown > 0) return
      const slot = member.inventory[i]
      const item = slot ? itemsData?.[slot.itemId] : null
      if (!slot || !isConsumablePotion(item)) return
      const target = {
        hp: member.hp, maxHP: member.maxHP, currentHP: member.hp, stats: member.stats,
        activePotions: member.combat.activePotions,
        prayerPoints: member.combat.prayerPoints, maxPrayerPoints: member.combat.maxPrayerPoints,
      }
      const res = applyConsumableEffect(target, item, slot.itemId, 'drink')
      member.hp = Math.min(member.maxHP, target.hp ?? target.currentHP ?? member.hp)
      member.combat.activePotions = { ...(target.activePotions || {}) }
      member.combat.prayerPoints = Math.min(member.combat.maxPrayerPoints, target.prayerPoints ?? member.combat.prayerPoints)
      member.combat.comboCooldown = COOP_EAT_TICK_COST
      if (!item.unlimited) {
        slot.quantity -= 1
        if (slot.quantity <= 0) member.inventory[i] = null
      }
      events.push({ type: 'drink', characterId: member.characterId, itemId: item.id, hp: member.hp, prayerPoints: member.combat.prayerPoints })
      return
    }
    default:
  }
}

function applyConsumptionEvents(member, engineEvents, engine, itemsData) {
  for (const ev of engineEvents) {
    if (ev.type === 'consumeAmmo') {
      const ammo = member.equipment.ammo
      if (!ammo) continue
      const currentQty = Number.isFinite(Number(ammo.quantity)) ? Number(ammo.quantity) : 1
      const nextQty = Math.max(0, currentQty - (ev.qty || 1))
      member.equipment.ammo = nextQty <= 0 ? null : { ...ammo, quantity: nextQty }
    } else if (ev.type === 'consumeCharge') {
      const weapon = member.equipment.weapon
      if (weapon?.charges > 0) member.equipment.weapon = { ...weapon, charges: Math.max(0, weapon.charges - (ev.qty || 1)) }
    } else if (ev.type === 'consumeArmourCharge') {
      for (const slot of ev.slots || []) {
        const piece = member.equipment[slot]
        if (piece?.charges > 0) member.equipment[slot] = { ...piece, charges: Math.max(0, piece.charges - (ev.qty || 1)) }
      }
    } else if (ev.type === 'consumeScroll' && ev.itemId) {
      removeFromInventory(member.inventory, ev.itemId, ev.qty || 1)
    } else if (ev.type === 'xp' && ev.xpSkills) {
      for (const [skill, amount] of Object.entries(ev.xpSkills)) {
        member.xpGained[skill] = (member.xpGained[skill] || 0) + (Number(amount) || 0)
      }
    }
  }
  // Runes are charged on a landed hit and then cleared, mirroring the live game.
  if (engine.runesConsumed) {
    const landed = engineEvents.some((ev) => (ev.type === 'playerHit' || ev.type === 'specialHit') && ((ev.damage ?? ev.totalDamage ?? 0) > 0))
    if (landed) {
      for (const [runeId, qty] of Object.entries(engine.runesConsumed)) removeFromInventory(member.inventory, runeId, qty)
    }
    engine.runesConsumed = null
  }
}

/**
 * Advances the shared fight one tick.
 *
 * Members tick in ascending character id so concurrent damage serializes
 * deterministically. Returns the next state plus this tick's events, and a
 * `kill` record when the boss died (the caller settles loot from it).
 */
export function processCoopTick(state, intents, { itemsData, monstersData, prayersData, spellsData }, now = Date.now()) {
  const next = cloneCoopState(state)
  const events = []
  next.tick = (next.tick || 0) + 1

  if (next.boss.respawnCountdown > 0) {
    next.boss.respawnCountdown -= 1
    if (next.boss.respawnCountdown === 0) respawnBoss(next, monstersData, events)
    return finishTick(next, events, null)
  }

  const orderedIntents = [...(intents || [])].sort(
    (a, b) => (a.tick_number || 0) - (b.tick_number || 0) || (a.characterId || 0) - (b.characterId || 0) || (a.characterSeq || 0) - (b.characterSeq || 0),
  )
  for (const intent of orderedIntents) {
    const member = next.members[String(intent?.characterId)]
    if (!member || member.status !== 'alive') continue
    applyCoopIntent(next, member, intent.action || {}, itemsData, spellsData, events)
  }

  reselectTarget(next)
  const memberIds = Object.keys(next.members).sort((a, b) => Number(a) - Number(b))
  let kill = null

  for (const id of memberIds) {
    const member = next.members[id]
    if (member.status !== 'alive') continue
    if (next.boss.currentHP <= 0) break

    const isTarget = next.targetCharId === id
    const engine = hydrateCombatState(next, member, monstersData, spellsData)
    if (!engine) continue
    // Invariant 1: a non-target member's session must never resolve a boss
    // swing, or the boss attacks once per member per tick.
    if (!isTarget) engine.monsterAttackTimer = Math.max(2, engine.monster.attackSpeed || 4)

    const hpBefore = engine.monster.currentHP
    const addHpBefore = engine.add?.currentHP ?? null
    const { combatState, events: engineEvents } = processCombatTick(
      engine, playerStatsFor(member), member.equipment, itemsData, prayersData, member.inventory, null,
    )

    dehydrateCombatState(combatState, member)
    applyConsumptionEvents(member, engineEvents, combatState, itemsData)

    // Attribution is the boss's HP delta across this member's tick, so every
    // damage source (specials, summons, bolt procs) counts without this having
    // to know each event shape.
    const dealt = Math.max(0, hpBefore - combatState.monster.currentHP)
    if (dealt > 0) {
      member.damage += dealt
      member.damageTick = next.tick
    }
    next.boss.currentHP = Math.max(0, combatState.monster.currentHP)
    Object.assign(next.boss.monster, pickMutableMonsterFields(combatState.monster))

    // Invariant 2: only the target advances the add's spawn countdown, but any
    // member's damage to a live add sticks.
    if (isTarget) {
      next.boss.add = combatState.add ? { ...combatState.add } : null
      next.boss.addSpawnCountdown = combatState.addSpawnCountdown
      next.boss.addsDefeated = combatState.addsDefeated
    } else if (next.boss.add && combatState.add && addHpBefore !== null) {
      next.boss.add.currentHP = Math.min(next.boss.add.currentHP, combatState.add.currentHP)
    } else if (next.boss.add && !combatState.add) {
      next.boss.add = null
      next.boss.addsDefeated = combatState.addsDefeated
    }

    for (const ev of engineEvents) {
      if (ev.type === 'monsterHit' && isTarget) {
        member.hp = Math.max(0, member.hp - (ev.damage || 0))
      } else if ((ev.type === 'dragonfireHit' || ev.type === 'boltProc') && isTarget && ev.selfDamage) {
        member.hp = Math.max(0, member.hp - ev.selfDamage)
      } else if (ev.type === 'guthanHeal' || ev.type === 'sangHeal') {
        member.hp = Math.min(member.maxHP, member.hp + (ev.healAmount || 0))
      }
      if (ev.type === 'monsterDeath') {
        kill = { bossId: next.bossId, monster: ev.monster, xpGained: { ...(ev.xpGained || {}) } }
      }
      events.push({ ...ev, characterId: member.characterId, isTarget })
    }

    if (member.hp <= 0) {
      member.status = 'dead'
      member.hp = 0
      events.push({ type: 'memberDeath', characterId: member.characterId })
      reselectTarget(next)
    }
  }

  if (next.boss.currentHP <= 0 && !next.boss.killedAt) {
    next.boss.killedAt = now
    next.boss.respawnCountdown = coopRespawnTicks(next.bossId)
    const ownerCharId = topDamageCharacterId(next)
    kill = {
      ...(kill || { bossId: next.bossId }),
      ownerCharacterId: ownerCharId ? Number(ownerCharId) : null,
      contributors: damageTable(next),
    }
    events.push({ type: 'bossDefeated', bossId: next.bossId, ownerCharacterId: kill.ownerCharacterId })
  } else if (next.boss.currentHP > 0) {
    kill = null
  }

  return finishTick(next, events, kill)
}

function respawnBoss(state, monstersData, events) {
  const fresh = createCoopBossState(state.bossId, monstersData, Date.now())
  if (!fresh) return
  state.boss = fresh.boss
  for (const member of Object.values(state.members)) {
    member.damage = 0
    member.damageTick = 0
    member.combat.playerAttackTimer = 0
    member.combat.monsterAttackTimer = 0
    member.combat.addTargeted = false
  }
  events.push({ type: 'bossRespawned', bossId: state.bossId })
}

function finishTick(state, events, kill) {
  for (const ev of events) ev.tick = state.tick
  state.recentEvents = [...state.recentEvents, ...events].slice(-40)
  return { stateNext: state, events, kill }
}
