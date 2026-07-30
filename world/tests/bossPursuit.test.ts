// No npc — boss, dragon or bull — is resettable by backing off. Before this,
// walking beyond an npc's reach ended the player's session (combat.ts), which
// emptied its engaged list, which released its attacker on the very next tick —
// so it stopped where it stood, healed to full 17 ticks later, and a boss took
// its sentinels with it. Clearing a boss's adds was therefore a treadmill you
// could step off for free, and trash you'd half-killed reset the instant you
// stepped back to eat.
//
// Bosses still get a longer leash than everything else (pursueLeashTiles, 24
// tiles vs 10) — that distinction is about how far an npc will travel from its
// post, tuned to a boss's much bigger lair, and is unrelated to whether it
// keeps its quarry at all.
//
// Drives the DO's real per-tick order: retarget, every npc, the minion pass.
import { describe, expect, it } from 'vitest'
import { npcsFromZone, reselectAttacker, tickNpc, type NpcState } from '../server/npc'
import { stepMinions } from '../server/minions'
import { findPathAdjacent } from '../server/pathfind'
import type { TickContext, TickResult } from '../server/tick'

const SIZE = 64
const COLLISION = Array.from({ length: SIZE }, () => '.'.repeat(SIZE))
const ZARYTH = 'zaryth_the_empty_lord'
const BULL = 'pasture_bull'
const DRAGON = 'green_dragon'

/** A 1×1 wander rect: this file measures where a chase leaves an npc, and idle
 * wandering afterwards would drift the answer by a tile. */
function npcAt(monsterId: string, x: number, z: number) {
  const npcs = npcsFromZone([{ id: 'n1', monsterId, x, z, wander: { x, z, w: 1, h: 1 } }])
  return { npcs, npc: npcs.get('n1')! }
}

function emptyResult(): TickResult {
  return { npcChanged: [], npcRemoved: [] } as unknown as TickResult
}

function ctx(tick: number, npcs: Map<string, NpcState>, players: Map<string, { x: number; z: number }>): TickContext {
  return {
    tick, rocks: new Map(), npcs, collision: COLLISION, players,
    pathAdjacent: (from, to) => findPathAdjacent(COLLISION, from, to),
  } as TickContext
}

/**
 * One zone tick with NOBODY engaged — the state a disengaged player leaves
 * behind (their session ended, so nothing counts as engaged with the npc) while
 * they are still standing in the zone.
 */
function tickDisengaged(npcs: Map<string, NpcState>, at: { x: number; z: number }, tick: number): void {
  const players = new Map([['1', at]])
  const c = ctx(tick, npcs, players)
  const result = emptyResult()
  for (const npc of npcs.values()) {
    if (npc.state !== 'combat') continue
    // Deliberately empty: countsAsEngaged reads the player's own combat session,
    // and a disengaged player has none — which is precisely the state that used
    // to release the npc.
    reselectAttacker(npc, [], COLLISION, players, npcs)
  }
  for (const npc of [...npcs.values()]) tickNpc(npc, c, result)
  stepMinions(c, result)
}

/** An npc mid-fight with this player, as startCombat leaves it. */
function engaged(npc: NpcState, charId = '1'): void {
  npc.state = 'combat'
  npc.attackerId = charId
  npc.lastCombatTick = 0
}

describe.each([
  ['a boss', ZARYTH, 19],
  ['ordinary trash', BULL, 8],
  ['a dragon', DRAGON, 8],
])('an npc keeps its quarry (%s)', (_label, monsterId, distanceWithinLeash) => {
  it('hunts a player who walked out of the fight instead of releasing them', () => {
    const { npcs, npc } = npcAt(monsterId, 20, 11)
    engaged(npc)
    npc.hp = 100

    for (let tick = 1; tick <= 40; tick++) tickDisengaged(npcs, { x: 20, z: 11 + distanceWithinLeash }, tick)

    expect(npc.attackerId).toBe('1')
    expect(npc.state).toBe('combat')
    // The out-of-combat heal is 17 ticks: it never came round, so the damage
    // done before the player backed off still stands.
    expect(npc.hp).toBe(100)
    // And it walked toward them rather than standing on its post.
    expect(npc.z).toBeGreaterThan(11)
  })

  it('lets go when that player leaves the zone', () => {
    const { npcs, npc } = npcAt(monsterId, 20, 11)
    engaged(npc)

    // Nobody in `present` — WorldZone.releaseAggro covers the explicit paths,
    // this covers the tick that follows.
    const players = new Map<string, { x: number; z: number }>()
    reselectAttacker(npc, [], COLLISION, players, npcs)

    expect(npc.attackerId).toBeNull()
  })
})

describe('ordinary monster leash', () => {
  it('gives up well short of the distance a boss will still chase', () => {
    const { npcs, npc } = npcAt(BULL, 20, 11)
    engaged(npc)
    npc.hp = 100

    // Far enough that the 10-tile trash leash breaks well before the boss's 24.
    for (let tick = 1; tick <= 60; tick++) tickDisengaged(npcs, { x: 20, z: 40 }, tick)

    expect(npc.attackerId).toBeNull()
    expect(npc.state).toBe('idle')
    expect(npc.hp).toBe(npc.maxHp)
    expect({ x: npc.x, z: npc.z }).toEqual({ x: 20, z: 11 })
  })
})

describe('boss leash', () => {
  it('chases well past the distance that stops an ordinary monster', () => {
    const { npcs, npc } = npcAt(ZARYTH, 20, 11)
    engaged(npc)

    // 15 tiles from home — beyond the 10-tile leash every non-boss npc keeps.
    for (let tick = 1; tick <= 30; tick++) tickDisengaged(npcs, { x: 20, z: 26 }, tick)

    expect(npc.attackerId).toBe('1')
    expect(Math.abs(npc.z - 11)).toBeGreaterThan(10)
  })

  it('still gives up — and resets honestly — once dragged clear of its lair', () => {
    const { npcs, npc } = npcAt(ZARYTH, 20, 11)
    engaged(npc)
    npc.hp = 100

    // Far enough that even the boss leash (24) breaks.
    for (let tick = 1; tick <= 120; tick++) tickDisengaged(npcs, { x: 20, z: 60 }, tick)

    expect(npc.attackerId).toBeNull()
    expect(npc.state).toBe('idle')
    expect(npc.hp).toBe(npc.maxHp)
    expect({ x: npc.x, z: npc.z }).toEqual({ x: 20, z: 11 })
  })

  it('gives up on a quarry it cannot path to, rather than staying in combat for good', () => {
    // A boss holds its target across a disengage, so a player standing
    // somewhere unreachable (across water, wrong side of a cliff) would leave it
    // in combat forever: never healing, stacking minions nobody is fighting.
    const walled = COLLISION.map((row, z) => (z === 20 ? '#'.repeat(SIZE) : row))
    const { npcs, npc } = npcAt(ZARYTH, 20, 11)
    engaged(npc)
    npc.hp = 100

    for (let tick = 1; tick <= 200; tick++) {
      const players = new Map([['1', { x: 20, z: 30 }]])
      const c = { tick, rocks: new Map(), npcs, collision: walled, players, pathAdjacent: (from: { x: number; z: number }, to: { x: number; z: number }) => findPathAdjacent(walled, from, to) } as TickContext
      reselectAttacker(npc, [], walled, players, npcs)
      for (const n of [...npcs.values()]) tickNpc(n, c, emptyResult())
    }

    expect(npc.attackerId).toBeNull()
    expect(npc.state).toBe('idle')
    expect(npc.hp).toBe(npc.maxHp)
  })

  it('keeps the sentinels on the field while the boss is still hunting', () => {
    const { npcs, npc } = npcAt(ZARYTH, 20, 11)
    engaged(npc)

    // Long enough for the first summon (8-12 boss attacks at 3 ticks each) plus
    // a long chase; the player stays inside the boss's leash the whole time.
    for (let tick = 1; tick <= 60; tick++) tickDisengaged(npcs, { x: 20, z: 24 }, tick)

    const minions = [...npcs.values()].filter((n) => n.summonerId === 'n1')
    expect(minions.length).toBeGreaterThan(0)
    // A minion has no leash of its own — measured from the tile it was summoned
    // onto it would give up the moment the boss out-ranged it and stand idle in
    // the middle of a live fight.
    for (const minion of minions) expect(minion.state).toBe('combat')
  })
})
