// NPC state + pure wander/respawn stepping. Movement animation is DERIVED on the
// client from position change (entities.ts), so the server only ever tags an npc
// 'idle' or (on death) 'die' — no explicit walk anim needed.
import monstersData from '../../src/data/monsters.json'
import type { EntityDiff } from '../shared/protocol'
import type { ZoneNpcDef } from '../shared/zone'
import { monsterAttackRange, withinRangeAndSight, type TickContext, type TickResult } from './tick'
import { reachAgainst } from '../shared/monsterSize'
import type { Tile } from './pathfind'
import { isRoomWideAttacker, advanceRoomWideAttackTimer } from '../../src/engine/roomWideAttacks.js'
import { getAddSpec } from '../../src/engine/bossAdds.js'

type Monsters = Record<string, { name?: string; hitpoints?: number; boss?: boolean; attackSpeed?: number; roomWideAttacks?: boolean }>

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
  /** Shared attack clock, for an npc whose swings are resolved inside MORE THAN
   * ONE combat session (usesSharedClock). Each player runs their own session, so
   * a per-session timer would swing once per player instead of once per npc; the
   * clock therefore belongs to the npc and is ticked once a tick (tickNpc, or
   * stepMinions for a minion) before any session reads it. Undefined for every
   * other monster, which keeps its per-session timer. */
  attackTimer?: number
  /** True on exactly the tick the clock above fires. */
  sharedSwing?: boolean
  /** Set on a SUMMONED minion: the npc that summoned it. Such an npc is removed
   * when it dies instead of respawning, and leaves the field with its summoner. */
  summonerId?: string
  /** Set on a SUMMONER: the id of its live minion, or null when it has none. */
  minionId?: string | null
  /** Ticks until this summoner's next minion appears. Null while one is alive,
   * and while the summoner is out of combat — a boss only summons mid-fight. */
  summonCountdown?: number | null
  /** Damage per attacker for loot attribution; `tick` = when that total last
   * increased (tie-break: first to reach the total). */
  damageByChar: Map<string, { dmg: number; tick: number }>
  /** Cached A* chase route toward its attacker and the target tile it was
   * planned for. Recomputed when the target moves or the route runs out — so the
   * npc rounds obstacles instead of wedging on them (the old greedy step). */
  chasePath: Tile[]
  chaseGoal: { x: number; z: number } | null
  /** Tiles within which this npc aggresses idle passers-by (0 = passive). */
  /** Serialized key of the last {e:'threat'} broadcast for this npc, so the
   * damage-contribution readout (item 11) only re-sends on an actual change. */
  lastThreatSent: string | null
}

export type ThreatContributor = { charId: string; name: string; dmg: number }

/** Damage-contribution snapshot for an npc's current fight, sorted highest
 * first — makes the top-damage loot rule (topDamageContributor) legible mid-fight
 * (item 11). A contributor who's since disconnected has no name to show and is
 * dropped from the readout (their damage total still counts for loot). */
export function threatContributors(npc: NpcState, playerNames: Map<string, string>): ThreatContributor[] {
  const out: ThreatContributor[] = []
  for (const [charId, { dmg }] of npc.damageByChar) {
    const name = playerNames.get(charId)
    if (name) out.push({ charId, name, dmg })
  }
  out.sort((a, b) => b.dmg - a.dmg)
  return out
}

/** Stable string key for a contributor snapshot, to gate the broadcast on an
 * actual change (mirrors emitSpecIfChanged/emitPrayerIfChanged's last-sent gate). */
export function threatKey(contributors: ThreatContributor[]): string {
  return contributors.map((c) => `${c.charId}:${c.dmg}`).join('|')
}

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
  const inReach = engaged.filter((p) => withinRangeAndSight(npc, p, reachAgainst(npc.monsterId, range), collision))
  const pool = inReach.length > 0 ? inReach : engaged
  const threat = (charId: string): number => npc.damageByChar.get(charId)?.dmg ?? 0
  let best = pool.find((p) => p.charId === npc.attackerId) ?? pool[0]
  for (const p of pool) if (threat(p.charId) > threat(best.charId)) best = p
  npc.attackerId = best.charId
}

/**
 * Whether a player whose own fight is against `fightingNpcId` counts as engaged
 * with this npc, for retaliation and for staying in combat.
 *
 * A boss and its minion are ONE encounter, so fighting either is fighting both,
 * and each answer fixes a different failure:
 *
 * - the summoner, because turning on the sentinel emptied its engaged list — it
 *   released its attacker, healed back to full and dropped out of combat, taking
 *   the sentinel with it, while the player still stood in front of it;
 * - the minion, because otherwise it claims nobody, and a melee sentinel that
 *   never picks a target never walks anywhere: it stands at the boss's shoulder
 *   swinging at a player one tile beyond its reach.
 */
export function countsAsEngaged(npc: NpcState, fightingNpcId: string | undefined): boolean {
  if (!fightingNpcId) return false
  if (fightingNpcId === npc.id) return true
  return fightingNpcId === npc.minionId || fightingNpcId === npc.summonerId
}

/** A fresh npc record at full health. Shared by the zone's authored spawns and
 * by minions summoned mid-fight (minions.ts), so a summoned npc is the same
 * kind of thing as a placed one and every other pass handles it unchanged. */
export function makeNpc(def: ZoneNpcDef): NpcState {
  const monster = (monstersData as Monsters)[def.monsterId]
  const maxHp = monster?.hitpoints ?? 1
  return {
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
    lastThreatSent: null,
  }
}

export function npcsFromZone(npcs: ZoneNpcDef[]): Map<string, NpcState> {
  const map = new Map<string, NpcState>()
  for (const def of npcs) map.set(def.id, makeNpc(def))
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
/**
 * True when this npc's swings are resolved in more than one player's session, so
 * its attack timer has to live on the npc rather than in any of them. Three
 * kinds qualify, all for the same reason:
 *
 * - a room-wide attacker, which swings at everyone present;
 * - a SUMMONER, whose swing also has to reach a player who has turned to fight
 *   its minion (combat.ts mirrorPairedAttacker);
 * - a summoned MINION, whose swing reaches everyone fighting its summoner.
 *
 * Derived from the data, never from whether `sharedSwing` happens to be set: a
 * stale flag left on an ordinary monster would pin its session to a clock
 * nothing advances, and it would never attack again.
 */
export function usesSharedClock(npc: NpcState): boolean {
  if (npc.summonerId) return true
  const monster = (monstersData as Monsters)[npc.monsterId]
  return isRoomWideAttacker(monster) || !!getAddSpec(monster)
}

/** Advances that clock and records whether it swings this tick, for the player
 * sessions that run after every npc. */
export function advanceSharedSwing(npc: NpcState): void {
  if (!usesSharedClock(npc)) return
  // The clock's speed comes from the monster data, not the npc record — the
  // helper's own default (4) would slow Zaryth's 3-tick cycle.
  const clock = { attackSpeed: (monstersData as Monsters)[npc.monsterId]?.attackSpeed, attackTimer: npc.attackTimer }
  npc.sharedSwing = advanceRoomWideAttackTimer(clock)
  npc.attackTimer = clock.attackTimer
}

export function tickNpc(npc: NpcState, ctx: TickContext, result: TickResult): void {
  if (npc.state === 'dead') {
    npc.sharedSwing = false
    if (npc.removeAtTick && ctx.tick === npc.removeAtTick) result.npcRemoved.push(npc.id)
    // A summoned minion is not a fixture of the zone: it leaves the field for
    // good and its summoner rolls a replacement (stepMinions), so it must never
    // respawn on the spot the way an authored spawn does.
    if (npc.summonerId) return
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
    // Before the early returns below: an npc on a shared clock keeps swinging at
    // everyone it reaches even on a tick it is chasing, out of reach, or has no
    // claimed attacker, exactly as it would against the one player it faced.
    advanceSharedSwing(npc)
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
    if (!target || withinRangeAndSight(npc, target, reachAgainst(npc.monsterId, monsterAttackRange(npc.monsterId)), ctx.collision ?? [])) return
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
