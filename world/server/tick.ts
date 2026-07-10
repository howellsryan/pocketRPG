// Pure per-tick simulation. Mutates the passed player/rock records but does no
// I/O — the DO owns the objects, calls tickPlayer once per player per tick, and
// decides what to broadcast/flush from the results.
import type { Tile } from './pathfind'
import type { EntityDiff, InvSlot, ZoneEvent } from '../shared/protocol'
import { MINING_ACTIONS, ROCK_DEPLETED_TICKS, addToInventory, inventoryIsFull, type MiningAction } from './mining'
import { getLevelFromXP, clampXP } from '../../src/engine/experience.js'
import { startCombat, stepCombat, type CombatSession } from './combat'
import type { NpcState } from './npc'
import type { LootEntity } from './loot'

export type TickAnim = EntityDiff['anim']

export type SessionStats = Record<string, { xp: number; level: number }>

export type RockState = { id: string; rock: string; x: number; z: number; depletedUntilTick: number }

export type PendingInteract = { kind: 'rock' | 'object' | 'npc'; id: string; action: string }

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
  pendingInteract: PendingInteract | null
  /** Current HP (seeded from the hitpoints level at hello, regenerated slowly). */
  hp: number
  maxHp: number
  /** Equipment from the save blob, passed straight to the combat engine. */
  equipment: Record<string, unknown>
  combat: CombatSession | null
}

export type TickContext = {
  tick: number
  rocks: Map<string, RockState>
  actions?: Record<string, MiningAction>
  npcs?: Map<string, NpcState>
  collision?: string[]
  /** Re-path to a tile adjacent to a (possibly moving) target — used to chase a
   * wandering npc that stepped away before the player finished approaching. */
  pathAdjacent?: (from: Tile, to: Tile) => Tile[] | null
}

export type TickResult = {
  entChanged: boolean
  events: ZoneEvent[]
  rockChanges: { id: string; depleted: boolean }[]
  deposit: boolean
  /** Zone-wide hitsplats ({dmg:0} = block/miss). */
  hits: { targetId: string; dmg: number }[]
  /** This player's HP hit 0 this tick → respawn + {t:'dead'}. */
  died: boolean
  /** Loot to add to the zone (rolled on a kill this player landed). */
  newLoot: LootEntity[]
  /** NPC ids whose broadcast state changed / that should be removed. */
  npcChanged: string[]
  npcRemoved: string[]
}

export function emptyResult(): TickResult {
  return { entChanged: false, events: [], rockChanges: [], deposit: false, hits: [], died: false, newLoot: [], npcChanged: [], npcRemoved: [] }
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

export function adjacent(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)) === 1
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

  if (intent.kind === 'object' && intent.action === 'deposit') {
    result.deposit = true
    return
  }

  if (intent.kind === 'npc' && intent.action === 'attack') {
    const npc = ctx.npcs?.get(intent.id)
    if (!npc || npc.state === 'dead') return
    if (adjacent(player, npc)) {
      startCombat(player, npc)
      return
    }
    // The bull wandered off before we arrived — re-approach and keep the intent
    // so we try again on the next arrival (it stops moving once combat starts).
    const path = ctx.pathAdjacent?.(player, npc)
    if (path && path.length > 1) {
      player.path = path.slice(1)
      player.pendingInteract = intent
    }
    return
  }

  if (intent.kind === 'rock' && intent.action === 'mine') {
    const rock = ctx.rocks.get(intent.id)
    if (!rock || !adjacent(player, rock)) return
    const action = (ctx.actions ?? MINING_ACTIONS)[rock.rock]
    if (!action) return
    const level = ensureSkill(player.stats, 'mining').level
    if (level < action.level) {
      result.events.push({ e: 'msg', text: `You need Mining level ${action.level} to mine this rock.` })
      return
    }
    if (inventoryIsFull(player.inventory, action.product)) {
      result.events.push({ e: 'msg', text: 'Your pack is full.' })
      return
    }
    player.mining = { rockId: rock.id, progress: 0 }
  }
}

function tickMining(player: TickPlayer, ctx: TickContext, result: TickResult): void {
  const mining = player.mining
  if (!mining) return
  const rock = ctx.rocks.get(mining.rockId)
  const action = rock ? (ctx.actions ?? MINING_ACTIONS)[rock.rock] : undefined
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
  result.events.push(...grantSessionXp(player, 'mining', action.xp))
  result.events.push({ e: 'inv', inventory: player.inventory })
  rock.depletedUntilTick = ctx.tick + ROCK_DEPLETED_TICKS
  result.rockChanges.push({ id: rock.id, depleted: true })
}

/** One tick for one player: movement first, then interaction arrival, then
 * mining progress. Exactly one of walk/mine/idle claims the anim each tick. */
export function tickPlayer(player: TickPlayer, ctx: TickContext): TickResult {
  const result = emptyResult()
  const before = { x: player.x, z: player.z, anim: player.anim }

  if (player.path.length > 0) {
    const [step, ...rest] = player.path
    player.x = step.x
    player.z = step.z
    player.path = rest
    player.anim = 'walk'
    if (rest.length === 0 && player.pendingInteract) startInteract(player, ctx, result)
    if (rest.length === 0 && player.combat) stepCombat(player, ctx, result)
  } else if (player.pendingInteract) {
    startInteract(player, ctx, result)
    if (player.combat) stepCombat(player, ctx, result)
    else if (player.mining) tickMining(player, ctx, result)
    else if (!result.deposit) player.anim = 'idle'
  } else if (player.combat) {
    stepCombat(player, ctx, result)
  } else if (player.mining) {
    tickMining(player, ctx, result)
  } else {
    player.anim = 'idle'
  }

  result.entChanged = player.x !== before.x || player.z !== before.z || player.anim !== before.anim
  return result
}

export function toEntityDiff(player: TickPlayer): EntityDiff {
  return { id: player.charId, kind: 'player', x: player.x, z: player.z, anim: player.anim, name: player.name }
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
