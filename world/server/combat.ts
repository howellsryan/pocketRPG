// Thin adapter around the REAL combat engine (src/engine/combat.js). No combat
// maths live here — createCombatState + processCombatTick own damage, accuracy,
// XP and drops; this file only drives one tick per zone tick, mirrors the
// monster HP onto the shared npc record, tracks the player's session HP, and
// funnels XP through the same grant pipeline mining uses. Contract pinned by
// world/tests/combat-adapter.test.ts.
import { createCombatState, processCombatTick } from '../../src/engine/combat.js'
import { resolveMagicSpell, getCombatType } from '../../src/engine/equipment.js'
import itemsData from '../../src/data/items.json'
import monstersData from '../../src/data/monsters.json'
import spellsData from '../../src/data/spells.json'
import prayersData from '../../src/data/prayers.json'
import { grantSessionXp, monsterAttackAnim, monsterAttackRange, rangeForCombatType, withinRangeAndSight, type TickPlayer } from './tick'
import { recordDamage, topDamageContributor, type NpcState } from './npc'
import { reachAgainst } from '../shared/monsterSize'
import type { TickContext, TickResult } from './tick'
import type { ZoneEvent } from '../shared/protocol'
import { spawnDrops } from './loot'
import { removeItems } from './mining'
import { isBossMonster } from './bossKills'
import { getMonsterModel } from '../../src/utils/equipModels.js'
import { monsterAttackWindup } from '../../src/utils/combatWindup.js'
import { resolveSpecialEnergyCost } from '../../src/engine/specialAttackEnergy.js'
import { TICK_DURATION } from '../../src/utils/constants.js'

type Items = Record<string, { specialAttack?: Record<string, unknown> } | undefined>

export const FULL_SPECIAL_ENERGY = 100

/** The world does NOT use the idle game's per-fight special model (§7: seed 100,
 * refill on kill). Out here energy is a persistent session resource that only
 * comes back on the clock (tick.ts `SPECIAL_REGEN_PER_TICK`), so neither leaving
 * a fight nor killing the thing refunds a spent special.
 *
 * The shared engine still resets its own `specialAttackEnergy` to 100 on kills,
 * boss phase resets and double-kills, so `player.specialEnergy` is the session's
 * truth: it is debited explicitly when a special fires (see the `specialHit`
 * branch) and pushed back onto the engine state every tick, which is what the
 * engine's own affordability check then reads. */
export function pinSpecialToSession(player: TickPlayer): void {
  const state = player.combat?.state as EngineState | undefined
  if (state) state.specialAttackEnergy = player.specialEnergy
}

/** Energy a fired special costs the session. Mirrors the engine's own drain
 * (src/engine/combat.js) including the Sunbearer Ring, which pins energy at
 * full — read here rather than off the engine state, whose value is unusable on
 * any tick the engine also refilled it. */
function specialEnergyCost(player: TickPlayer): number {
  const equipment = player.equipment as Record<string, { itemId?: string } | undefined>
  if (equipment?.ring?.itemId === 'sunbearer_ring') return 0
  const weaponId = equipment?.weapon?.itemId
  const special = weaponId ? (itemsData as Items)[weaponId]?.specialAttack : null
  return special ? resolveSpecialEnergyCost(special, player.specialEnergy) : 0
}

/** How many ticks before a monster's swing lands the server broadcasts the
 * single 'attack' pulse, so the client can pre-start (and sub-tick-delay) the
 * clip and have its IMPACT frame coincide with the hit event/splat — the same
 * alignment the combat arena does, driven by the SHARED src/utils/combatWindup.js
 * off the clip's `attackImpactSec` (src/data/equipmentModels.json). Monsters
 * with no impact metadata keep the coarse 1-tick lead. Memoised per monsterId. */
const windupLeadCache = new Map<string, number>()
export function monsterWindupLeadTicks(monsterId: string): number {
  let lead = windupLeadCache.get(monsterId)
  if (lead === undefined) {
    const impactSec = getMonsterModel(monsterId)?.attackImpactSec ?? null
    lead = monsterAttackWindup(impactSec, TICK_DURATION).leadTicks
    windupLeadCache.set(monsterId, lead)
  }
  return lead
}

/** Emits a {e:'spec'} echo when the energy readout OR the armed/queued state
 * changed — the latter lets the client highlight the button the instant a tap
 * arms/cancels a special, even on a tick where energy itself doesn't move. */
export function emitSpecIfChanged(player: TickPlayer, events: ZoneEvent[]): void {
  const rounded = Math.round(player.specialEnergy)
  const queued = player.combat ? !!(player.combat.state as EngineState).specialAttackQueued : player.pendingSpecial
  if (rounded === player.lastSpecSent && queued === player.lastSpecQueuedSent) return
  player.lastSpecSent = rounded
  player.lastSpecQueuedSent = queued
  events.push({ e: 'spec', energy: rounded, queued })
}

/** Combat ended (fled/died/killed). Energy is deliberately left where it was —
 * it carries out of the fight and regenerates on the clock — but the echo still
 * fires so the client drops the "armed" highlight with the fight. */
function endCombatSpecial(player: TickPlayer, result: TickResult): void {
  emitSpecIfChanged(player, result.events)
}

/** Emits a {e:'prayer'} echo when the rounded pool or an active prayer changed
 * (drain, auto-switch-off on empty, or a toggle) — gated like emitSpecIfChanged
 * so it doesn't fire every tick. */
export function emitPrayerIfChanged(player: TickPlayer, events: ZoneEvent[]): void {
  const points = Math.ceil(player.prayerPoints)
  const key = `${points}|${player.activeProtectionPrayer ?? ''}|${player.activeCombatPrayer ?? ''}`
  if (key === player.lastPrayerSent) return
  player.lastPrayerSent = key
  events.push({
    e: 'prayer',
    points,
    max: player.maxPrayerPoints,
    protection: player.activeProtectionPrayer,
    combat: player.activeCombatPrayer,
  })
}

// The engine's inferred state types `spell`/`runesConsumed` from their `null`
// initialisers — widen them to what magic combat actually stores there.
type EngineState = Omit<ReturnType<typeof createCombatState>, 'spell' | 'prayerPoints' | 'maxPrayerPoints' | 'prayerDrainAccumulator' | 'activeProtectionPrayer' | 'activeCombatPrayer' | 'activePotions'> & {
  spell: unknown
  runesConsumed?: Record<string, number> | null
  prayerPoints: number
  maxPrayerPoints: number
  prayerDrainAccumulator: number
  activeProtectionPrayer: string | null
  activeCombatPrayer: string | null
  activePotions: Record<string, number>
}

/** Copies the player's session buffs (prayer pool + toggles, active potions) onto
 * an engine state at fight start. Potions are cloned so the fight's per-tick decay
 * doesn't mutate the session copy until synced back. */
function copySessionBuffsToState(player: TickPlayer, state: EngineState): void {
  state.prayerPoints = player.prayerPoints
  state.maxPrayerPoints = player.maxPrayerPoints
  state.prayerDrainAccumulator = player.prayerDrainAccumulator
  state.activeProtectionPrayer = player.activeProtectionPrayer
  state.activeCombatPrayer = player.activeCombatPrayer
  state.activePotions = { ...player.activePotions }
}

/** Syncs the engine state's buffs back onto the session after a tick, so prayer
 * drain / auto-switch-off and potion decay persist across auto-fight kills. */
function syncStateBuffsToSession(player: TickPlayer, state: EngineState): void {
  player.prayerPoints = state.prayerPoints
  player.prayerDrainAccumulator = state.prayerDrainAccumulator
  player.activeProtectionPrayer = state.activeProtectionPrayer
  player.activeCombatPrayer = state.activeCombatPrayer
  player.activePotions = state.activePotions
}
export type CombatSession = {
  npcId: string
  state: EngineState
  /** The player walked away from this fight. The session survives so the
   * monster can keep swinging at them, but the player lands nothing until they
   * click Attack again — no auto-retaliate, ever. */
  passive?: boolean
}

/** True when an attack intent re-targets the npc the player is already fighting
 * — the click must NOT reset the live engine attack timer (Q5: spam-clicking an
 * in-combat monster granted free instant hits). */
export function isSameFightTarget(player: TickPlayer, intent: { kind: string; id: string } | null): boolean {
  return !!intent && intent.kind === 'npc' && player.combat?.npcId === intent.id
}

/** Attack animation wire value for a player's combat type. */
function attackAnimFor(combatType: string): 'attack' | 'attack_ranged' | 'attack_magic' {
  return combatType === 'magic' ? 'attack_magic' : combatType === 'ranged' ? 'attack_ranged' : 'attack'
}

const RESPAWN_TICKS = 25
// Bosses respawn far slower than trash: a 255-HP, ~20k-coin boss on the 15s
// regular timer invites a farm loop that blows past the §4 GP/hr guardrail, so
// hold the world boss for 60s between kills (item 9).
const BOSS_RESPAWN_TICKS = 100
// Long enough for the longest shipped death clip to finish before the corpse is
// removed — Warlord Grondar's `die` runs 3.042s, so the old 3 ticks (1.8s) cut
// every boss death off mid-collapse.
export const NPC_REMOVE_AFTER_DEATH_TICKS = 6

/** Ticks before a killed monster respawns — bosses far slower than trash. */
export function respawnTicksFor(monsterId: string): number {
  return isBossMonster(monsterId) ? BOSS_RESPAWN_TICKS : RESPAWN_TICKS
}

type Monsters = Record<string, Record<string, unknown>>

/** Decrements the player's equipped ammo by `qty`, nulling the slot when it
 * empties. Only touches the slot the engine actually fired (guards against a
 * mid-fight ammo swap). Mirrors applyTaskResult.js / pvpEngine.js. */
function consumeEquippedAmmo(player: TickPlayer, itemId: string, qty: number): void {
  const equipment = player.equipment as { ammo?: { itemId?: string; quantity?: number } | null }
  const ammo = equipment.ammo
  if (!ammo || ammo.itemId !== itemId) return
  const remaining = Math.max(0, (Math.floor(Number(ammo.quantity)) || 0) - Math.max(1, Math.floor(qty)))
  player.equipment = { ...player.equipment, ammo: remaining > 0 ? { ...ammo, quantity: remaining } : null }
}

function playerStatsFor(player: TickPlayer): Record<string, number> {
  const lvl = (s: string) => player.stats[s]?.level ?? 1
  return {
    attack: lvl('attack'),
    strength: lvl('strength'),
    defence: lvl('defence'),
    ranged: lvl('ranged'),
    magic: lvl('magic'),
    hitpoints: player.maxHp,
    currentHP: player.hp,
    maxHP: player.maxHp,
  }
}

/** Resolves how this player fights: real magic when a magic weapon is equipped
 * (selected spell, or the engine's powered-staff path), ranged when a ranged
 * weapon is equipped, melee otherwise. `needsSpell` means a magic weapon with no
 * castable spell: the engine would splash 0s forever, so the fight must be
 * refused. */
export function resolveCombatSetup(player: TickPlayer): { combatType: 'melee' | 'ranged' | 'magic'; spell: unknown; needsSpell: boolean } {
  const activeSpell = player.spell ? { id: player.spell } : null
  const { combatType, isPoweredStaff, spell, needsSpell } = resolveMagicSpell(player.equipment, itemsData, activeSpell, spellsData)
  if (combatType === 'ranged') return { combatType: 'ranged', spell: null, needsSpell: false }
  if (combatType !== 'magic') return { combatType: 'melee', spell: null, needsSpell: false }
  if (needsSpell) return { combatType: 'magic', spell: null, needsSpell: true }
  return { combatType: 'magic', spell: isPoweredStaff ? null : spell, needsSpell: false }
}

/** This player's attack reach (tiles) from their equipped weapon: melee 1,
 * ranged 5, magic 7. */
export function playerAttackRange(player: TickPlayer): number {
  return rangeForCombatType(getCombatType(player.equipment, itemsData))
}

/** Begins a fight between the player and an npc. The engine state seeds from the
 * npc's CURRENT hp (a bull half-killed by an abandoned fight resumes there, not
 * at full), while `hitpoints` stays the true max. */
export function startCombat(player: TickPlayer, npc: NpcState, result?: TickResult): void {
  const monster = (monstersData as Monsters)[npc.monsterId]
  if (!monster) return
  const setup = resolveCombatSetup(player)
  if (setup.needsSpell) {
    result?.events.push({ e: 'msg', text: 'You need to select a spell to fight with that weapon.' })
    return
  }
  const state = createCombatState(monster, setup.combatType, player.stance, setup.spell as null) as unknown as EngineState
  state.monster.currentHP = npc.hp
  // Carry the session prayer pool + toggles onto this fight's engine state, so
  // the engine drains the same pool and applies bonuses/protection. Persists
  // across auto-fight kills because stepCombat syncs it back after each tick.
  copySessionBuffsToState(player, state)
  // A special armed before this fight existed (tapped Special with no target)
  // fires as the opening swing instead of being dropped on the floor.
  if (player.pendingSpecial) {
    state.specialAttackQueued = true
    player.pendingSpecial = false
  }
  player.combat = { npcId: npc.id, state }
  // Special energy carries INTO the fight from the session rather than seeding
  // at full — a fight is not a refill (see pinSpecialToSession).
  pinSpecialToSession(player)
  npc.state = 'combat'
  if (!npc.attackerId) npc.attackerId = player.charId
  if (result) emitSpecIfChanged(player, result.events)
}

function killNpc(player: TickPlayer, npc: NpcState, loot: { itemId: string; quantity: number }[], ctx: TickContext, result: TickResult): void {
  npc.state = 'dead'
  npc.anim = 'die'
  npc.hp = 0
  npc.attackerId = null
  npc.respawnAtTick = ctx.tick + respawnTicksFor(npc.monsterId)
  npc.removeAtTick = ctx.tick + NPC_REMOVE_AFTER_DEATH_TICKS
  player.combat = null
  // Leave player.anim as the attack set by this tick's fatal playerHit/specialHit
  // — resetting it to 'idle' here cut the killing swing off (a one-hit kill never
  // broadcast the attack). The next idle tick returns to idle upstream (tick.ts),
  // and the client latch plays the broadcast swing through to completion.
  const owner = topDamageContributor(npc) ?? player.charId
  npc.damageByChar.clear()
  result.newLoot.push(...spawnDrops(loot, npc.x, npc.z, owner, ctx.tick))
  // Surface the kill so the DO can record boss collection-log / kill-count /
  // audit server-side (§14) — the loot itself still rides the trusted save blob.
  result.kills.push({ monsterId: npc.monsterId, owner, loot })
  result.npcChanged.push(npc.id)
}

/** Advances one active combat tick for a player. Movement/cancel clears
 * `player.combat` upstream, so reaching here means the player intends to fight.
 * Ends the fight (bull returns toward idle) once the player is beyond both their
 * own and the monster's attack reach. */
export function stepCombat(player: TickPlayer, ctx: TickContext, result: TickResult): void {
  const combat = player.combat
  if (!combat) return
  const npc = ctx.npcs?.get(combat.npcId)
  if (!npc || npc.state === 'dead') {
    player.combat = null
    player.anim = 'idle'
    endCombatSpecial(player, result)
    return
  }
  // Reach is per combat type: the player strikes from their weapon's range, the
  // monster from its own. The fight only ends when the player is beyond BOTH —
  // fleeing past a ranged/magic foe still leaves it able to attack while it
  // chases. Aggro persists either way (npc.ts keeps chasing).
  // Both reaches are widened by the monster's body (a 3×3 dragon is fought from
  // the edge of its footprint, not from its centre tile).
  const playerRange = reachAgainst(npc.monsterId, rangeForCombatType(combat.state.combatType as string))
  const monsterRange = reachAgainst(npc.monsterId, monsterAttackRange(npc.monsterId))
  const collision = ctx.collision ?? []
  // Ranged/magic need line of sight to land (both directions) — a wall between
  // the two blocks the shot, so a player can't kite a boss from behind a pillar
  // it can never see through, and vice versa.
  const inPlayerRange = withinRangeAndSight(player, npc, playerRange, collision)
  const inMonsterRange = withinRangeAndSight(player, npc, monsterRange, collision)
  // Whether the PLAYER's swings count this tick. A disengaged player is only
  // still in this fight because the monster is chasing them, so their own reach
  // no longer keeps it alive either.
  const playerLands = inPlayerRange && !combat.passive
  if (!playerLands && !inMonsterRange) {
    player.combat = null
    player.anim = 'idle'
    endCombatSpecial(player, result)
    return
  }

  // Shared monster HP: each attacker runs their own engine session, so sync the
  // session's monster HP from the shared record before the tick (players tick
  // sequentially, so concurrent damage serializes) — and claim the retaliation
  // target if it's vacant. Only the target's session applies monster attacks;
  // other sessions discard them or the npc would swing once per attacker.
  combat.state.monster.currentHP = npc.hp
  if (!npc.attackerId) npc.attackerId = player.charId
  const isTarget = npc.attackerId === player.charId

  // The pack rides in as the engine's inventory so magic can check runes;
  // consumption is applied below from state.runesConsumed (live-game contract:
  // consume on a landed hit, then clear so the same cast never double-charges).
  const { combatState, events } = processCombatTick(combat.state, playerStatsFor(player), player.equipment, itemsData, prayersData, player.inventory, null)
  combat.state = combatState
  // The engine drained the pool / may have switched prayers off on empty — carry
  // that back onto the session and echo the readout when it moved.
  syncStateBuffsToSession(player, combat.state as EngineState)
  emitPrayerIfChanged(player, result.events)
  // Default to idle unless walking (walk anim set upstream); the playerHit/
  // specialHit branches below set the attack anim only on a tick the engine
  // actually resolved a swing — mirroring the npc.anim gating so the animation
  // no longer fires every tick regardless of the attack timer.
  if (player.path.length === 0) player.anim = 'idle'
  npc.state = 'combat'
  // Clear last tick's swing so a fresh one re-triggers the attack animation.
  if (npc.anim === 'attack' || npc.anim === 'attack_ranged' || npc.anim === 'attack_magic') npc.anim = 'idle'
  // Pre-signal the swing as a SINGLE pulse `leadTicks` before it resolves — the
  // client edge-detects this to start the clip (with its sub-tick delay) so the
  // impact frame lands on the hit event's splat below. The hit/miss branches do
  // NOT re-broadcast 'attack' (a second, non-adjacent pulse would restart the
  // clip on the splat tick and desync it) — the pulse alone drives the whole
  // swing, mirroring the combat arena's shared windup (src/utils/combatWindup.js).
  if (isTarget && inMonsterRange && combat.state.monsterAttackTimer === monsterWindupLeadTicks(npc.monsterId)) {
    npc.anim = monsterAttackAnim(npc.monsterId)
  }
  npc.lastCombatTick = ctx.tick
  result.npcChanged.push(npc.id)

  const consumeRunes = (): void => {
    const runes = combat.state.runesConsumed as Record<string, number> | null | undefined
    if (!runes) return
    combat.state.runesConsumed = null
    const consumed: Record<string, number> = {}
    for (const [runeId, qty] of Object.entries(runes)) {
      const n = Math.max(0, Math.floor(Number(qty) || 0))
      if (n > 0 && removeItems(player.inventory, runeId, n)) consumed[runeId] = n
    }
    if (Object.keys(consumed).length > 0) {
      result.consumed.push(consumed)
      result.events.push({ e: 'inv', inventory: player.inventory })
    }
  }

  for (const ev of events as { type: string; damage?: number; hits?: number[]; totalDamage?: number; loot?: { itemId: string; quantity: number }[]; xpSkills?: Record<string, number>; spellName?: string; itemId?: string; qty?: number }[]) {
    if (ev.type === 'playerHit') {
      if (!playerLands) continue
      player.anim = attackAnimFor(combat.state.combatType as string)
      npc.hp = Math.max(0, combatState.monster.currentHP)
      recordDamage(npc, player.charId, ev.damage ?? 0, ctx.tick)
      result.hits.push({ targetId: npc.id, dmg: ev.damage ?? 0 })
      if ((ev.damage ?? 0) > 0) consumeRunes()
    } else if (ev.type === 'noRunesForSpell') {
      result.events.push({ e: 'msg', text: `You don't have enough runes to cast ${ev.spellName ?? 'that spell'}.` })
      player.combat = null
      if (npc.attackerId === player.charId) npc.attackerId = null
      player.anim = 'idle'
      endCombatSpecial(player, result)
      return
    } else if (ev.type === 'noAmmo') {
      // Out of ammunition: the engine can't resolve a ranged swing, so end the
      // fight cleanly rather than let it stall forever splashing nothing.
      result.events.push({ e: 'msg', text: 'You have run out of ammunition.' })
      player.combat = null
      if (npc.attackerId === player.charId) npc.attackerId = null
      player.anim = 'idle'
      endCombatSpecial(player, result)
      return
    } else if (ev.type === 'consumeAmmo') {
      // The engine fired a ranged shot: decrement the equipped ammo on the save's
      // equipment so arrows aren't free, and flag the equipment dirty so the flush
      // persists the reduced stack. Mirrors applyTaskResult / pvpEngine.
      if (ev.itemId) consumeEquippedAmmo(player, ev.itemId, ev.qty ?? 1)
      result.equipmentDirty = true
    } else if (ev.type === 'specialHit') {
      if (!playerLands) continue
      // Debit the session here, not from the engine state — a special that lands
      // the killing blow leaves the engine's energy back at 100 (its refill-on-
      // kill), which would silently refund the cost.
      player.specialEnergy = Math.max(0, player.specialEnergy - specialEnergyCost(player))
      // A fired special plays the hero's distinct special clip (parity with the
      // combat arena's specialClip), not the normal per-type swing.
      player.anim = 'attack_special'
      // A fired special: one or more hits, monster HP already applied on state.
      npc.hp = Math.max(0, combatState.monster.currentHP)
      recordDamage(npc, player.charId, ev.totalDamage ?? 0, ctx.tick)
      const splats = ev.hits && ev.hits.length > 0 ? ev.hits : [ev.totalDamage ?? 0]
      for (const dmg of splats) result.hits.push({ targetId: npc.id, dmg })
    } else if (ev.type === 'monsterHit' || ev.type === 'dragonfireHit') {
      // The monster only lands when the player is within ITS reach — a melee foe
      // can't hit a player kiting at magic range until it closes the gap. The
      // swing anim was already led by the pre-signal above; don't re-broadcast
      // it here (that would restart the clip on the splat tick).
      if (!isTarget || !inMonsterRange) continue
      player.hp = Math.max(0, player.hp - (ev.damage ?? 0))
      result.hits.push({ targetId: player.charId, dmg: ev.damage ?? 0 })
    } else if (ev.type === 'monsterMiss') {
      if (!isTarget || !inMonsterRange) continue
      result.hits.push({ targetId: player.charId, dmg: 0 })
    } else if (ev.type === 'xp' && ev.xpSkills) {
      if (!playerLands) continue
      for (const [skill, amount] of Object.entries(ev.xpSkills)) {
        if (amount) result.events.push(...grantSessionXp(player, skill, Math.floor(amount)))
      }
    } else if (ev.type === 'monsterDeath') {
      // Guarded by the same gate as playerHit: the engine rolls the player's
      // swing even on a tick the server discards it (out of reach, or
      // disengaged), and an ungated death would hand out the kill and its loot
      // for damage that never landed.
      if (!playerLands) continue
      killNpc(player, npc, ev.loot ?? [], ctx, result)
    }
  }

  if (player.hp <= 0) {
    player.combat = null
    if (npc.attackerId === player.charId) npc.attackerId = null
    result.died = true
    endCombatSpecial(player, result)
    return
  }

  // Re-pin the engine to the session value so the next tick's affordability
  // check reads the session's truth, not whatever the engine refilled itself to.
  pinSpecialToSession(player)
  emitSpecIfChanged(player, result.events)
}
