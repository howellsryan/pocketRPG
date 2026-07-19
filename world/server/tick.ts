// Pure per-tick simulation. Mutates the passed player/rock records but does no
// I/O — the DO owns the objects, calls tickPlayer once per player per tick, and
// decides what to broadcast/flush from the results.
import type { Tile } from './pathfind'
import type { CombatStance, EntityDiff, GearDescriptor, InvSlot, StationType, ZoneEvent } from '../shared/protocol'
import { GATHER_SKILLS, ROCK_DEPLETED_TICKS, addToInventory, inventoryIsFull, type GatherSkill, type MiningAction } from './mining'
import { STATIONS, recipeFor, stationTypeForVerb } from '../shared/recipes'
import { craftOnce, hasMaterials } from './crafting'
import { getLevelFromXP, clampXP } from '../../src/engine/experience.js'
import { startCombat, stepCombat, playerAttackRange, type CombatSession } from './combat'
import type { NpcState } from './npc'
import type { LootEntity } from './loot'
import { hasLineOfSight } from './los'
import monstersData from '../../src/data/monsters.json'

type MonsterStyles = Record<string, { attackStyle?: string } | undefined>
const monsterStyles = monstersData as unknown as MonsterStyles

export type TickAnim = EntityDiff['anim']

export type SessionStats = Record<string, { xp: number; level: number }>

/** A gather node (ore rock or tree). `rock` holds the skill's action id —
 * 'tin'/'copper' for mining, 'normal'/'oak' for woodcutting. Missing skill
 * means 'mining' (pre-Phase-6 fixtures). */
export type RockState = { id: string; rock: string; skill?: GatherSkill; x: number; z: number; depletedUntilTick: number }

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
  /** Special-attack energy readout (0-100); mirrors the engine's per-fight value
   * during combat, 100 between fights. `lastSpecSent` gates the {e:'spec'} echo. */
  specialEnergy: number
  lastSpecSent: number
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
}

// Running: 2 tiles/tick, ~100 energy drained over ~1 min of continuous running;
// regenerates while walking/idle. Tunable — not an engine formula.
export const RUN_DRAIN_PER_TILE = 0.6
export const RUN_REGEN_PER_TICK = 0.45

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
  kills: { monsterId: string; owner: string; loot: { itemId: string; quantity: number }[] }[]
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

/** A monster's attack reach from its attackStyle — magic/ranged strike from
 * afar; every melee style (stab/slash/crush/melee/unset) is 1 tile. */
export function monsterAttackRange(monsterId: string): number {
  const style = monsterStyles[monsterId]?.attackStyle
  return style === 'magic' ? MAGIC_RANGE : style === 'ranged' ? RANGED_RANGE : MELEE_RANGE
}

/** A monster's attack animation from its attackStyle — magic/ranged foes play a
 * distinct cast/shoot animation; everything else swings. */
export function monsterAttackAnim(monsterId: string): 'attack' | 'attack_ranged' | 'attack_magic' {
  const style = monsterStyles[monsterId]?.attackStyle
  return style === 'magic' ? 'attack_magic' : style === 'ranged' ? 'attack_ranged' : 'attack'
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
export function grantSessionXp(player: TickPlayer, skill: string, amount: number): ZoneEvent[] {
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
    if (player.combat?.npcId === npc.id) return
    const range = playerAttackRange(player)
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
    const skill = rock.skill ?? 'mining'
    const gather = GATHER_SKILLS[skill]
    if (intent.action !== gather.verb) return
    const action = actionFor(rock, ctx)
    if (!action) return
    const level = ensureSkill(player.stats, skill).level
    if (level < action.level) {
      result.events.push({ e: 'msg', text: gather.levelMsg(action.level) })
      return
    }
    if (inventoryIsFull(player.inventory, action.product)) {
      result.events.push({ e: 'msg', text: 'Your pack is full.' })
      return
    }
    player.mining = { rockId: rock.id, progress: 0 }
  }
}

/** ctx.actions (test override) only ever substitutes the mining table. */
function actionFor(rock: RockState, ctx: TickContext): MiningAction | undefined {
  const skill = rock.skill ?? 'mining'
  const table = skill === 'mining' && ctx.actions ? ctx.actions : GATHER_SKILLS[skill].actions
  return table[rock.rock]
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
  player.anim = 'mine'
  mining.progress += 1
  if (mining.progress < action.ticks) return
  mining.progress = 0

  if (!addToInventory(player.inventory, action.product, 1)) {
    result.events.push({ e: 'msg', text: 'Your pack is full.' })
    player.mining = null
    player.anim = 'idle'
    return
  }
  player.minted[action.product] = (player.minted[action.product] ?? 0) + 1
  result.events.push(...grantSessionXp(player, rock.skill ?? 'mining', action.xp))
  result.events.push({ e: 'inv', inventory: player.inventory })
  rock.depletedUntilTick = ctx.tick + ROCK_DEPLETED_TICKS
  result.rockChanges.push({ id: rock.id, depleted: true })
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
 * whether the player ran this tick (drives regen). */
function takeSteps(player: TickPlayer): boolean {
  if (player.path.length === 0) return false
  const first = player.path.shift()!
  player.x = first.x
  player.z = first.z
  if (!player.running || player.runEnergy <= 0) return false
  let ranTiles = 1
  if (player.path.length > 0) {
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
function findAggroInRange(player: TickPlayer, ctx: TickContext): NpcState | undefined {
  const collision = ctx.collision ?? []
  for (const npc of ctx.npcs?.values() ?? []) {
    if (npc.state === 'combat' && npc.attackerId === player.charId && withinRangeAndSight(player, npc, monsterAttackRange(npc.monsterId), collision)) return npc
  }
  return undefined
}

/** One tick for one player: movement first, then interaction arrival, then
 * mining progress. Exactly one of walk/mine/idle claims the anim each tick. */
export function tickPlayer(player: TickPlayer, ctx: TickContext): TickResult {
  const result = emptyResult()
  const before = { x: player.x, z: player.z, anim: player.anim }

  if (!player.combat) {
    const aggroNpc = findAggroInRange(player, ctx)
    if (aggroNpc) startCombat(player, aggroNpc, result)
  }

  let ran = false
  let moved = false
  if (player.path.length > 0) {
    ran = takeSteps(player)
    moved = true
    player.anim = 'walk'
    if (player.path.length === 0 && player.pendingInteract) startInteract(player, ctx, result)
  } else if (player.pendingInteract) {
    startInteract(player, ctx, result)
  }

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

  result.entChanged = player.x !== before.x || player.z !== before.z || player.anim !== before.anim
  return result
}

export function toEntityDiff(player: TickPlayer): EntityDiff {
  // Gear rides every player diff (even empty) so an in-world unequip
  // propagates — omitting it would leave stale weapons on observers.
  const diff: EntityDiff = { id: player.charId, kind: 'player', x: player.x, z: player.z, anim: player.anim, name: player.name, gear: player.gear }
  if (player.combat) diff.targetId = player.combat.npcId
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
