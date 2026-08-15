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
import { ensureForm, isRoomWideFamily, recordDamage, sharedMonsterState, topDamageContributor, usesSharedClock, type NpcState } from './npc'
import { reachAgainst } from '../shared/monsterSize'
import type { TickContext, TickResult } from './tick'
import type { ZoneEvent } from '../shared/protocol'
import { spawnDrops } from './loot'
import { removeItems } from './mining'
import { isBossMonster } from './bossKills'
import { prepareAdd } from '../../src/engine/bossAdds.js'
import { isMultiForm, pinFormToSession } from '../../src/engine/bossForms.js'
import { getMonsterModel } from '../../src/utils/equipModels.js'
import { MONSTER_MODELS } from '../shared/monsterModels'
import { monsterAttackWindup } from '../../src/utils/combatWindup.js'
import { resolveSpecialEnergyCost } from '../../src/engine/specialAttackEnergy.js'
import { killCreditIds } from '../../src/engine/killCredit.js'
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
 * off the clip's `attackImpactSec`. Monsters with no impact metadata keep the
 * coarse 1-tick lead. Memoised per monsterId.
 *
 * Resolved world-registry-first, exactly as the client resolves the sub-tick
 * delay it pairs with (entities.ts createMonsterMesh). The two are halves of one
 * number: read from different registries they can disagree, and a lead that does
 * not match its delay misses the splat by as much as a whole tick. */
const windupLeadCache = new Map<string, number>()
export function monsterWindupLeadTicks(monsterId: string): number {
  let lead = windupLeadCache.get(monsterId)
  if (lead === undefined) {
    const impactSec = MONSTER_MODELS[monsterId]?.attackImpactSec ?? getMonsterModel(monsterId)?.attackImpactSec ?? null
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
  // Out of a PvE fight the armed flag can live in either of two places: the
  // Wilderness duel keeps its own (`specialAttackQueued`, read by pvpCombat's
  // combatant view), and everywhere else it is the pending arm-for-next-fight.
  // Reading only the latter left the Wilderness spec button unlit while armed.
  const queued = player.combat
    ? !!(player.combat.state as EngineState).specialAttackQueued
    : (player.specialAttackQueued ?? false) || player.pendingSpecial
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
type EngineState = Omit<ReturnType<typeof createCombatState>, 'spell' | 'adds' | 'addTargetIndex' | 'formPinned' | 'prayerPoints' | 'maxPrayerPoints' | 'prayerDrainAccumulator' | 'activeProtectionPrayer' | 'activeCombatPrayer' | 'activePotions'> & {
  spell: unknown
  /** Everything else in this encounter attacking this player, mirrored from
   * their npcs each tick (mirrorOtherAttackers). The engine initialises the list
   * empty, which infers as never[]. */
  adds: { instanceId: string; currentHP: number; attackTimer: number }[]
  addTargetIndex: number | null
  /** The room owns this boss's form; this session only wears it (bossForms.js). */
  formPinned: boolean
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
  // Per player, not per npc: the zone's npc record is shared by everyone
  // fighting it, and only this session's drops triple.
  const state = createCombatState(monster, setup.combatType, player.stance, setup.spell as null, null, { grindman: player.isGrindman === true }) as unknown as EngineState
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

/**
 * Re-opens the fight for a player that any npc still holding them as its
 * attacker has chased back into its reach — trash, dragon or boss alike.
 *
 * An npc's swings are only ever resolved inside a player's own combat session,
 * and stepCombat ends that session the moment the player is beyond both
 * reaches. Every npc now keeps its quarry across a disengage (npc.ts
 * reselectAttacker) instead of releasing them, so without this it would jog
 * alongside its target forever, visibly hunting them, and never land a blow —
 * aggro with no teeth.
 *
 * This does NOT reopen the door to unprovoked fights: it only fires for an npc
 * whose `attackerId` is already this player, which is set by nothing but
 * startCombat — a monster the player never clicked never acquires one, so
 * standing next to an idle bull still starts nothing on its own (§
 * combat-flow.test.ts "stays out of combat standing next to an idle monster").
 *
 * The resumed session is ACTIVE, not passive: the whole point of resuming is
 * that whatever caught its quarry can hit them, mirroring the real fight —
 * unlike the disengage from walking away, which stays passive on purpose so the
 * player's own swings need a fresh click.
 */
export function resumeAggro(player: TickPlayer, ctx: TickContext): void {
  if (player.combat) return
  const collision = ctx.collision ?? []
  for (const npc of ctx.npcs?.values() ?? []) {
    if (npc.attackerId !== player.charId || npc.state !== 'combat') continue
    const reach = reachAgainst(npc.monsterId, monsterAttackRange(npc.monsterId, npc.currentForm))
    if (!withinRangeAndSight(npc, player, reach, collision)) continue
    // No `result`: a refusal (a magic weapon with no spell selected) is the
    // player's own business and must not re-announce itself every tick the
    // npc stays in reach.
    startCombat(player, npc)
    return
  }
}

/**
 * Everything ELSE in this encounter — the npcs attacking this player that they
 * are not swinging at. A player may attack one thing; any number of things
 * attack the player.
 *
 * Fighting the boss, that is its whole stack of minions. Fighting one minion, it
 * is the boss AND its siblings: they were summoned against you, and turning to
 * face one of them cannot switch the rest off.
 */
function otherAttackers(npc: NpcState, ctx: TickContext): NpcState[] {
  const npcs = ctx.npcs
  if (!npcs) return []
  const summoner = npc.summonerId ? npcs.get(npc.summonerId) : null
  const family = summoner ? [summoner, ...(summoner.minionIds ?? [])] : (npc.minionIds ?? [])
  const out: NpcState[] = []
  for (const entry of family) {
    const other = typeof entry === 'string' ? npcs.get(entry) : entry
    // A monster the data does not know cannot be mirrored, and dropping it here
    // rather than mid-map is what keeps this list index-aligned with the mirror
    // and with the per-attacker reach checks.
    if (other && other !== npc && other.state !== 'dead' && (monstersData as Monsters)[other.monsterId]) out.push(other)
  }
  return out
}

/**
 * Whether the mirrored partner's swing lands on this player — the same rule that
 * governs the partner's own session, since it is the same swing: a room-wide
 * attacker reaches everybody present, anything else reaches only the player it
 * is retaliating against (countsAsEngaged is what puts a player fighting either
 * half of the pair into the other's pool).
 *
 * A room-wide boss's MINIONS count as room-wide too (isRoomWideFamily) — they
 * are its reach, and co-op has always resolved them that way. Read off the
 * minion alone, a sentinel could only ever hit the one player the boss had
 * claimed.
 *
 * Range is the partner's OWN reach against this player, never the session npc's.
 * A boss and its minion stand apart, and a melee sentinel at the boss's shoulder
 * genuinely cannot touch someone on the far side of it — being room-wide widens
 * who it may hit, never how far it can strike.
 */
function otherAttackerReaches(other: NpcState, player: TickPlayer, collision: string[], npcs?: Map<string, NpcState>): boolean {
  const reaches = isRoomWideFamily(other, npcs)
    || other.attackerId === player.charId
  if (!reaches) return false
  const reach = reachAgainst(other.monsterId, monsterAttackRange(other.monsterId, other.currentForm))
  return withinRangeAndSight(player, other, reach, collision)
}

/**
 * Points this session's `state.add` at that other npc, so the engine resolves
 * its swing exactly as it resolves a boss's add in the solo fight — accuracy,
 * protection prayers, prayer drain and armour charges all included, because
 * `state.add` is precisely "a second enemy hitting me on its own timer".
 *
 * Runs every tick and for every fight, ahead of processCombatTick — including
 * fights with nothing to mirror, which is what makes the npcs the ONLY source of
 * an add out here. (A session could otherwise seed one of its own: every other
 * caller of createCombatState passes the monsters table, which is what turns the
 * engine's own spawn on, and this one deliberately does not.)
 *
 * The mirrored HP is the npc's, and the view is read-only: this session never
 * damages it (nothing sets a target index out here — the player's swings go to
 * `state.monster`, and killing one of them means turning to face it), so a
 * mirror simply drops off the list the moment its npc dies or despawns.
 *
 * It is a LIST: a boss fields up to `spawnsAdd.maxActive` minions at once, and
 * a player who turns on one of them is mirrored the boss AND its siblings.
 */
function mirrorOtherAttackers(combat: CombatSession, others: NpcState[]): void {
  const byNpc = new Map((combat.state.adds ?? []).map((add) => [add.instanceId, add]))
  const mirrored: EngineState['adds'] = []
  for (const other of others) {
    const definition = (monstersData as Monsters)[other.monsterId]
    // Keyed by the NPC's id, so the list reshaping (one dies, another spawns)
    // never hands a session the wrong monster's mirror.
    // otherAttackers only yields npcs the data knows, so prepareAdd never nulls.
    const add = (byNpc.get(other.id) ?? prepareAdd(definition, other.id))!
    // Identify the mirror by the NPC it mirrors, so next tick's lookup finds it.
    add.instanceId = other.id
    add.currentHP = other.hp
    // A mirror wears the form its npc is in, exactly as the session's own
    // monster does (pinFormToSession in stepCombat). Left un-formed it fell back
    // to the raw monsters.json row — no `formMaxHit`, so the max hit was DERIVED
    // from the boss's stats, and its style was the top-level one for every
    // swing. Zaryth hit a player who had turned on a sentinel for up to 212
    // instead of its ranged form's 60, and did it as ranged whatever form the
    // room could see, so there was no protection prayer that answered it.
    ensureForm(other)
    pinFormToSession(add, other)
    // Same trick as the shared clock below: hold every session's copy off the
    // floor and fire them all on the tick the npc's own clock says so.
    add.attackTimer = other.sharedSwing ? 0 : Math.max(2, Number(definition?.attackSpeed) || 4)
    mirrored.push(add)
  }
  combat.state.adds = mirrored
  // Nothing out here ever selects one of them: the player's swings go to
  // state.monster, and killing one means turning to face it as an ordinary npc.
  combat.state.addTargetIndex = null
}

/**
 * Pre-signals a swing as a SINGLE pulse `leadTicks` before it resolves — the
 * client edge-detects this to start the clip (with its sub-tick delay) so the
 * impact frame lands on the hit event's splat. The hit/miss branches do NOT
 * re-broadcast 'attack' (a second, non-adjacent pulse would restart the clip on
 * the splat tick and desync it) — the pulse alone drives the whole swing,
 * mirroring the combat arena's shared windup (src/utils/combatWindup.js).
 *
 * `countdown` is ticks until the swing, and WHICH clock that is matters: an npc
 * on a shared clock keeps it on the npc, and its sessions' own timers are pinned
 * to 0-or-full rather than counting down — reading a pinned timer here means the
 * lead tick simply never comes round and the monster swings without animating.
 */
function signalSwing(npc: NpcState, swinging: boolean, countdown: number | undefined): void {
  // Clear last tick's swing so a fresh one re-triggers the attack animation.
  if (npc.anim === 'attack' || npc.anim === 'attack_ranged' || npc.anim === 'attack_magic') npc.anim = 'idle'
  if (swinging && countdown === monsterWindupLeadTicks(npc.monsterId)) npc.anim = monsterAttackAnim(npc.monsterId, npc.currentForm)
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
  // Everyone who earned this kill, on the same 10% share co-op pays loot at
  // (killCredit.js) — read BEFORE the clear below, which is the only copy of
  // who did what. The owner is kept separately because ground loot is one
  // physical pile on one tile: it can have exactly one owner, where the credit
  // below is per player. A solo killer is both.
  const credited = killCreditIds(
    [...npc.damageByChar].map(([id, { dmg, tick }]) => ({ id, damage: dmg, tick })),
    (monstersData as Record<string, { hitpoints?: number }>)[npc.monsterId]?.hitpoints ?? 0,
  )
  npc.damageByChar.clear()
  result.newLoot.push(...spawnDrops(loot, npc.x, npc.z, owner, ctx.tick))
  // Surface the kill so the DO can record boss collection-log / kill-count /
  // audit server-side (§14) — the loot itself still rides the trusted save blob.
  result.kills.push({ monsterId: npc.monsterId, owner, credited, loot, x: npc.x, z: npc.z, summoned: !!npc.summonerId })
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
  // Reach follows the FORM: a boss that lunges in melee and shoots at range has
  // one reach per form, and reading its top-level style gave it the starting
  // form's reach for the whole fight.
  const monsterRange = reachAgainst(npc.monsterId, monsterAttackRange(npc.monsterId, npc.currentForm))
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
  // A room-wide attacker swings at everybody present, so every engaged player's
  // session resolves the same swing and each rolls their own accuracy and
  // protection prayer against it. `isTarget` still decides who its retaliation
  // follows for chasing and threat.
  //
  // Its minions inherit that (isRoomWideFamily), so a sentinel hits everyone who
  // turned on it and not just the one the boss had claimed — the same answer the
  // mirror gives when the sentinel is the OTHER attacker, which is what stops
  // the two paths disagreeing about the same swing.
  const roomWide = isRoomWideFamily(npc, ctx.npcs)
  const isTarget = npc.attackerId === player.charId
  // Whose session may apply this npc's attacks to its own player.
  const takesSwings = roomWide || isTarget
  // The room owns the form (npc.ts advanceSharedSwing); this session wears it.
  // Rolling it per session gave every player a differently-formed boss off one
  // health bar — their own max hit to take and their own defences to roll
  // against, decided by nothing but which session ticked.
  combat.state.formPinned = isMultiForm(combat.state.monster)
  if (combat.state.formPinned) {
    // On the tick a fight starts the npc has not been through advanceSharedSwing
    // yet, and a session pinned to a form it has not chosen would fight the
    // starting form while the npc reported none.
    ensureForm(npc)
    pinFormToSession(combat.state.monster, sharedMonsterState(npc))
  }
  const sharedClock = usesSharedClock(npc)
  if (sharedClock) {
    // This npc's swing is resolved in several sessions at once, so hold every
    // session's own timer off the floor and fire them together on the npc's own
    // tick — otherwise each player's copy swings on a schedule of its own.
    combat.state.monsterAttackTimer = npc.sharedSwing
      ? 0
      : Math.max(2, Number(combat.state.monster.attackSpeed) || 4)
  }
  // Everything else in this encounter that is attacking this player, and which
  // of them can actually reach them this tick.
  const others = otherAttackers(npc, ctx)
  mirrorOtherAttackers(combat, others)
  const addReaches = others.map((other) => otherAttackerReaches(other, player, collision, ctx.npcs))

  // The pack rides in as the engine's inventory so magic can check runes;
  // consumption is applied below from state.runesConsumed (live-game contract:
  // consume on a landed hit, then clear so the same cast never double-charges).
  // THIS player's slayer task, not null: it is what lets the engine roll a
  // task-only drop (the Imbued Crown and Brain) and apply slayer gear bonuses,
  // exactly as the solo screen does. Passed as null, the world killer was the
  // one player who could never roll the drops their own task unlocks — while a
  // helper past the 10% line could (killLoot.ts rolls theirs on their own task).
  // It grants no slayer XP: creditWorldSlayerKill owns that, so there is no
  // double-pay here. Cast because the shared engine is JS and TS infers the
  // parameter as `null` from its own default.
  const { combatState, events } = processCombatTick(combat.state, playerStatsFor(player), player.equipment, itemsData, prayersData, player.inventory, (player.slayer?.task ?? null) as Parameters<typeof processCombatTick>[6])
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
  // The clock a shared-clock npc actually counts down on is its OWN: its
  // sessions' timers are pinned to 0-or-full and never pass through the lead.
  // Its swing is a property of the NPC too, not of this session, so it is
  // signalled unconditionally — every engaged player runs this and each call
  // clears the anim before re-setting it, so gating on one player's reach let
  // whichever session happened to run last wipe the clip for the whole room.
  // The mirrored attackers below are already signalled this way.
  signalSwing(npc, sharedClock || (takesSwings && inMonsterRange), sharedClock ? npc.attackTimer : combat.state.monsterAttackTimer)
  // The paired attacker has to be signalled from here as well: it may have no
  // retaliation target of its own (a summoned minion stands guard until somebody
  // turns on it), and then NO session would ever animate the swings it is
  // landing on this player.
  for (const other of others) {
    signalSwing(other, true, other.attackTimer)
    result.npcChanged.push(other.id)
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

  for (const ev of events as { type: string; fromAdd?: boolean; addIndex?: number; damage?: number; hits?: number[]; totalDamage?: number; loot?: { itemId: string; quantity: number }[]; xpSkills?: Record<string, number>; spellName?: string; itemId?: string; qty?: number }[]) {
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
      if (!(ev.fromAdd ? addReaches[ev.addIndex ?? -1] : takesSwings && inMonsterRange)) continue
      player.hp = Math.max(0, player.hp - (ev.damage ?? 0))
      result.hits.push({ targetId: player.charId, dmg: ev.damage ?? 0 })
    } else if (ev.type === 'monsterMiss') {
      if (!(ev.fromAdd ? addReaches[ev.addIndex ?? -1] : takesSwings && inMonsterRange)) continue
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
    // The bar has to empty on the tick that killed them. The zone's ordinary hp
    // echo can't do it: the respawn heals to full before that loop runs, and a
    // death that takes the player out of the zone skips it entirely — so the
    // last reading the client ever got was the tick BEFORE the killing blow,
    // and you died with health to spare.
    result.events.push({ e: 'hp', hp: 0, maxHp: player.maxHp })
    endCombatSpecial(player, result)
    return
  }

  // Re-pin the engine to the session value so the next tick's affordability
  // check reads the session's truth, not whatever the engine refilled itself to.
  pinSpecialToSession(player)
  emitSpecIfChanged(player, result.events)
}
