import { addItem } from './inventory.js'
import { equipItem, unequipSlot, getAttackSpeed, getRangedAmmoRequirementFailure, getCombatType } from './equipment.js'
import { rollMeleeAttack, rollRangedAttack, rollMagicAttack } from './combatPrimitives.js'
import prayersData from '../data/prayers.json'
import { isConsumableFood, isConsumablePotion, applyConsumableEffect } from './consumables.js'
import { hitChance, rollDamage } from './formulas.js'
import {
  buildPvpSpecialAttackMeta,
  clampPvpSpecialEnergy,
  getEquippedPvpSpecialAttack,
  SUPPORTED_PVP_SPECIAL_ATTACK_TYPES,
} from './pvpSpecialAttacks.js'

const VALID_STANCES = new Set(['accurate', 'aggressive', 'defensive', 'controlled', 'rapid', 'longrange'])
const PVP_ENGINE_PROTECTION_PRAYER_IDS = new Set(['protection_from_magic', 'protection_from_missiles', 'protection_from_melee'])
export const PVP_SPECIAL_REGEN_INTERVAL_MS = 30_000
export const PVP_SPECIAL_REGEN_AMOUNT = 10
export const PVP_MAX_SPECIAL_ATTACK_ENERGY = 100

function cloneCombatant(c) {
  return {
    ...c,
    stats: { ...c.stats },
    equipment: Object.fromEntries(Object.entries(c.equipment || {}).map(([k, v]) => [k, v ? { ...v } : null])),
    inventory: Array.isArray(c.inventory) ? c.inventory.map((s) => (s ? { ...s } : null)) : [],
    activePotions: { ...(c.activePotions || {}) },
    spell: c.spell ? { ...c.spell } : null,
    specialAttackEnergy: clampPvpSpecialEnergy(c.specialAttackEnergy, 100),
    specialAttackRegeneratedAt: Number(c.specialAttackRegeneratedAt ?? c.specialAttackRegenAt) || null,
    specialAttackQueued: !!c.specialAttackQueued,
  }
}
function cloneState(state) { const combatants = {}; for (const [id, c] of Object.entries(state.combatants || {})) combatants[id] = cloneCombatant(c); return { ...state, combatants, recentEvents: Array.isArray(state.recentEvents) ? [...state.recentEvents] : [] } }
function asPair(state) { const ids = Object.keys(state.combatants).map(Number).sort((a, b) => a - b); if (ids.length !== 2) throw new Error('pvpEngine requires exactly two combatants'); return [state.combatants[String(ids[0])], state.combatants[String(ids[1])], ids] }
function clampCooldowns(c) { c.attackTimer = Math.max(0, c.attackTimer || 0); c.eatCooldown = Math.max(0, c.eatCooldown || 0); c.potionCooldown = Math.max(0, c.potionCooldown || 0) }
function readMsTimestamp(value, fallback) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback }
export function applyPvpSpecialAttackRegenToCombatant(combatant, now = Date.now()) {
  if (!combatant) return { changed: false, ticks: 0 }
  const safeNow = Number(now)
  if (!Number.isFinite(safeNow) || safeNow <= 0) return { changed: false, ticks: 0 }
  const currentEnergy = clampPvpSpecialEnergy(combatant.specialAttackEnergy, 0)
  const previousEnergy = currentEnergy
  let lastRegeneratedAt = readMsTimestamp(combatant.specialAttackRegeneratedAt ?? combatant.specialAttackRegenAt, safeNow)
  if (lastRegeneratedAt > safeNow) lastRegeneratedAt = safeNow
  if (currentEnergy >= PVP_MAX_SPECIAL_ATTACK_ENERGY) {
    combatant.specialAttackEnergy = PVP_MAX_SPECIAL_ATTACK_ENERGY
    combatant.specialAttackRegeneratedAt = safeNow
    return { changed: previousEnergy !== PVP_MAX_SPECIAL_ATTACK_ENERGY, ticks: 0 }
  }
  const elapsedMs = safeNow - lastRegeneratedAt
  const regenTicks = Math.floor(elapsedMs / PVP_SPECIAL_REGEN_INTERVAL_MS)
  if (regenTicks <= 0) { combatant.specialAttackEnergy = currentEnergy; combatant.specialAttackRegeneratedAt = lastRegeneratedAt; return { changed: false, ticks: 0 } }
  const nextEnergy = Math.min(PVP_MAX_SPECIAL_ATTACK_ENERGY, currentEnergy + regenTicks * PVP_SPECIAL_REGEN_AMOUNT)
  combatant.specialAttackEnergy = nextEnergy
  combatant.specialAttackRegeneratedAt = nextEnergy >= PVP_MAX_SPECIAL_ATTACK_ENERGY ? safeNow : lastRegeneratedAt + regenTicks * PVP_SPECIAL_REGEN_INTERVAL_MS
  return { changed: nextEnergy !== previousEnergy, ticks: regenTicks }
}
export function applyPvpSpecialAttackRegenToState(state, now = Date.now()) {
  const next = cloneState(state)
  let changed = false
  for (const combatant of Object.values(next.combatants || {})) changed = applyPvpSpecialAttackRegenToCombatant(combatant, now).changed || changed
  return { state: next, changed }
}
function rapidAdjustedSpeed(combatant, itemsData) { const base = getAttackSpeed(combatant.equipment, itemsData); return (combatant.combatType === 'ranged' && combatant.stance === 'rapid') ? Math.max(1, base - 1) : base }
function attackSnapshot(attacker, defender, itemsData) { if (attacker.combatType === 'ranged') return rollRangedAttack(attacker, defender, itemsData); if (attacker.combatType === 'magic') return rollMagicAttack(attacker, defender, itemsData); return rollMeleeAttack(attacker, defender, itemsData) }
function pvpRandInt(min, max) { const lo = Math.ceil(Math.min(min, max)); const hi = Math.floor(Math.max(min, max)); return lo + Math.floor(Math.random() * (hi - lo + 1)) }
function consumeEquippedAmmo(combatant, qty = 1) { const ammo = combatant?.equipment?.ammo; if (!ammo) return false; const currentQty = Number.isFinite(Number(ammo.quantity)) ? Number(ammo.quantity) : 1; const nextQty = Math.max(0, currentQty - qty); combatant.equipment.ammo = nextQty <= 0 ? null : { ...ammo, quantity: nextQty }; return true }
function rangedAmmoBlockedSwing(attacker, itemsData) { if (attacker?.combatType !== 'ranged') return null; const failure = getRangedAmmoRequirementFailure(attacker.equipment, itemsData); if (!failure) return null; attacker.specialAttackQueued = false; return { blocked: true, ammoFailure: failure, damage: 0 } }

function rollModifiedSwing(attacker, defender, itemsData, opts = {}) {
  const base = attackSnapshot(attacker, defender, itemsData)
  const attackRoll = Math.max(0, Math.floor((base.attackRoll || 0) * (Number(opts.accuracyMultiplier ?? 1) || 1)))
  const defenceRoll = Math.max(0, Number(base.defenceRoll) || 0)
  const maxHit = Math.max(0, Math.floor((base.maxHit || 0) * (Number(opts.maxHitMultiplier ?? opts.damageMultiplier ?? 1) || 1)))
  const accuracy = hitChance(attackRoll, defenceRoll)
  const damage = rollDamage(accuracy, maxHit)
  return { ...base, attackRoll, defenceRoll, accuracy, maxHit, damage, hit: damage > 0 }
}
const combineHits = (baseSwing, hits) => ({ ...baseSwing, damage: hits.reduce((s, h) => s + Math.max(0, Math.floor(Number(h) || 0)), 0), hit: hits.some(h => h > 0), hits: hits.map(h => Math.max(0, Math.floor(Number(h) || 0))) })
const capHitsToHp = (hits, hp) => { let rem = Math.max(0, Math.floor(Number(hp) || 0)); return (hits || []).map((h) => { const c = Math.min(Math.max(0, Math.floor(Number(h) || 0)), rem); rem -= c; return c }) }
function attachSpecialMetadata(attacker, weapon, spec, energyBefore, energyAfter, swing, extra = {}) {
  const hits = Array.isArray(swing.hits) ? swing.hits : [swing.damage || 0]
  const totalDamage = hits.reduce((sum, hit) => sum + Math.max(0, Math.floor(Number(hit) || 0)), 0)
  return { ...swing, damage: totalDamage, special: true, specType: spec.type || 'special', energyCost: Math.max(0, Number(spec.energyCost) || 0), hits, totalDamage, specialAttack: buildPvpSpecialAttackMeta({ attacker, weapon, spec, energyBefore, energyAfter, hits, totalDamage, extra }) }
}

function resolveSwing(attacker, defender, itemsData, events) {
  const ammoBlocked = rangedAmmoBlockedSwing(attacker, itemsData)
  if (ammoBlocked) return ammoBlocked
  const equipped = getEquippedPvpSpecialAttack(attacker, itemsData)
  const weapon = equipped?.weapon || null
  const spec = equipped?.specialAttack || null
  const queued = !!attacker.specialAttackQueued
  attacker.specialAttackQueued = false
  if (!queued) return attackSnapshot(attacker, defender, itemsData)
  if (!weapon || !spec) { events.push({ type: 'spec_failed', characterId: attacker.characterId, reason: 'no_special_attack' }); return attackSnapshot(attacker, defender, itemsData) }
  const specType = spec.type || 'special'
  if (!SUPPORTED_PVP_SPECIAL_ATTACK_TYPES.has(specType)) { events.push({ type: 'spec_failed', characterId: attacker.characterId, reason: 'unsupported_special_attack', specType }); return attackSnapshot(attacker, defender, itemsData) }
  const energyCost = Math.max(0, Number(spec.energyCost) || 0)
  const energyBefore = clampPvpSpecialEnergy(attacker.specialAttackEnergy, 0)
  if (energyBefore < energyCost) { events.push({ type: 'spec_failed', characterId: attacker.characterId, reason: 'insufficient_energy', energyCost, energy: energyBefore }); return attackSnapshot(attacker, defender, itemsData) }
  const energyAfter = Math.max(0, energyBefore - energyCost); attacker.specialAttackEnergy = energyAfter
  let swing = attackSnapshot(attacker, defender, itemsData); const extra = {}; const accMult = Number(spec.accuracyMultiplier ?? spec.accuracyMult ?? 1) || 1; const dmgMult = Number(spec.maxHitMultiplier ?? spec.damageMultiplier ?? spec.damageMult ?? 1) || 1
  if (specType === 'double_hit') swing = combineHits(rollModifiedSwing(attacker, defender, itemsData, { accuracyMultiplier: accMult || 1.15, maxHitMultiplier: dmgMult || 1.15 }), [rollModifiedSwing(attacker, defender, itemsData, { accuracyMultiplier: accMult || 1.15, maxHitMultiplier: dmgMult || 1.15 }).damage || 0, rollModifiedSwing(attacker, defender, itemsData, { accuracyMultiplier: accMult || 1.15, maxHitMultiplier: dmgMult || 1.15 }).damage || 0])
  else if (specType === 'slice_and_dice') { const opener = rollModifiedSwing(attacker, defender, itemsData, { accuracyMultiplier: accMult || 1.25, maxHitMultiplier: dmgMult || 1.1 }); swing = (opener.damage || 0) > 0 ? combineHits(opener, [opener.damage || 0, Math.floor((opener.damage || 0) / 2), Math.floor(Math.floor((opener.damage || 0) / 2) / 2), Math.ceil(Math.floor((opener.damage || 0) / 2) / 2)]) : combineHits(opener, [0, 0, 0, 0]) }
  else if (specType === 'zero_defence') swing = attackSnapshot(attacker, { ...defender, stats: { ...(defender.stats || {}), defence: 1 }, equipment: {} }, itemsData)
  else if (specType === 'judgement') swing = rollModifiedSwing(attacker, defender, itemsData, { maxHitMultiplier: dmgMult || 1.25 })
  else if (specType === 'healing_blade') { swing = rollModifiedSwing(attacker, defender, itemsData, { accuracyMultiplier: accMult, maxHitMultiplier: dmgMult }); const healAmount = Math.max(spec.minHeal || 10, Math.floor((swing.damage || 0) / 2)); attacker.hp = Math.min(attacker.maxHP || attacker.hp || 0, (attacker.hp || 0) + healAmount); swing.healAmount = healAmount; extra.healAmount = healAmount }
  else if (specType === 'freeze') { swing = rollModifiedSwing(attacker, defender, itemsData, { accuracyMultiplier: accMult, maxHitMultiplier: dmgMult }); if ((swing.damage || 0) > 0) { const st = spec.stunTicks || spec.freezeTicks || 33; defender.attackTimer = (defender.attackTimer || 0) + st; extra.frozen = true; extra.stunTicks = st } }
  else if (specType === 'stun') { swing = rollModifiedSwing(attacker, defender, itemsData, { accuracyMultiplier: accMult, maxHitMultiplier: dmgMult }); if ((swing.damage || 0) > 0) extra.stunned = true }
  else if (specType === 'shove') { swing = rollModifiedSwing(attacker, defender, itemsData, { accuracyMultiplier: accMult, maxHitMultiplier: dmgMult }); if ((swing.damage || 0) > 0) { defender.attackTimer = (defender.attackTimer || 0) + (rapidAdjustedSpeed(defender, itemsData) * 2); extra.stunned = true } }
  else if (specType === 'warstrike') { swing = rollModifiedSwing(attacker, defender, itemsData, { accuracyMultiplier: accMult, maxHitMultiplier: dmgMult }); if ((swing.damage || 0) > 0) { defender.stats = { ...(defender.stats || {}), defence: Math.max(1, (defender.stats?.defence || 1) - swing.damage) }; extra.defenceReducedBy = swing.damage } }
  else if (specType === 'smash') { swing = rollModifiedSwing(attacker, defender, itemsData, { accuracyMultiplier: accMult, maxHitMultiplier: dmgMult || 1.5 }); if ((swing.damage || 0) > 0) { const currentDef = Math.max(0, defender.stats?.defence || 0); const reduction = Math.floor(currentDef * 0.3); defender.stats = { ...(defender.stats || {}), defence: Math.max(1, currentDef - reduction) }; extra.defenceReducedBy = reduction } }
  else if (specType === 'lightning') { const base = rollModifiedSwing(attacker, defender, itemsData, { accuracyMultiplier: accMult, maxHitMultiplier: dmgMult }); const lightning = pvpRandInt(1, spec.lightningMax || 16); swing = combineHits(base, [base.damage || 0, lightning]); extra.lightning = lightning }
  else if (specType === 'snapshot') swing = combineHits(rollModifiedSwing(attacker, defender, itemsData, { accuracyMultiplier: accMult, maxHitMultiplier: spec.maxHitMultiplier ?? spec.damageMultiplier ?? 0.75 }), [rollModifiedSwing(attacker, defender, itemsData, { accuracyMultiplier: accMult, maxHitMultiplier: spec.maxHitMultiplier ?? spec.damageMultiplier ?? 0.75 }).damage || 0, rollModifiedSwing(attacker, defender, itemsData, { accuracyMultiplier: accMult, maxHitMultiplier: spec.maxHitMultiplier ?? spec.damageMultiplier ?? 0.75 }).damage || 0])
  else if (specType === 'pebble_shot') { const base = attackSnapshot(attacker, defender, itemsData); const max = Math.max(1, Math.floor((base.maxHit || 1) * (spec.maxHitMultiplier || 1.25))); swing = { ...base, damage: pvpRandInt(1, max), maxHit: max, hit: true, hits: [pvpRandInt(1, max)] } }
  else if (specType === 'toxic_siphon') { swing = rollModifiedSwing(attacker, defender, itemsData, { accuracyMultiplier: accMult || 2, maxHitMultiplier: dmgMult || 1.5 }); const healAmount = Math.floor((swing.damage || 0) / 2); if (healAmount > 0) attacker.hp = Math.min(attacker.maxHP || attacker.hp || 0, (attacker.hp || 0) + healAmount); extra.healAmount = healAmount }
  else if (specType === 'lunge') swing = rollModifiedSwing(attacker, defender, itemsData, { accuracyMultiplier: accMult || 1.25, maxHitMultiplier: dmgMult || 1.2 })
  else if (specType === 'triple_hit') swing = combineHits(rollModifiedSwing(attacker, defender, itemsData, { accuracyMultiplier: accMult || 1, maxHitMultiplier: dmgMult || 1 }), [rollModifiedSwing(attacker, defender, itemsData, { accuracyMultiplier: accMult || 1, maxHitMultiplier: dmgMult || 1 }).damage || 0, rollModifiedSwing(attacker, defender, itemsData, { accuracyMultiplier: accMult || 1, maxHitMultiplier: dmgMult || 1 }).damage || 0, rollModifiedSwing(attacker, defender, itemsData, { accuracyMultiplier: accMult || 1, maxHitMultiplier: dmgMult || 1 }).damage || 0])
  else if (specType === 'descent_of_darkness') swing = combineHits(rollModifiedSwing(attacker, defender, itemsData, { accuracyMultiplier: accMult, maxHitMultiplier: spec.maxHitMultiplier ?? spec.damageMultiplier ?? 1.5 }), [rollModifiedSwing(attacker, defender, itemsData, { accuracyMultiplier: accMult, maxHitMultiplier: spec.maxHitMultiplier ?? spec.damageMultiplier ?? 1.5 }).damage || 0, rollModifiedSwing(attacker, defender, itemsData, { accuracyMultiplier: accMult, maxHitMultiplier: spec.maxHitMultiplier ?? spec.damageMultiplier ?? 1.5 }).damage || 0])
  else if (specType === 'overpower') swing = rollModifiedSwing(attacker, defender, itemsData, { maxHitMultiplier: dmgMult || 1.5 })
  return attachSpecialMetadata(attacker, weapon, spec, energyBefore, energyAfter, swing, extra)
}

function terminalResult(next, winnerId, loserId, reason, events) { return { stateNext: next, events, terminal: { winner: winnerId, loser: loserId, reason } } }
function applyIntent(combatant, intentAction, itemsData, events) { if (!intentAction || typeof intentAction !== 'object') return; if (intentAction.type === 'change_stance') { if (VALID_STANCES.has(intentAction.stance)) combatant.stance = intentAction.stance; return } if (intentAction.type === 'change_combat_spell') { combatant.spell = intentAction.spellId ? { id: intentAction.spellId } : null; return } if (intentAction.type === 'queue_special') { combatant.specialAttackQueued = !combatant.specialAttackQueued; return }
if (intentAction.type === 'toggle_prayer') { const prayer = prayersData?.[intentAction.prayerId]; const isProtectionPrayer = prayer?.bonusType === 'protection' || PVP_ENGINE_PROTECTION_PRAYER_IDS.has(intentAction.prayerId); if (typeof intentAction.prayerId === 'string' && prayer && !isProtectionPrayer) combatant.activeCombatPrayer = combatant.activeCombatPrayer === intentAction.prayerId ? null : intentAction.prayerId; return }
if (intentAction.type === 'equip') { const i = intentAction.inventorySlot; if (typeof i !== 'number' || i < 0 || i >= combatant.inventory.length) return; const slot = combatant.inventory[i]; if (!slot) return; const item = itemsData?.[slot.itemId]; if (!item?.slot) return; const result = equipItem(combatant.equipment, item, itemsData, slot); if (!result?.equipped) return; if (item.slot === 'weapon') combatant.combatType = getCombatType(combatant.equipment, itemsData); combatant.attackTimer = Math.max(combatant.attackTimer || 0, rapidAdjustedSpeed(combatant, itemsData)); combatant.inventory[i] = null; for (const uneq of result.unequipped || []) addItem(combatant.inventory, uneq.itemId, uneq.quantity || 1, !!itemsData?.[uneq.itemId]?.stackable); return }
if (intentAction.type === 'unequip') { const eqSlot = intentAction.equipmentSlot; if (!eqSlot) return; const removed = unequipSlot(combatant.equipment, eqSlot); if (!removed) return; addItem(combatant.inventory, removed.itemId, removed.quantity || 1, !!itemsData?.[removed.itemId]?.stackable); return }
if (intentAction.type === 'eat') { const i = intentAction.inventorySlot; if ((combatant.eatCooldown || 0) > 0 || typeof i !== 'number') return; const slot = combatant.inventory[i]; const item = slot ? itemsData?.[slot.itemId] : null; if (!slot || !isConsumableFood(item)) return; const res = applyConsumableEffect(combatant, item, slot.itemId, 'eat'); combatant.eatCooldown = 3; combatant.attackTimer = Math.max(combatant.attackTimer || 0, rapidAdjustedSpeed(combatant, itemsData) + 1); slot.quantity -= 1; if (slot.quantity <= 0) combatant.inventory[i] = null; events.push({ type: 'eat', characterId: combatant.characterId, itemId: item.id, heal: res.healed }); return }
if (intentAction.type === 'drink_potion') { const i = intentAction.inventorySlot; if ((combatant.potionCooldown || 0) > 0 || typeof i !== 'number') return; const slot = combatant.inventory[i]; const item = slot ? itemsData?.[slot.itemId] : null; if (!slot || !isConsumablePotion(item)) return; const res = applyConsumableEffect(combatant, item, slot.itemId, 'drink'); combatant.potionCooldown = 3; slot.quantity -= 1; if (slot.quantity <= 0) combatant.inventory[i] = null; events.push({ type: 'drink', characterId: combatant.characterId, itemId: item.id, heal: res.healed || undefined }) } }

export function createPvpState(aCombatant, bCombatant, now = Date.now(), rngSeed = 0) {
  const a = cloneCombatant(aCombatant)
  const b = cloneCombatant(bCombatant)
  return { tick: 0, startedAt: now, combatants: { [String(a.characterId)]: { ...a, hp: a.hp ?? a.currentHP ?? a.maxHP, attackTimer: a.attackTimer ?? 0, eatCooldown: a.eatCooldown ?? 0, potionCooldown: a.potionCooldown ?? 0, specialAttackEnergy: 100, specialAttackRegeneratedAt: now, specialAttackQueued: false }, [String(b.characterId)]: { ...b, hp: b.hp ?? b.currentHP ?? b.maxHP, attackTimer: b.attackTimer ?? 0, eatCooldown: b.eatCooldown ?? 0, potionCooldown: b.potionCooldown ?? 0, specialAttackEnergy: 100, specialAttackRegeneratedAt: now, specialAttackQueued: false } }, recentEvents: [], rngSeed }
}

export function processPvpTick(state, intents, itemsData, now = Date.now()) {
  const next = cloneState(state); const events = []; const [left, right, ids] = asPair(next)
  for (const c of [left, right]) applyPvpSpecialAttackRegenToCombatant(c, now)
  const orderedIntents = [...(intents || [])].sort((x, y) => ((x.tick_number || 0) - (y.tick_number || 0)) || ((x.characterId || 0) - (y.characterId || 0)) || ((x.characterSeq || 0) - (y.characterSeq || 0)))
  for (const intent of orderedIntents) { const c = next.combatants[String(intent?.characterId)]; if (!c) continue; const action = intent?.action || {}; if (action.type === 'forfeit') { events.push({ type: 'forfeit', characterId: c.characterId }); const opponent = c.characterId === left.characterId ? right : left; next.tick = (next.tick || 0) + 1; for (const ev of events) ev.tick = next.tick; next.recentEvents = [...next.recentEvents, ...events].slice(-20); return terminalResult(next, opponent.characterId, c.characterId, 'forfeit', events) } applyIntent(c, action, itemsData, events) }
  for (const c of [left, right]) { c.attackTimer = (c.attackTimer || 0) - 1; c.eatCooldown = (c.eatCooldown || 0) - 1; c.potionCooldown = (c.potionCooldown || 0) - 1; for (const [pid, ticks] of Object.entries(c.activePotions || {})) { c.activePotions[pid] = Math.max(0, (ticks || 0) - 1); if (c.activePotions[pid] <= 0) delete c.activePotions[pid] } clampCooldowns(c) }
  const leftSwing = (left.hp > 0 && left.attackTimer === 0 && left.eatCooldown === 0) ? resolveSwing(left, right, itemsData, events) : null
  const rightSwing = (right.hp > 0 && right.attackTimer === 0 && right.eatCooldown === 0) ? resolveSwing(right, left, itemsData, events) : null
  const leftDamage = leftSwing ? Math.max(0, Math.min(right.hp, leftSwing.damage || 0)) : 0
  const rightDamage = rightSwing ? Math.max(0, Math.min(left.hp, rightSwing.damage || 0)) : 0
  if (leftSwing?.blocked) { events.push({ type: 'no_ammo', characterId: left.characterId, ...(leftSwing.ammoFailure || {}) }); left.attackTimer = rapidAdjustedSpeed(left, itemsData) }
  else if (leftSwing) { const hits = Array.isArray(leftSwing.hits) ? capHitsToHp(leftSwing.hits, right.hp) : undefined; const totalDamage = hits ? hits.reduce((sum, hit) => sum + hit, 0) : leftDamage; const specialAttack = leftSwing.specialAttack ? { ...leftSwing.specialAttack, hits: hits || [leftDamage], totalDamage } : undefined; events.push({ type: 'attack', attackerCharacterId: left.characterId, defenderCharacterId: right.characterId, ...leftSwing, damage: totalDamage, totalDamage, ...(hits ? { hits } : {}), ...(specialAttack ? { specialAttack } : {}) }); if (left.combatType === 'ranged') consumeEquippedAmmo(left, 1); left.attackTimer = rapidAdjustedSpeed(left, itemsData) }
  if (rightSwing?.blocked) { events.push({ type: 'no_ammo', characterId: right.characterId, ...(rightSwing.ammoFailure || {}) }); right.attackTimer = rapidAdjustedSpeed(right, itemsData) }
  else if (rightSwing) { const hits = Array.isArray(rightSwing.hits) ? capHitsToHp(rightSwing.hits, left.hp) : undefined; const totalDamage = hits ? hits.reduce((sum, hit) => sum + hit, 0) : rightDamage; const specialAttack = rightSwing.specialAttack ? { ...rightSwing.specialAttack, hits: hits || [rightDamage], totalDamage } : undefined; events.push({ type: 'attack', attackerCharacterId: right.characterId, defenderCharacterId: left.characterId, ...rightSwing, damage: totalDamage, totalDamage, ...(hits ? { hits } : {}), ...(specialAttack ? { specialAttack } : {}) }); if (right.combatType === 'ranged') consumeEquippedAmmo(right, 1); right.attackTimer = rapidAdjustedSpeed(right, itemsData) }
  right.hp = Math.max(0, right.hp - leftDamage); left.hp = Math.max(0, left.hp - rightDamage); left.currentHP = left.hp; right.currentHP = right.hp
  // Tag events with the tick they landed on so clients can dedup recentEvents
  // across polls (tick responses only carry events for the advancing caller).
  next.tick = (next.tick || 0) + 1; for (const ev of events) ev.tick = next.tick; next.recentEvents = [...next.recentEvents, ...events].slice(-20)
  const leftDead = left.hp <= 0; const rightDead = right.hp <= 0
  if (leftDead || rightDead) { if (leftDead && rightDead) return terminalResult(next, ids[0], ids[1], 'death', events); return terminalResult(next, leftDead ? right.characterId : left.characterId, leftDead ? left.characterId : right.characterId, 'death', events) }
  return { stateNext: next, events, terminal: null }
}

export function applyPvpTick(state, intents, itemsData, now = Date.now()) { const out = processPvpTick(state, intents, itemsData, now); return { state: out.stateNext, events: out.events, terminal: out.terminal } }
