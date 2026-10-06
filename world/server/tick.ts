// Pure per-tick simulation. Mutates the passed player/rock records but does no
// I/O — the DO owns the objects, calls tickPlayer once per player per tick, and
// decides what to broadcast/flush from the results.
import type { Tile } from './pathfind'
import { reachAgainst } from '../shared/monsterSize'
import type { CombatStance, EntityDiff, GearDescriptor, InvSlot, StationType, ZoneEvent } from '../shared/protocol'
import { resourceAction, type ResourceAction, type ResourceSkill } from '../shared/resources'
import { getEffectiveToolActionTicks } from '../../src/engine/skilling.js'
import itemsData from '../../src/data/items.json'
import { GATHER_SKILLS, ROCK_DEPLETED_TICKS, addToInventory, inventoryIsFull, type MiningAction } from './mining'
import { STATIONS, recipeFor, stationTypeForVerb } from '../shared/recipes'
import { craftOnce, hasMaterials } from './crafting'
import { getLevelFromXP, clampXP } from '../../src/engine/experience.js'
import { grindmanXP } from '../../src/engine/grindman.js'
import { combatLevelFromLevels } from '../../src/engine/combatLevel.js'
import { refillSpecialOnEmpty } from '../../src/engine/specialRegen.js'
import { MONSTER_CLIP_ATTACK_RANGED, monsterAttackClipName } from '../../src/engine/monsterClips.js'
import { startCombat, stepCombat, resumeAggro, playerAttackRange, pinSpecialToSession, emitSpecIfChanged, FULL_SPECIAL_ENERGY, type CombatSession } from './combat'
import type { NpcState } from './npc'
import type { LootEntity } from './loot'
import { hasLineOfSight } from './los'
import { protectionOverhead } from '../shared/prayer'
import { isDangerTile } from '../shared/pvpArea'
import monstersData from '../../src/data/monsters.json'

type MonsterStyles = Record<string, { attackStyle?: string; forms?: Record<string, { attackStyle?: string } | undefined> } | undefined>
const monsterStyles = monstersData as unknown as MonsterStyles

export type TickAnim = EntityDiff['anim']

export type SessionStats = Record<string, { xp: number; level: number }>

/** A gather node (ore rock or tree). `rock` holds the skill's action id —
 * 'tin'/'copper' for mining, 'normal'/'oak' for woodcutting. Missing skill
 * means 'mining' (pre-Phase-6 fixtures). */
export type RockState = { id: string; rock: string; skill?: ResourceSkill; x: number; z: number; depletedUntilTick: number }

export type PendingInteract = { kind: 'rock' | 'object' | 'npc'; id: string; action: string }

/** A processing station object (furnace/anvil/range) in DO memory. */
export type StationState = { id: string; type: StationType; x: number; z: number }

export type CraftingState = { station: StationType; stationId: string; recipeId: string; remaining: number; progress: number }

export type TickPlayer = {
  charId: string
  name: string
  x: number
  z: number
  path: Tile[]
  anim: TickAnim
  stats: SessionStats
  /** From characters.is_grindman, stamped at hello: half XP, triple drop rates.
   * On the SESSION because a zone holds a mix of account types and one npc is
   * fought by all of them. Optional like masterRejuvenation below — absent on a
   * session that predates the mode, which reads as an ordinary account. */
  isGrindman?: boolean
  inventory: InvSlot[]
  pendingXp: Record<string, number>
  /** Units created in-world this session (mined ore, killed-for loot, …) — the
   * grant delta. Save-backed units seeded from the character's inventory are
   * NOT here. */
  minted: Record<string, number>
  mining: { rockId: string; progress: number } | null
  /** Active station craft (set by {t:'craft'}, cleared by movement/intents). */
  crafting: CraftingState | null
  pendingInteract: PendingInteract | null
  /** Current HP (seeded from the hitpoints level at hello, regenerated slowly). */
  hp: number
  maxHp: number
  /** Equipment from the save blob, passed straight to the combat engine. */
  equipment: Record<string, unknown>
  /** Visual descriptor derived from equipment (shared/appearance.ts); updated
   * live when the player equips/unequips in-world. */
  gear: GearDescriptor
  combat: CombatSession | null
  /** Run toggle + energy (0-100). Running moves 2 tiles/tick and drains energy;
   * walking/idle regenerates it. `lastRunSent` gates the {e:'run'} echo. */
  running: boolean
  runEnergy: number
  lastRunSent: number
  /** Melee stance driving new fights (accurate/aggressive/defensive). */
  stance: CombatStance
  /** Selected combat-spell id (magic weapons); session-local, null = none. */
  spell: string | null
  /** Special-attack energy (0-100). The SESSION's value, not the engine's: it
   * persists across fights, is debited when a special fires, and only recovers
   * on the clock. `lastSpecSent` gates the {e:'spec'} echo. */
  specialEnergy: number
  lastSpecSent: number
  /** The Master Rejuvenation construction perk, read from the save at hello:
   * refills a spent bar outright. Absent on a session that predates it. */
  masterRejuvenation?: boolean
  /** Gates the {e:'spec'} echo's `queued` field alongside lastSpecSent. */
  lastSpecQueuedSent: boolean
  /** Armed by a {t:'special'} sent with no active fight (combat.ts): fires as
   * the first swing of the next fight this player starts, instead of refusing
   * the tap outright. Cleared by startCombat once consumed. */
  pendingSpecial: boolean
  /** Prayer session (world/shared/prayer.ts): pool seeded full at hello from the
   * Prayer level, drains only during combat (copied onto the engine state each
   * fight, synced back after each tick), persists across auto-fight kills. The
   * active protection/combat prayer ids are the player's toggles. `lastPrayerSent`
   * gates the {e:'prayer'} echo. */
  prayerPoints: number
  maxPrayerPoints: number
  prayerDrainAccumulator: number
  activeProtectionPrayer: string | null
  activeCombatPrayer: string | null
  lastPrayerSent: string | null
  /** Active potion buffs { potionItemId: ticksRemaining } — session state copied
   * onto the engine at fight start and decayed per combat tick (item 8). */
  activePotions: Record<string, number>
  /** charId of another player being followed (item 10), or null. Cleared on
   * any explicit walk/interact/teleport/craft (WorldZone's clearIntents),
   * combat start (this file — covers both attacking and being attacked), or
   * the target leaving the zone/disconnecting (this file, via ctx.players). */
  following: string | null
  /** Target's tile the last time a follow path was computed — re-path only
   * when this changes, so a stationary target doesn't cost a pathfind every
   * tick while the follower is still en route. */
  followTargetTile: { x: number; z: number } | null
  /** Wilderness: a special armed for the next PvP swing (world/server/pvpCombat.ts).
   * Distinct from `pendingSpecial`, which arms the next PvE fight. */
  specialAttackQueued?: boolean
  /** Wilderness single-combat opponent (world/server/pvpCombat.ts), or null.
   * Lives on the base session rather than the DO's Player so the entity diff can
   * read it without importing the zone. */
  pvpOpponentId?: string | null
  /** The player's own slayer session, owned by the DO (killProgress.ts) and
   * declared here structurally so the combat adapter can hand the engine THIS
   * player's task: it is what makes a task-only drop roll and a slayer weapon
   * apply its bonus. Optional because the pure tick fixtures carry no session. */
  slayer?: { task: { monsterId?: string } | null }
  /** Overhead protection-prayer style last put on the wire. Prayers toggle
   * BETWEEN ticks (a client message), so the tick's own before/after snapshot
   * can't see the change — this is what makes the entity diff go out, the same
   * way lastHpSent/lastPrayerSent gate their echoes. */
  lastOverheadSent?: 'melee' | 'ranged' | 'magic' | null
}

// Running: 2 tiles/tick, ~100 energy drained over ~1 min of continuous running;
// regenerates while walking/idle. Tunable — not an engine formula.
export const RUN_DRAIN_PER_TILE = 0.6
export const RUN_REGEN_PER_TICK = 0.45
/** Special energy is a session resource out here, not a per-fight one: it only
 * ever comes back on the clock, at 10 points per 30s (50 ticks) — so a spent
 * special stays spent whether you keep fighting, walk away, or kill the thing. */
export const SPECIAL_REGEN_PER_TICK = 10 / 50

export type TickContext = {
  tick: number
  rocks: Map<string, RockState>
  actions?: Record<string, MiningAction>
  npcs?: Map<string, NpcState>
  stations?: Map<string, StationState>
  collision?: string[]
  /** Re-path to a tile adjacent to a (possibly moving) target — used to chase a
   * wandering npc that stepped away before the player finished approaching. */
  pathAdjacent?: (from: Tile, to: Tile) => Tile[] | null
  /** Snapshot of every connected player's position this tick — lets an
   * aggressive npc chase its attacker (npc.ts) without needing the full
   * player record. */
  players?: Map<string, { x: number; z: number }>
  /** This room is one instance of a boss lair, so a boss here has the run of it
   * (npc.ts pursueLeashTiles). Not a property of the zone DEF: the same def is
   * served as many rooms, and it is the private room, not the geography, that
   * makes an unbounded chase fair. */
  lair?: boolean
  /** This room is the Wilderness, so Master Rejuvenation is off: a bar that
   * comes back free every time it empties decides a duel by who owns a perk. */
  pvpZone?: boolean
  /** Refuses a step before it is taken (the Wilderness line: crossing north
   * without having answered the prompt). Gating the STEP rather than each path
   * assignment is deliberate — a walk, a follow, an approach path and anything
   * added later all funnel through takeSteps, so there is exactly one place a
   * player can cross and exactly one place to stop them. */
  blockStep?: (player: TickPlayer, to: Tile) => boolean
}

export type TickResult = {
  entChanged: boolean
  events: ZoneEvent[]
  rockChanges: { id: string; depleted: boolean }[]
  /** The player arrived at a bank chest → open the bank UI. */
  bankOpen: boolean
  /** The player arrived at a processing station → open its recipe panel. */
  stationOpen: StationType | null
  /** Items consumed out of the pack this tick (craft materials, spell runes) —
   * the DO drains the provenance pools with these (tick.ts has no pools access). */
  consumed: Record<string, number>[]
  /** Zone-wide hitsplats ({dmg:0} = block/miss). */
  hits: { targetId: string; dmg: number }[]
  /** This player's HP hit 0 this tick → respawn + {t:'dead'}. */
  died: boolean
  /** Ranged ammo left the equipped slot this tick (combat.ts mutated
   * player.equipment.ammo) → the DO marks equipment dirty + debounces a flush so
   * the consumed arrows are persisted to the save. */
  equipmentDirty: boolean
  /** Loot to add to the zone (rolled on a kill this player landed). */
  newLoot: LootEntity[]
  /** NPC ids whose broadcast state changed / that should be removed. */
  npcChanged: string[]
  npcRemoved: string[]
  /** Kills resolved this tick, for the DO to record server-authoritatively
   * (collection log + kill count + audit for bosses). `owner` is the top-damage
   * contributor; `loot` is what was rolled for them. */
  /** `owner` is the top-damage player, whose roll came off the death event and
   * is already on the floor. `credited` is everyone who earned the kill on the
   * shared 10% damage share (killCredit.js) — kill count, slayer task, daily
   * tasks and a drop-table roll of their own (killLoot.ts) go to all of them.
   * `summoned` marks a boss minion, which earns none of it (§4: adds count for
   * nothing) despite being a real npc out here that dies like any other. */
  kills: {
    monsterId: string
    /** Biggest contributor — who the kill is announced under. */
    owner: string
    /** Who landed the last blow, and so whose flags rolled `loot`. */
    killer: string
    credited: string[]
    /** The killer's own roll, empty when they never reached the credit line. */
    loot: { itemId: string; quantity: number }[]
    /** The death tile: every credited player's pile is spawned here. */
    x: number
    z: number
    summoned?: boolean
  }[]
}

export function emptyResult(): TickResult {
  return { entChanged: false, events: [], rockChanges: [], bankOpen: false, stationOpen: null, consumed: [], hits: [], died: false, equipmentDirty: false, newLoot: [], npcChanged: [], npcRemoved: [], kills: [] }
}

/** Seeds the 28-slot session pack from the character's PocketRPG inventory at
 * hello, and tallies those save-backed units per item so flushes can tell them
 * apart from world-minted ones (seeded units are already in the save — they
 * must never be re-granted, only moved to the bank on deposit). */
export function sessionInventoryFromSave(save: Record<string, unknown>): {
  inventory: InvSlot[]
  saveBacked: Record<string, number>
} {
  const inventory: InvSlot[] = new Array<InvSlot>(28).fill(null)
  const saveBacked: Record<string, number> = {}
  const slots = Array.isArray(save?.inventory) ? save.inventory : []
  let next = 0
  for (const slot of slots) {
    if (next >= inventory.length) break
    if (!slot || typeof slot !== 'object') continue
    const itemId = typeof slot.itemId === 'string' && slot.itemId ? slot.itemId : null
    const quantity = Math.floor(Number(slot.quantity) || 0)
    if (!itemId || quantity < 1) continue
    inventory[next++] = { itemId, quantity }
    saveBacked[itemId] = (saveBacked[itemId] ?? 0) + quantity
  }
  return { inventory, saveBacked }
}

/** Seeds session stats from the save blob once at hello. Missing levels are
 * derived from XP (mirrors how the save summary derives them). */
export function sessionStatsFromSave(save: Record<string, unknown>): SessionStats {
  const out: SessionStats = {}
  const stats = (save?.stats ?? {}) as Record<string, { xp?: number; level?: number }>
  for (const [skill, entry] of Object.entries(stats)) {
    const xp = Number(entry?.xp) || 0
    const level = Number(entry?.level) || getLevelFromXP(xp)
    out[skill] = { xp, level }
  }
  return out
}

const VALID_STANCES = new Set<CombatStance>(['accurate', 'aggressive', 'defensive'])

/** Seeds the session's combat stance from the save's settings at hello —
 * mirrors the main game's persisted `settings.combatStance` (CombatScreen's
 * stance picker) so a world session starts on whatever stance the player last
 * chose instead of always resetting to Accurate. Anything the world doesn't
 * support (the legacy `controlled` stance, an unset/corrupt value) folds to
 * the same 'accurate' default the main game uses post-migration. */
export function combatStanceFromSave(save: Record<string, unknown>): CombatStance {
  const settings = (save?.settings ?? {}) as Record<string, unknown>
  const stance = settings.combatStance
  return VALID_STANCES.has(stance as CombatStance) ? (stance as CombatStance) : 'accurate'
}

export function adjacent(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)) === 1
}

// Attack reach in Chebyshev tiles by combat type: melee 1, ranged 5, magic 7.
// Applies symmetrically to players (their weapon) and monsters (their attackStyle).
export const MELEE_RANGE = 1
export const RANGED_RANGE = 5
export const MAGIC_RANGE = 7

export function rangeForCombatType(type: string): number {
  return type === 'magic' ? MAGIC_RANGE : type === 'ranged' ? RANGED_RANGE : MELEE_RANGE
}

/**
 * The style a monster is fighting with. `form` is the FORM it is currently in
 * (npc.currentForm) — a multi-form boss's top-level attackStyle is only its
 * starting one, so reading that alone left Zaryth permanently ranged out here:
 * always the shoot clip, always ranged reach, and the melee and magic clips its
 * rig ships dead on arrival.
 */
export function monsterAttackStyle(monsterId: string, form?: string | null): string | undefined {
  const monster = monsterStyles[monsterId]
  const formStyle = form ? monster?.forms?.[form]?.attackStyle : null
  return formStyle ?? monster?.attackStyle
}

/** A monster's attack reach from its attackStyle — magic/ranged strike from
 * afar; every melee style (stab/slash/crush/melee/unset) is 1 tile. */
export function monsterAttackRange(monsterId: string, form?: string | null): number {
  const style = monsterAttackStyle(monsterId, form)
  return style === 'magic' ? MAGIC_RANGE : style === 'ranged' ? RANGED_RANGE : MELEE_RANGE
}

/** A monster's attack animation from its attackStyle — magic/ranged foes play a
 * distinct cast/shoot animation; everything else swings. The melee branch defers
 * to the shared clip table (src/engine/monsterClips.js), which is where a rig
 * whose own melee clip is unusable is sent to its ranged one instead — the arena
 * reads the same table, so both render paths swing alike. */
export function monsterAttackAnim(monsterId: string, form?: string | null): 'attack' | 'attack_ranged' | 'attack_magic' {
  const style = monsterAttackStyle(monsterId, form)
  if (style === 'magic') return 'attack_magic'
  return monsterAttackClipName(style, monsterId) === MONSTER_CLIP_ATTACK_RANGED ? 'attack_ranged' : 'attack'
}

export function withinRange(a: { x: number; z: number }, b: { x: number; z: number }, range: number): boolean {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)) <= range
}

/** Reach check for actually landing a hit: within Chebyshev range AND, for
 * ranged/magic (range > melee), an unobstructed line of sight. Melee (range 1)
 * needs only adjacency. This is the gate that closes safespotting — applied
 * symmetrically to a player's shot and a monster's. */
export function withinRangeAndSight(
  a: { x: number; z: number },
  b: { x: number; z: number },
  range: number,
  collision: string[],
): boolean {
  if (!withinRange(a, b, range)) return false
  if (range <= MELEE_RANGE) return true
  return hasLineOfSight(collision, a, b)
}

/** Trims an approach path to stop at the first tile within `range` of the
 * target (melee walks all the way to adjacency; ranged/magic stop early). */
export function cutPathToRange(steps: Tile[], target: { x: number; z: number }, range: number): Tile[] {
  let cut = steps.length
  for (let i = 0; i < steps.length; i++) {
    if (withinRange(steps[i], target, range)) { cut = i + 1; break }
  }
  return steps.slice(0, cut)
}

function ensureSkill(stats: SessionStats, skill: string): { xp: number; level: number } {
  if (!stats[skill]) stats[skill] = { xp: 0, level: 1 }
  return stats[skill]
}

/** Applies an in-session XP gain: session stats (level-ups apply live) plus the
 * pending flush tally. Returns the events to send to this player. */
export function grantSessionXp(player: TickPlayer, skill: string, rawAmount: number): ZoneEvent[] {
  // The world's XP funnel, so Grindman's cut lands here — before the event that
  // shows the number and before the tally that flushes to the save, or the two
  // would disagree with what the player actually banked.
  const amount = grindmanXP(rawAmount, player.isGrindman === true)
  const events: ZoneEvent[] = [{ e: 'xp', skill, amount }]
  const entry = ensureSkill(player.stats, skill)
  entry.xp = clampXP(entry.xp + amount)
  const newLevel = getLevelFromXP(entry.xp)
  if (newLevel > entry.level) {
    entry.level = newLevel
    const skillName = skill.charAt(0).toUpperCase() + skill.slice(1)
    events.push({ e: 'msg', text: `Congratulations, you've reached ${skillName} level ${newLevel}!` })
  }
  player.pendingXp[skill] = (player.pendingXp[skill] ?? 0) + amount
  return events
}

function startInteract(player: TickPlayer, ctx: TickContext, result: TickResult): void {
  const intent = player.pendingInteract
  player.pendingInteract = null
  if (!intent) return

  if (intent.kind === 'object' && intent.action === 'bank') {
    result.bankOpen = true
    return
  }

  if (intent.kind === 'object') {
    const stationType = stationTypeForVerb(intent.action)
    if (stationType) {
      result.stationOpen = stationType
      return
    }
  }

  if (intent.kind === 'npc' && intent.action === 'attack') {
    const npc = ctx.npcs?.get(intent.id)
    if (!npc || npc.state === 'dead') return
    // Already fighting this exact npc: stepCombat (called later this same tick)
    // continues the live session. Re-arming pendingInteract every re-click
    // otherwise re-runs this branch each tick, and startCombat always builds a
    // fresh engine state (attack timer reset to 0) — a free instant hit that
    // defeats WorldZone.handleInteract's keepCombat preservation.
    // Already fighting this npc. A disengaged session (the player walked away)
    // re-engages here — that click is the ONLY thing that makes them swing
    // again — and walks back into reach if they wandered out of it.
    if (player.combat?.npcId === npc.id) {
      if (!player.combat.passive) return
      player.combat.passive = false
      const reach = reachAgainst(npc.monsterId, playerAttackRange(player))
      if (withinRange(player, npc, reach)) return
      const back = ctx.pathAdjacent?.(player, npc)
      if (back && back.length > 1) {
        player.path = cutPathToRange(back.slice(1), npc, reach)
        player.pendingInteract = intent
      }
      return
    }
    const range = reachAgainst(npc.monsterId, playerAttackRange(player))
    if (withinRange(player, npc, range)) {
      startCombat(player, npc, result)
      return
    }
    // Out of reach — approach, but for ranged/magic stop as soon as we're within
    // range rather than walking all the way adjacent. Keep the intent so we try
    // again on arrival (the npc stops moving once combat starts).
    const path = ctx.pathAdjacent?.(player, npc)
    if (path && path.length > 1) {
      player.path = cutPathToRange(path.slice(1), npc, range)
      player.pendingInteract = intent
    }
    return
  }

  if (intent.kind === 'rock') {
    const rock = ctx.rocks.get(intent.id)
    if (!rock || !adjacent(player, rock)) return
    const action = actionFor(rock, ctx)
    if (!action || intent.action !== action.verb) return
    if (action.xpSkill) {
      const level = ensureSkill(player.stats, action.xpSkill).level
      if (level < action.level) {
        result.events.push({ e: 'msg', text: GATHER_SKILLS[action.xpSkill].levelMsg(action.level) })
        return
      }
    }
    if (inventoryIsFull(player.inventory, action.product)) {
      result.events.push({ e: 'msg', text: 'Your pack is full.' })
      return
    }
    player.mining = { rockId: rock.id, progress: 0 }
  }
}

/** ctx.actions (test override) only ever substitutes the mining table. */
function actionFor(rock: RockState, ctx: TickContext): ResourceAction | undefined {
  if ((rock.skill ?? 'mining') === 'mining' && ctx.actions) {
    const action = ctx.actions[rock.rock]
    return action ? { ...action, quantity: 1, xpSkill: 'mining', verb: 'mine', depletionTicks: ROCK_DEPLETED_TICKS } : undefined
  }
  return resourceAction(rock)
}

function tickMining(player: TickPlayer, ctx: TickContext, result: TickResult): void {
  const mining = player.mining
  if (!mining) return
  const rock = ctx.rocks.get(mining.rockId)
  const action = rock ? actionFor(rock, ctx) : undefined
  if (!rock || !action || !adjacent(player, rock)) {
    player.mining = null
    player.anim = 'idle'
    return
  }
  if (rock.depletedUntilTick > ctx.tick) {
    // Auto-continue: stay latched onto the rock and resume when it respawns.
    player.anim = 'idle'
    mining.progress = 0
    return
  }
  player.anim = action.verb === 'fish' || action.verb === 'gather' ? 'idle' : 'mine'
  mining.progress += 1
  const duration = action.xpSkill === 'fishing'
    ? getEffectiveToolActionTicks('fishing', action.ticks, player.equipment, itemsData, player.stats, player.inventory)
    : action.ticks
  if (mining.progress < duration) return
  mining.progress = 0

  if (!addToInventory(player.inventory, action.product, action.quantity)) {
    result.events.push({ e: 'msg', text: 'Your pack is full.' })
    player.mining = null
    player.anim = 'idle'
    return
  }
  player.minted[action.product] = (player.minted[action.product] ?? 0) + action.quantity
  if (action.xpSkill && action.xp > 0) result.events.push(...grantSessionXp(player, action.xpSkill, action.xp))
  result.events.push({ e: 'inv', inventory: player.inventory })
  if (action.depletionTicks > 0) {
    rock.depletedUntilTick = ctx.tick + action.depletionTicks
    result.rockChanges.push({ id: rock.id, depleted: true })
  }
}

function stopCrafting(player: TickPlayer): void {
  player.crafting = null
  player.anim = 'idle'
}

function tickCrafting(player: TickPlayer, ctx: TickContext, result: TickResult): void {
  const crafting = player.crafting
  if (!crafting) return
  const station = ctx.stations?.get(crafting.stationId)
  const recipe = recipeFor(crafting.station, crafting.recipeId)
  if (!station || !recipe || !adjacent(player, station)) {
    stopCrafting(player)
    return
  }
  player.anim = 'mine'
  crafting.progress += 1
  if (crafting.progress < recipe.ticks) return
  crafting.progress = 0

  const skill = STATIONS[crafting.station].skill
  const level = ensureSkill(player.stats, skill).level
  const outcome = craftOnce(player.inventory, recipe, level)
  if (!outcome.ok) {
    result.events.push({ e: 'msg', text: outcome.reason === 'space' ? 'Your pack is full.' : 'You have run out of materials.' })
    stopCrafting(player)
    return
  }
  player.minted[outcome.product] = (player.minted[outcome.product] ?? 0) + 1
  result.consumed.push(outcome.consumed)
  if (outcome.burnt) result.events.push({ e: 'msg', text: 'You accidentally burn the food.' })
  result.events.push(...grantSessionXp(player, skill, outcome.xp))
  result.events.push({ e: 'inv', inventory: player.inventory })
  crafting.remaining -= 1
  if (crafting.remaining <= 0) stopCrafting(player)
  else if (!hasMaterials(player.inventory, recipe)) {
    result.events.push({ e: 'msg', text: 'You have run out of materials.' })
    stopCrafting(player)
  }
}

/** Advances the player along its path: one tile normally, a second tile when
 * running with energy to spare. Drains run energy per running tile. Returns
 * whether the player ran this tick (drives regen).
 *
 * A refused step (ctx.blockStep) drops the rest of the path on the floor: the
 * character stops where they stand, which is what makes the Wilderness prompt
 * read as "you are at the gate" rather than as a click that did nothing. */
function takeSteps(player: TickPlayer, ctx: TickContext, result: TickResult): boolean {
  if (player.path.length === 0) return false
  if (ctx.blockStep?.(player, player.path[0])) {
    player.path = []
    result.events.push({ e: 'pvpPrompt' })
    return false
  }
  const first = player.path.shift()!
  player.x = first.x
  player.z = first.z
  if (!player.running || player.runEnergy <= 0) return false
  let ranTiles = 1
  if (player.path.length > 0) {
    if (ctx.blockStep?.(player, player.path[0])) {
      player.path = []
      result.events.push({ e: 'pvpPrompt' })
      player.runEnergy = Math.max(0, player.runEnergy - RUN_DRAIN_PER_TILE)
      return true
    }
    const second = player.path.shift()!
    player.x = second.x
    player.z = second.z
    ranTiles = 2
  }
  player.runEnergy = Math.max(0, player.runEnergy - RUN_DRAIN_PER_TILE * ranTiles)
  return true
}

/** Emits a {e:'run'} echo when the integer energy readout or the toggle changed
 * since the last one this player saw. */
export function emitRunIfChanged(player: TickPlayer, events: ZoneEvent[]): void {
  const rounded = Math.round(player.runEnergy)
  if (rounded === player.lastRunSent) return
  player.lastRunSent = rounded
  events.push({ e: 'run', energy: rounded, running: player.running })
}

/** An aggressive npc that has chased this player back into ITS attack range —
 * resumes the fight without a fresh interact, mirroring how a real aggressive
 * monster keeps swinging once it catches up (melee at 1 tile, ranged/magic from
 * their reach). */
/** Re-paths a following player toward their target's current tile (stopping
 * adjacent, never onto the occupied tile) when it has moved since the last
 * path was computed. No-ops (cheaply) when the target hasn't moved — pathing
 * is the expensive part, so this is the guard the plan calls for. Clears
 * `following` when the target has left the zone (covers leaving/logging out;
 * a dead target respawns rather than being removed, so a follower simply
 * re-paths toward the respawn tile like any other movement). */
function updateFollow(player: TickPlayer, ctx: TickContext): void {
  if (!player.following) return
  const targetPos = ctx.players?.get(player.following)
  if (!targetPos) {
    player.following = null
    player.followTargetTile = null
    return
  }
  const tile = player.followTargetTile
  if (tile && tile.x === targetPos.x && tile.z === targetPos.z) return
  player.followTargetTile = { x: targetPos.x, z: targetPos.z }
  const path = ctx.pathAdjacent?.({ x: player.x, z: player.z }, targetPos)
  player.path = path ? path.slice(1) : []
}

/** One tick for one player: movement first, then interaction arrival, then
 * mining progress. Exactly one of walk/mine/idle claims the anim each tick. */
export function tickPlayer(player: TickPlayer, ctx: TickContext): TickResult {
  const result = emptyResult()
  const before = { x: player.x, z: player.z, anim: player.anim, hp: player.hp }

  // Combat always wins over following — cancel it here rather than only at the
  // {t:'follow'}/clearIntents call sites, so this catches every way combat can
  // start. Nothing starts it but the player's own attack: a monster you have
  // not clicked never drags you into a fight.
  if (player.combat) {
    player.following = null
    player.followTargetTile = null
  } else {
    updateFollow(player, ctx)
  }

  let ran = false
  let moved = false
  if (player.path.length > 0) {
    ran = takeSteps(player, ctx, result)
    moved = true
    player.anim = 'walk'
    if (player.path.length === 0 && player.pendingInteract) startInteract(player, ctx, result)
  } else if (player.pendingInteract) {
    startInteract(player, ctx, result)
  }

  // An npc that chased its quarry back into reach re-opens the fight itself —
  // npc.ts keeps ANY npc's target across a disengage now, so without this it
  // would catch up and just stand there. Before the combat branch, so an npc
  // that closed the gap this tick can land its swing on this same tick.
  resumeAggro(player, ctx)

  // Combat ticks whether or not the player is moving: a ranged/magic monster
  // keeps attacking a fleeing player, and a kiting player keeps attacking back.
  // stepCombat gates each side by its own reach and ends the fight once the
  // player is beyond both. Idle activities only run on a tick the player neither
  // moved nor is fighting — a tick that ended on a step keeps its 'walk' anim.
  if (player.combat) {
    stepCombat(player, ctx, result)
  } else if (!moved) {
    if (player.mining) tickMining(player, ctx, result)
    else if (player.crafting) tickCrafting(player, ctx, result)
    else if (!result.bankOpen && !result.stationOpen) player.anim = 'idle'
  }

  // Regenerate run energy on any tick the player didn't run (walking or idle).
  if (!ran && player.runEnergy < 100) player.runEnergy = Math.min(100, player.runEnergy + RUN_REGEN_PER_TICK)
  emitRunIfChanged(player, result.events)

  // Special energy ticks back up everywhere — mid-fight, walking, standing
  // still — and is pushed onto the live engine state so the fight sees it.
  // Master Rejuvenation is checked first, on the tick the spend lands
  // (stepCombat ran above): a clock tick added first leaves the bar off zero
  // and the refill never fires again.
  if (player.specialEnergy < FULL_SPECIAL_ENERGY) {
    player.specialEnergy = refillSpecialOnEmpty(player.specialEnergy, !!player.masterRejuvenation && !ctx.pvpZone)
    if (player.specialEnergy < FULL_SPECIAL_ENERGY) player.specialEnergy = Math.min(FULL_SPECIAL_ENERGY, player.specialEnergy + SPECIAL_REGEN_PER_TICK)
    pinSpecialToSession(player)
    emitSpecIfChanged(player, result.events)
  }

  const overhead = protectionOverhead(player.activeProtectionPrayer)
  const overheadChanged = overhead !== (player.lastOverheadSent ?? null)
  if (overheadChanged) player.lastOverheadSent = overhead
  result.entChanged = overheadChanged || player.x !== before.x || player.z !== before.z || player.anim !== before.anim || player.hp !== before.hp
  return result
}

/** Combat level from a live session's stats. SessionStats already carries a
 * `level` per skill, so this never re-derives levels from XP. */
export function sessionCombatLevel(stats: SessionStats): number {
  const levels: Record<string, number> = {}
  for (const skill in stats) levels[skill] = stats[skill].level
  return combatLevelFromLevels(levels)
}

export function toEntityDiff(player: TickPlayer, opts?: { pvpZone?: boolean }): EntityDiff {
  // Gear rides every player diff (even empty) so an in-world unequip
  // propagates — omitting it would leave stale weapons on observers. hp/maxHp
  // ride every diff too (item 11 — players show an overhead HP bar like
  // NPCs), always, same as gear: the client decides when to draw it.
  const diff: EntityDiff = {
    id: player.charId, kind: 'player', x: player.x, z: player.z, anim: player.anim, name: player.name,
    combatLevel: sessionCombatLevel(player.stats),
    gear: player.gear, hp: player.hp, maxHp: player.maxHp,
  }
  if (player.combat) diff.targetId = player.combat.npcId
  else if (player.pvpOpponentId) diff.targetId = player.pvpOpponentId
  // Only ever set inside the Wilderness: `isDangerTile` is a z test, and every
  // other zone has tiles that would satisfy it by accident.
  if (opts?.pvpZone && isDangerTile(player)) diff.pvp = true
  // Overhead protection prayer, for everyone who can see this player. Absent
  // means none — the client clears the icon rather than merging.
  const overhead = protectionOverhead(player.activeProtectionPrayer)
  if (overhead) diff.overhead = overhead
  return diff
}

/** Rocks whose depletion window ends exactly this tick → respawn broadcasts. */
export function respawnedRocks(rocks: Map<string, RockState>, tick: number): { id: string; depleted: boolean }[] {
  const changes: { id: string; depleted: boolean }[] = []
  for (const rock of rocks.values()) {
    if (rock.depletedUntilTick !== 0 && rock.depletedUntilTick === tick) {
      changes.push({ id: rock.id, depleted: false })
    }
  }
  return changes
}
