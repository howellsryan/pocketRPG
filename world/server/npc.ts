// NPC state + pure wander/respawn stepping. Movement animation is DERIVED on the
// client from position change (entities.ts), so the server only ever tags an npc
// 'idle' or (on death) 'die' — no explicit walk anim needed.
import monstersData from '../../src/data/monsters.json'
import type { EntityDiff } from '../shared/protocol'
import type { ZoneNpcDef } from '../shared/zone'
import type { TickContext, TickResult } from './tick'

type Monsters = Record<string, { name?: string; hitpoints?: number }>

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
  anim: 'idle' | 'die' | 'attack'
  /** Retaliation target: the one player whose combat session applies this npc's
   * attacks. First attacker claims it; released on leave/death/disconnect and
   * re-claimed by a surviving attacker the next tick. */
  attackerId: string | null
  lastCombatTick: number
  /** Damage per attacker for loot attribution; `tick` = when that total last
   * increased (tie-break: first to reach the total). */
  damageByChar: Map<string, { dmg: number; tick: number }>
}

const WANDER_MIN_TICKS = 5
const WANDER_MAX_TICKS = 13
const OUT_OF_COMBAT_HEAL_TICKS = 17

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

export function npcsFromZone(npcs: ZoneNpcDef[]): Map<string, NpcState> {
  const map = new Map<string, NpcState>()
  for (const def of npcs) {
    const maxHp = (monstersData as Monsters)[def.monsterId]?.hitpoints ?? 1
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

/** Advances one npc: respawn timer, out-of-combat heal, or wander. Mutates the
 * npc and records changes/removals/respawn on the result. */
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
      result.npcChanged.push(npc.id)
    }
    return
  }

  if (npc.state === 'combat') {
    if (!npc.attackerId && ctx.tick - npc.lastCombatTick >= OUT_OF_COMBAT_HEAL_TICKS) {
      npc.state = 'idle'
      npc.hp = npc.maxHp
      npc.damageByChar.clear()
      result.npcChanged.push(npc.id)
    }
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
  return diff
}
