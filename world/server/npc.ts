// NPC state + pure wander/respawn stepping. Movement animation is DERIVED on the
// client from position change (entities.ts), so the server only ever tags an npc
// 'idle' or (on death) 'die' — no explicit walk anim needed.
import monstersData from '../../src/data/monsters.json'
import type { EntityDiff } from '../shared/protocol'
import type { ZoneNpcDef } from '../shared/zone'
import { monsterAttackRange, withinRangeAndSight, type TickContext, type TickResult } from './tick'
import { hasLineOfSight } from './los'
import type { Tile } from './pathfind'

type Monsters = Record<string, { name?: string; hitpoints?: number; boss?: boolean }>

export type NpcState = {
  id: string
  monsterId: string
  x: number
  z: number
  hp: number
  maxHp: number
  state: 'idle' | 'combat' | 'dead'
  home: { x: number; z: number }
  wander: { x: number; z: number; w: number; h: number }
  wanderCooldown: number
  respawnAtTick: number
  removeAtTick: number
  anim: 'idle' | 'die' | 'attack' | 'attack_ranged' | 'attack_magic'
  /** Retaliation target: the one player whose combat session applies this npc's
   * attacks. First attacker claims it; released on leave/death/disconnect and
   * re-claimed by a surviving attacker the next tick. */
  attackerId: string | null
  lastCombatTick: number
  /** Damage per attacker for loot attribution; `tick` = when that total last
   * increased (tie-break: first to reach the total). */
  damageByChar: Map<string, { dmg: number; tick: number }>
  /** Cached A* chase route toward the aggro target and the target tile it was
   * planned for. Recomputed when the target moves or the route runs out — so the
   * npc rounds obstacles instead of wedging on them (the old greedy step). */
  chasePath: Tile[]
  chaseGoal: { x: number; z: number } | null
  /** Tiles within which this npc aggresses idle passers-by (0 = passive). */
  aggroRadius: number
}

/** Default aggression radius for a boss when the zone doesn't specify one — boss
 * rooms shouldn't be walkable-through unbothered (item 9). */
export const BOSS_DEFAULT_AGGRO_RADIUS = 6

const WANDER_MIN_TICKS = 5
const WANDER_MAX_TICKS = 13
const OUT_OF_COMBAT_HEAL_TICKS = 17
/** How far (Chebyshev tiles from home) an aggressive npc will chase its
 * attacker before giving up and returning to its post. */
const PURSUE_LEASH_TILES = 10

export function recordDamage(npc: NpcState, charId: string, dmg: number, tick: number): void {
  if (dmg <= 0) return
  const entry = npc.damageByChar.get(charId)
  if (entry) {
    entry.dmg += dmg
    entry.tick = tick
  } else {
    npc.damageByChar.set(charId, { dmg, tick })
  }
}

/** Loot owner on a kill: most total damage; equal totals → whoever reached the
 * total first (smaller last-increase tick). */
export function topDamageContributor(npc: NpcState): string | null {
  let best: { charId: string; dmg: number; tick: number } | null = null
  for (const [charId, { dmg, tick }] of npc.damageByChar) {
    if (!best || dmg > best.dmg || (dmg === best.dmg && tick < best.tick)) {
      best = { charId, dmg, tick }
    }
  }
  return best?.charId ?? null
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/** Retargets an in-combat npc onto the top-damage (threat) player it can actually
 * reach, so a boss focuses the biggest threat in a group fight instead of sticking
 * to whoever clicked first (item 9 — every engaged player's session already rolls
 * this npc's swings; only the `attackerId` target's land, so this is what makes
 * group bossing hit the right person). Prefers reachable engaged players (in
 * range + line of sight); falls back to the full engaged set so it keeps a chase
 * target when everyone has kited out of reach. The current attacker is kept on a
 * threat tie, so the target indicator doesn't flicker between equal contributors. */
export function reselectAttacker(
  npc: NpcState,
  engaged: { charId: string; x: number; z: number }[],
  collision: string[],
): void {
  if (npc.state !== 'combat') return
  if (engaged.length === 0) {
    npc.attackerId = null
    return
  }
  const range = monsterAttackRange(npc.monsterId)
  const inReach = engaged.filter((p) => withinRangeAndSight(npc, p, range, collision))
  const pool = inReach.length > 0 ? inReach : engaged
  const threat = (charId: string): number => npc.damageByChar.get(charId)?.dmg ?? 0
  let best = pool.find((p) => p.charId === npc.attackerId) ?? pool[0]
  for (const p of pool) if (threat(p.charId) > threat(best.charId)) best = p
  npc.attackerId = best.charId
}

export function npcsFromZone(npcs: ZoneNpcDef[]): Map<string, NpcState> {
  const map = new Map<string, NpcState>()
  for (const def of npcs) {
    const monster = (monstersData as Monsters)[def.monsterId]
    const maxHp = monster?.hitpoints ?? 1
    const aggroRadius = def.aggroRadius ?? (monster?.boss ? BOSS_DEFAULT_AGGRO_RADIUS : 0)
    map.set(def.id, {
      id: def.id,
      monsterId: def.monsterId,
      x: def.x,
      z: def.z,
      hp: maxHp,
      maxHp,
      state: 'idle',
      home: { x: def.x, z: def.z },
      wander: def.wander,
      wanderCooldown: randInt(WANDER_MIN_TICKS, WANDER_MAX_TICKS),
      respawnAtTick: 0,
      removeAtTick: 0,
      anim: 'idle',
      attackerId: null,
      lastCombatTick: 0,
      damageByChar: new Map(),
      chasePath: [],
      chaseGoal: null,
      aggroRadius,
    })
  }
  return map
}

function inRect(npc: NpcState, x: number, z: number): boolean {
  const r = npc.wander
  return x >= r.x && x < r.x + r.w && z >= r.z && z < r.z + r.h
}

function walkable(collision: string[], x: number, z: number): boolean {
  return collision[z]?.[x] === '.'
}

/** Nearest player an idle aggressive npc should pull into combat: within its
 * aggro radius (Chebyshev), with line of sight, and not already fighting
 * something. Returns the charId or null. The DO force-starts that player's combat
 * against the npc — monster swings are generated by the engaged player's engine
 * session, so aggression has to engage the player, not just flag the npc (item 9). */
export function pickAggroTarget(
  npc: NpcState,
  players: { charId: string; x: number; z: number; inCombat: boolean }[],
  collision: string[],
): string | null {
  if (npc.state !== 'idle' || npc.aggroRadius <= 0) return null
  let best: string | null = null
  let bestDist = Infinity
  for (const p of players) {
    if (p.inCombat) continue
    const d = chebyshev(npc, p)
    if (d === 0 || d > npc.aggroRadius) continue
    if (!hasLineOfSight(collision, npc, p)) continue
    if (d < bestDist) {
      bestDist = d
      best = p.charId
    }
  }
  return best
}

/** One idle wander step: after a random cooldown, pick a random adjacent tile
 * that stays inside the wander rect and is walkable, else stand still. */
function wander(npc: NpcState, collision: string[]): boolean {
  npc.wanderCooldown -= 1
  if (npc.wanderCooldown > 0) return false
  npc.wanderCooldown = randInt(WANDER_MIN_TICKS, WANDER_MAX_TICKS)
  const dx = randInt(-1, 1)
  const dz = randInt(-1, 1)
  if (dx === 0 && dz === 0) return false
  const nx = npc.x + dx
  const nz = npc.z + dz
  if (!inRect(npc, nx, nz) || !walkable(collision, nx, nz)) return false
  npc.x = nx
  npc.z = nz
  return true
}

function chebyshev(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z))
}

/** One A* step toward the aggro target. Plans a route to a tile adjacent to the
 * target (via the shared pathfinder) and advances one tile along it, replanning
 * when the target has moved or the cached route is spent. Unlike the old greedy
 * step this rounds walls and pillars instead of wedging against them — the core
 * of the safespot fix, since a boss that can path around cover will always close
 * to melee range. Returns whether the npc moved this tick. */
function chaseTowards(npc: NpcState, target: { x: number; z: number }, ctx: TickContext): boolean {
  const goal = { x: target.x, z: target.z }
  const stale =
    npc.chasePath.length === 0 ||
    !npc.chaseGoal ||
    npc.chaseGoal.x !== goal.x ||
    npc.chaseGoal.z !== goal.z
  if (stale) {
    const path = ctx.pathAdjacent?.({ x: npc.x, z: npc.z }, goal) ?? null
    // pathAdjacent returns [start, ...steps]; drop the tile we're already on.
    npc.chasePath = path && path.length > 1 ? path.slice(1) : []
    npc.chaseGoal = goal
  }
  const next = npc.chasePath.shift()
  if (!next) return false
  // Defensive: never step onto a tile that isn't walkable anymore.
  if (!walkable(ctx.collision ?? [], next.x, next.z)) {
    npc.chasePath = []
    return false
  }
  npc.x = next.x
  npc.z = next.z
  return true
}

function clearChase(npc: NpcState): void {
  npc.chasePath = []
  npc.chaseGoal = null
}

/** Gives up the chase: same reset as an out-of-combat heal (return to full,
 * forget contributions) plus a snap home, so a leash-broken npc never gets
 * stranded outside the wander rect it polices once idle again. */
function giveUpPursuit(npc: NpcState): void {
  npc.attackerId = null
  npc.state = 'idle'
  npc.anim = 'idle'
  npc.hp = npc.maxHp
  npc.x = npc.home.x
  npc.z = npc.home.z
  npc.wanderCooldown = randInt(WANDER_MIN_TICKS, WANDER_MAX_TICKS)
  npc.damageByChar.clear()
  clearChase(npc)
}

/** Advances one npc: respawn timer, out-of-combat heal/pursuit, or wander.
 * Mutates the npc and records changes/removals/respawn on the result. */
export function tickNpc(npc: NpcState, ctx: TickContext, result: TickResult): void {
  if (npc.state === 'dead') {
    if (npc.removeAtTick && ctx.tick === npc.removeAtTick) result.npcRemoved.push(npc.id)
    if (ctx.tick >= npc.respawnAtTick) {
      npc.state = 'idle'
      npc.anim = 'idle'
      npc.hp = npc.maxHp
      npc.x = npc.home.x
      npc.z = npc.home.z
      npc.wanderCooldown = randInt(WANDER_MIN_TICKS, WANDER_MAX_TICKS)
      clearChase(npc)
      result.npcChanged.push(npc.id)
    }
    return
  }

  if (npc.state === 'combat') {
    if (!npc.attackerId) {
      if (ctx.tick - npc.lastCombatTick >= OUT_OF_COMBAT_HEAL_TICKS) {
        npc.state = 'idle'
        npc.hp = npc.maxHp
        npc.damageByChar.clear()
        clearChase(npc)
        result.npcChanged.push(npc.id)
      }
      return
    }
    // Aggro'd on an attacker: stand and fight while within ITS attack range AND
    // line of sight (an active engine session drives this tick-by-tick — melee at
    // 1 tile, ranged/magic from afar with a clear line), otherwise chase them
    // down to regain reach+sight — leashed to a radius around home so it can't
    // trek across the whole zone.
    const target = ctx.players?.get(npc.attackerId)
    if (!target || withinRangeAndSight(npc, target, monsterAttackRange(npc.monsterId), ctx.collision ?? [])) return
    if (chebyshev(npc, npc.home) >= PURSUE_LEASH_TILES) {
      giveUpPursuit(npc)
      result.npcChanged.push(npc.id)
      return
    }
    if (chaseTowards(npc, target, ctx)) result.npcChanged.push(npc.id)
    return
  }

  if (wander(npc, ctx.collision ?? [])) result.npcChanged.push(npc.id)
}

export function toNpcDiff(npc: NpcState): EntityDiff {
  const name = (monstersData as Monsters)[npc.monsterId]?.name
  // hp/maxHp are always included (not combat-only): the client shows an HP bar
  // whenever hp < maxHp, so it needs the return-to-full value to hide the bar
  // after an out-of-combat heal — a combat-only field would leave it stale.
  const diff: EntityDiff = { id: npc.id, kind: 'npc', x: npc.x, z: npc.z, anim: npc.anim, monsterId: npc.monsterId, hp: npc.hp, maxHp: npc.maxHp }
  if (name) diff.name = name
  if (npc.state === 'combat' && npc.attackerId) diff.targetId = npc.attackerId
  return diff
}
