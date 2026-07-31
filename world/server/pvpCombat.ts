// Player-versus-player combat in the Wilderness.
//
// The swing maths are NOT here. src/engine/pvpEngine.js's resolveSwing already
// owns accuracy, max hit, every special attack, magic rune sourcing and ranged
// ammo for two player-shaped combatants, and it is what the duel system has
// always used — so this module builds a combatant VIEW over a live world
// session, hands it to that function, and writes the result back. A second set
// of PvP maths would drift from the first inside one release.
//
// What is genuinely new out here, and therefore lives in this file:
//   * reach and line of sight (a duel happens on a tile grid, the idle duel
//     did not),
//   * the single-combat lock, which is a property of a crowded zone rather
//     than of a match with exactly two seats,
//   * protection prayers, which the idle duel disables (§10 v1) and the
//     Wilderness deliberately does not.
import { resolveSwing } from '../../src/engine/pvpEngine.js'
import { getAttackSpeed, getCombatType, getAttackStyle, getEquipmentBonuses } from '../../src/engine/equipment.js'
import { applyPrayerDrainTick } from '../../src/engine/prayerDrain.js'
import { getPrayerDrainMultiplier, getDamageReductionPerk, applyDamageReduction } from '../../src/engine/damageReduction.js'
import { resolveMagicSpell } from '../../src/engine/equipment.js'
import itemsData from '../../src/data/items.json'
import spellsData from '../../src/data/spells.json'
import prayersData from '../../src/data/prayers.json'
import { protectionReduction } from '../shared/prayer'
import { isDangerTile, pvpAttackRefusal, PVP_COMBAT_LOCK_TICKS, type AttackRefusal, type PvpCandidate } from '../shared/pvpArea'
import { withinRangeAndSight, rangeForCombatType } from './tick'
import type { InvSlot } from '../shared/protocol'

const items = itemsData as unknown as Record<string, Record<string, unknown> | undefined>

/**
 * Everything the duel needs from a fighter, satisfied by BOTH a live world
 * player (WorldZone's Player) and a roaming bot (pvpBots.ts BotState) — the
 * whole reason a bot can be attacked with the same code path a player is.
 *
 * `combatantId` is a NUMBER because the bot AI (src/engine/pvpBotAI.js) picks
 * its opponent out of a combatant map with `Number(id) !== Number(botId)`.
 * Real characters use their character id; bots use a negative one, so the two
 * can never collide and NaN never compares against itself.
 */
export type PvpFighter = {
  charId: string
  combatantId: number
  name: string
  x: number
  z: number
  hp: number
  maxHp: number
  /** Levels only — the duel never reads XP. */
  levels: Record<string, number>
  combatLevel: number
  equipment: Record<string, unknown>
  inventory: InvSlot[]
  stance: string
  spell: string | null
  prayerPoints: number
  maxPrayerPoints: number
  prayerDrainAccumulator: number
  activeProtectionPrayer: string | null
  activeCombatPrayer: string | null
  activePotions: Record<string, number>
  specialEnergy: number
  specialAttackQueued: boolean
  /** Ticks until this fighter's next swing. Counted down by stepPvpFight only. */
  pvpAttackTimer: number
  /** Who they are locked with, and until when. */
  pvpOpponentId: string | null
  pvpLockUntilTick: number
  /** This fighter walked away: they are still IN the fight (their opponent can
   * still reach and hit them, and single combat still holds) but they land
   * nothing until they click Attack again. Mirrors CombatSession.passive in
   * PvE. Bots are never passive — walking is how they close the gap. */
  pvpPassive?: boolean
  isBot: boolean
  anim: string
}

/** The combatant shape src/engine/pvpEngine.js + combatPrimitives.js read. */
type Combatant = Record<string, unknown>

export type PvpSwingOutcome = {
  attackerId: string
  defenderId: string
  /** One entry per hitsplat; 0 is a miss/block, which the client still draws. */
  splats: number[]
  /** Total damage after protection prayers and worn reduction perks. */
  damage: number
  /** The swing spent special energy. */
  special: boolean
  /** Runes the cast consumed, to drain out of the attacker's real pack. */
  runesConsumed: Record<string, number> | null
  /** Ranged ammo the shot consumed. */
  ammoConsumed: { itemId: string; qty: number } | null
  /** The engine refused the swing (no runes / no ammo) — the message to send. */
  refusal: string | null
}

export type PvpTickOutput = {
  swings: PvpSwingOutcome[]
  /** charIds whose HP reached 0 this tick, paired with their killer. */
  deaths: { victimId: string; killerId: string }[]
}

export type ApproachPlan =
  /** Already close enough — stop walking and let the fight start. */
  | { kind: 'arrived' }
  /** Keep the current path; the target has not moved since it was computed. */
  | { kind: 'hold' }
  /** Re-path: the target moved, or we have run out of path without arriving. */
  | { kind: 'repath' }

/**
 * What an attacker chasing `target` should do this tick.
 *
 * Pure, because the alternative — deciding it inline in the Durable Object —
 * is untestable, and this is precisely the decision that was wrong: one path
 * computed at the click walked the attacker to the tile their target had
 * already left, and the fight never started. Bots hold at their own weapon's
 * range and players run, so a stale path is the normal case, not the edge one.
 *
 * `chaseTile` is the target tile the live path was computed for (null when
 * there isn't one). Holding while the target is stationary is what keeps this
 * from costing a pathfind every tick for every chaser.
 */
export function pvpApproachPlan(
  attacker: { x: number; z: number },
  target: { x: number; z: number },
  range: number,
  chaseTile: { x: number; z: number } | null,
  pathLength: number,
): ApproachPlan {
  if (Math.max(Math.abs(attacker.x - target.x), Math.abs(attacker.z - target.z)) <= range) return { kind: 'arrived' }
  if (pathLength === 0) return { kind: 'repath' }
  if (!chaseTile || chaseTile.x !== target.x || chaseTile.z !== target.z) return { kind: 'repath' }
  return { kind: 'hold' }
}

/** A fighter's own attack reach in tiles, from the weapon they hold. */
export function pvpAttackRange(fighter: PvpFighter): number {
  return rangeForCombatType(getCombatType(fighter.equipment, items))
}

export function pvpCandidate(fighter: PvpFighter, tick: number): PvpCandidate {
  return {
    charId: fighter.charId,
    combatLevel: fighter.combatLevel,
    x: fighter.x,
    z: fighter.z,
    opponentId: fighter.pvpOpponentId,
    locked: fighter.pvpLockUntilTick > tick,
  }
}

/** The whole eligibility gate, in the zone's terms. */
export function refuseAttack(
  zoneId: string,
  attacker: PvpFighter,
  target: PvpFighter,
  tick: number,
): AttackRefusal | null {
  return pvpAttackRefusal(zoneId, pvpCandidate(attacker, tick), pvpCandidate(target, tick))
}

/**
 * Locks two fighters together. Both sides get the lock — being attacked engages
 * you exactly as attacking does, which is what makes single combat symmetric:
 * a third party can no more jump the victim than the aggressor.
 */
export function beginPvpFight(attacker: PvpFighter, target: PvpFighter, tick: number): void {
  attacker.pvpOpponentId = target.charId
  target.pvpOpponentId = attacker.charId
  refreshPvpLock(attacker, target, tick)
}

/** Pushes the lock out to its full window for both sides. */
export function refreshPvpLock(a: PvpFighter, b: PvpFighter, tick: number): void {
  const until = tick + PVP_COMBAT_LOCK_TICKS
  a.pvpLockUntilTick = until
  b.pvpLockUntilTick = until
}

/** Releases a fighter from whatever they were locked in. Idempotent. */
export function endPvpFight(fighter: PvpFighter, other: PvpFighter | null): void {
  fighter.pvpOpponentId = null
  fighter.pvpLockUntilTick = 0
  fighter.pvpAttackTimer = 0
  fighter.specialAttackQueued = false
  fighter.pvpPassive = false
  if (other && other.pvpOpponentId === fighter.charId) {
    other.pvpOpponentId = null
    other.pvpLockUntilTick = 0
    other.pvpAttackTimer = 0
    other.specialAttackQueued = false
    other.pvpPassive = false
  }
}

/** Resolves this fighter's combat type + spell exactly as PvE does, so a magic
 * weapon with no spell selected splashes nothing instead of splashing zeroes. */
function combatSetup(fighter: PvpFighter): { combatType: string; spell: unknown; needsSpell: boolean } {
  const active = fighter.spell ? { id: fighter.spell } : null
  const { combatType, isPoweredStaff, spell, needsSpell } = resolveMagicSpell(fighter.equipment, items, active, spellsData)
  if (combatType !== 'magic') return { combatType, spell: null, needsSpell: false }
  if (needsSpell) return { combatType, spell: null, needsSpell: true }
  return { combatType, spell: isPoweredStaff ? null : spell, needsSpell: false }
}

/**
 * The pvpEngine-shaped view of a live fighter.
 *
 * Deliberately shares the fighter's OWN inventory array rather than copying it:
 * resolveSwing never mutates the pack (it reports `runesToConsume` and leaves
 * the draining to the caller), and a copy here would mean a rune check run
 * against a stale pack the moment anything else in the tick ate a slot.
 */
export function toCombatant(fighter: PvpFighter): Combatant {
  const setup = combatSetup(fighter)
  return {
    characterId: fighter.combatantId,
    stats: {
      attack: fighter.levels.attack ?? 1,
      strength: fighter.levels.strength ?? 1,
      defence: fighter.levels.defence ?? 1,
      ranged: fighter.levels.ranged ?? 1,
      magic: fighter.levels.magic ?? 1,
      hitpoints: fighter.maxHp,
      prayer: fighter.levels.prayer ?? 1,
    },
    equipment: fighter.equipment,
    inventory: fighter.inventory,
    hp: fighter.hp,
    currentHP: fighter.hp,
    maxHP: fighter.maxHp,
    combatType: setup.combatType,
    stance: fighter.stance,
    spell: setup.spell,
    prayerPoints: fighter.prayerPoints,
    maxPrayerPoints: fighter.maxPrayerPoints,
    prayerDrainAccumulator: fighter.prayerDrainAccumulator,
    activeProtectionPrayer: fighter.activeProtectionPrayer,
    activeCombatPrayer: fighter.activeCombatPrayer,
    activePotions: fighter.activePotions,
    specialAttackEnergy: fighter.specialEnergy,
    specialAttackQueued: fighter.specialAttackQueued,
    attackTimer: fighter.pvpAttackTimer,
  }
}

/** Writes back the fields resolveSwing is allowed to move on the ATTACKER:
 * energy it spent, the queued flag it cleared, and the HP a life-stealing
 * special restored. Everything else on the view is read-only by contract. */
function syncAttackerBack(fighter: PvpFighter, combatant: Combatant): void {
  fighter.specialEnergy = Math.max(0, Math.min(100, Number(combatant.specialAttackEnergy) || 0))
  fighter.specialAttackQueued = !!combatant.specialAttackQueued
  const healedTo = Number(combatant.hp)
  if (Number.isFinite(healedTo) && healedTo > fighter.hp) fighter.hp = Math.min(fighter.maxHp, Math.floor(healedTo))
  fighter.prayerPoints = Math.max(0, Math.min(fighter.maxPrayerPoints, Number(combatant.prayerPoints) || 0))
}

/** And on the DEFENDER: the stat drains and stuns some specials apply. */
function syncDefenderBack(fighter: PvpFighter, combatant: Combatant): void {
  const stats = combatant.stats as Record<string, number> | undefined
  if (stats && Number.isFinite(stats.defence)) fighter.levels.defence = Math.max(1, Math.floor(stats.defence))
  const stunned = Number(combatant.attackTimer)
  if (Number.isFinite(stunned) && stunned > fighter.pvpAttackTimer) fighter.pvpAttackTimer = Math.floor(stunned)
}

const REFUSAL_TEXT: Record<string, string> = {
  no_runes: 'You do not have enough runes to cast that spell.',
  no_spell: 'You need to select a spell to fight with that weapon.',
}

/**
 * One swing from `attacker` at `defender`, if their clock says so. Mutates both
 * fighters and appends to `out`. Returns nothing — everything a caller needs is
 * on `out` or on the fighters themselves.
 *
 * The reach test is the attacker's OWN weapon range against the defender, with
 * line of sight for anything past melee: exactly the rule PvE combat uses, so
 * a pillar blocks an arrow whoever is behind it.
 */
function swingOnce(
  attacker: PvpFighter,
  defender: PvpFighter,
  collision: string[],
  out: PvpTickOutput,
): void {
  if (attacker.hp <= 0 || defender.hp <= 0) return
  // Disengaged: they walked away from this fight, so nothing of theirs lands
  // until a fresh Attack click. The fight itself survives — their opponent is
  // still swinging at them, which is the whole reason running is a gamble.
  if (attacker.pvpPassive) return
  if (attacker.pvpAttackTimer > 0) return
  if (!withinRangeAndSight(attacker, defender, pvpAttackRange(attacker), collision)) return

  const setup = combatSetup(attacker)
  if (setup.needsSpell) {
    // Refused once per swing window rather than every tick: the timer is reset
    // below, so this cannot spam the message.
    attacker.pvpAttackTimer = Math.max(2, getAttackSpeed(attacker.equipment, items) || 4)
    out.swings.push({
      attackerId: attacker.charId, defenderId: defender.charId, splats: [], damage: 0,
      special: false, runesConsumed: null, ammoConsumed: null, refusal: REFUSAL_TEXT.no_spell,
    })
    return
  }

  const attackerView = toCombatant(attacker)
  const defenderView = toCombatant(defender)
  const events: Record<string, unknown>[] = []
  const swing = resolveSwing(attackerView, defenderView, items, events) as Record<string, unknown>
  syncAttackerBack(attacker, attackerView)

  attacker.pvpAttackTimer = Math.max(2, getAttackSpeed(attacker.equipment, items) || 4)

  if (swing.blocked) {
    const reason = String(swing.reason ?? (swing.blockType === 'magic' ? 'no_runes' : 'no_ammo'))
    out.swings.push({
      attackerId: attacker.charId, defenderId: defender.charId, splats: [], damage: 0,
      special: false, runesConsumed: null, ammoConsumed: null,
      refusal: REFUSAL_TEXT[reason] ?? 'You have run out of ammunition.',
    })
    return
  }

  // Protection prayers, then the worn damage-reduction perk — the same order
  // and the same rounding PvE applies (src/engine/combat.js), so the two agree.
  // Both are per-hitsplat, because a multi-hit special has to show the reduced
  // numbers rather than one reduced total split back out arbitrarily.
  const style = getAttackStyle(attacker.equipment, items)
  const perk = getDamageReductionPerk(getEquipmentBonuses(defender.equipment, items))
  const rawSplats = Array.isArray(swing.hits) && swing.hits.length > 0
    ? (swing.hits as number[]).map((h) => Math.max(0, Math.floor(Number(h) || 0)))
    : [Math.max(0, Math.floor(Number(swing.damage) || 0))]

  let remaining = defender.hp
  const splats: number[] = []
  for (const raw of rawSplats) {
    const afterPrayer = raw - protectionReduction(defender.activeProtectionPrayer, style, raw)
    const afterPerk = applyDamageReduction(Math.max(0, afterPrayer), perk)
    const capped = Math.max(0, Math.min(remaining, afterPerk))
    remaining -= capped
    splats.push(capped)
  }
  const damage = splats.reduce((sum, n) => sum + n, 0)
  defender.hp = Math.max(0, defender.hp - damage)
  syncDefenderBack(defender, defenderView)

  const ammoSlot = (attacker.equipment as { ammo?: { itemId?: string } | null }).ammo ?? null
  const ammo = setup.combatType === 'ranged' && ammoSlot?.itemId ? { itemId: ammoSlot.itemId, qty: 1 } : null

  out.swings.push({
    attackerId: attacker.charId,
    defenderId: defender.charId,
    splats,
    damage,
    special: !!swing.special,
    runesConsumed: (swing.runesToConsume as Record<string, number> | null) ?? null,
    ammoConsumed: ammo,
    refusal: null,
  })

  if (defender.hp <= 0) out.deaths.push({ victimId: defender.charId, killerId: attacker.charId })
}

/**
 * One tick of one duel. Both sides' clocks tick down, both drain prayer, both
 * decay potions, and then each swings if their own clock and their own reach
 * allow it — so a magic user really does keep hitting a melee opponent who has
 * been kited out of reach, and the melee opponent really does land nothing.
 *
 * Order is fixed by charId so a duel resolves identically whichever of the two
 * the DO happens to iterate first.
 */
export function stepPvpFight(
  a: PvpFighter,
  b: PvpFighter,
  ctx: { tick: number; collision: string[] },
  out: PvpTickOutput,
): void {
  const [first, second] = a.charId <= b.charId ? [a, b] : [b, a]

  for (const fighter of [first, second]) {
    fighter.pvpAttackTimer = Math.max(0, fighter.pvpAttackTimer - 1)
    tickPvpBuffs(fighter)
  }

  // Reach either way keeps the lock alive: a fight that neither side can reach
  // is a chase, and a chase must not free either of them to be jumped by a
  // third party. The lock lapses on its own timer instead.
  const inReach = withinRangeAndSight(first, second, Math.max(pvpAttackRange(first), pvpAttackRange(second)), ctx.collision)
  if (inReach && isDangerTile(first) && isDangerTile(second)) refreshPvpLock(first, second, ctx.tick)

  // A fighter who has stepped back into the camp is out of the fight entirely —
  // that is what the safe zone is for. Their opponent's swing is refused below
  // by the same tile test, so neither can shoot across the line.
  if (!isDangerTile(first) || !isDangerTile(second)) return

  swingOnce(first, second, ctx.collision, out)
  swingOnce(second, first, ctx.collision, out)
}

/**
 * Per-tick prayer drain and potion decay for a fighter in a duel.
 *
 * PvE gets both for free from the shared engine's own tick; the duel resolves
 * swings directly, so the upkeep has to be run here or a Wilderness fight would
 * be the one place in the game where prayer is free and potions never wear off.
 */
export function tickPvpBuffs(fighter: PvpFighter): void {
  const view = {
    prayerPoints: fighter.prayerPoints,
    maxPrayerPoints: fighter.maxPrayerPoints,
    prayerDrainAccumulator: fighter.prayerDrainAccumulator,
    activeProtectionPrayer: fighter.activeProtectionPrayer,
    activeCombatPrayer: fighter.activeCombatPrayer,
  }
  applyPrayerDrainTick(view, prayersData, getPrayerDrainMultiplier(getEquipmentBonuses(fighter.equipment, items)))
  fighter.prayerPoints = view.prayerPoints
  fighter.prayerDrainAccumulator = view.prayerDrainAccumulator
  fighter.activeProtectionPrayer = view.activeProtectionPrayer
  fighter.activeCombatPrayer = view.activeCombatPrayer

  for (const [potionId, ticks] of Object.entries(fighter.activePotions)) {
    const left = Math.max(0, (Number(ticks) || 0) - 1)
    if (left <= 0) delete fighter.activePotions[potionId]
    else fighter.activePotions[potionId] = left
  }
}

/** Hitsplat events for one swing, in the wire shape the zone broadcasts. */
export function swingHitEvents(swing: PvpSwingOutcome): { targetId: string; dmg: number }[] {
  if (swing.splats.length === 0) return []
  return swing.splats.map((dmg) => ({ targetId: swing.defenderId, dmg }))
}

export type PvpAttackAnim = 'attack' | 'attack_ranged' | 'attack_magic' | 'attack_special'

/** The animation a fighter plays for a swing they just landed. */
export function pvpAttackAnim(fighter: PvpFighter, special: boolean): PvpAttackAnim {
  if (special) return 'attack_special'
  const type = getCombatType(fighter.equipment, items)
  return type === 'magic' ? 'attack_magic' : type === 'ranged' ? 'attack_ranged' : 'attack'
}
