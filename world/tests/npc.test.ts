import { describe, expect, it } from 'vitest'
import { npcsFromZone, recordDamage, tickNpc, toNpcDiff, topDamageContributor, type NpcState } from '../server/npc'
import { emptyResult, type TickContext } from '../server/tick'
import { findPathAdjacent } from '../server/pathfind'

const WANDER = { x: 4, z: 4, w: 4, h: 4 } // tiles 4..7 in each axis
// All-walkable 16x16 collision.
const COLLISION = Array.from({ length: 16 }, () => '.'.repeat(16))

function makeBull(overrides: Partial<NpcState> = {}): NpcState {
  const npc = npcsFromZone([{ id: 'bull_1', monsterId: 'pasture_bull', x: 5, z: 5, wander: WANDER }]).get('bull_1')!
  return { ...npc, ...overrides }
}

/** A chase ctx wired with the real A* pathfinder over `collision`, mirroring how
 * WorldZone builds it (npcs chase via ctx.pathAdjacent now, not a greedy step). */
function chaseCtx(tick: number, players: Map<string, { x: number; z: number }>, collision = COLLISION): TickContext {
  return { tick, rocks: new Map(), npcs: new Map(), collision, players, pathAdjacent: (from, to) => findPathAdjacent(collision, from, to) }
}

function ctx(tick: number): TickContext {
  return { tick, rocks: new Map(), npcs: new Map(), collision: COLLISION }
}

describe('npcsFromZone', () => {
  it('seeds hp from the monster hitpoints and starts idle at home', () => {
    const bull = makeBull()
    expect(bull.maxHp).toBe(8)
    expect(bull.hp).toBe(8)
    expect(bull.state).toBe('idle')
    expect(bull.home).toEqual({ x: 5, z: 5 })
  })
})

describe('wander', () => {
  it('never leaves the wander rect over many ticks', () => {
    const bull = makeBull()
    for (let t = 1; t <= 500; t++) {
      tickNpc(bull, ctx(t), emptyResult())
      expect(bull.x).toBeGreaterThanOrEqual(WANDER.x)
      expect(bull.x).toBeLessThan(WANDER.x + WANDER.w)
      expect(bull.z).toBeGreaterThanOrEqual(WANDER.z)
      expect(bull.z).toBeLessThan(WANDER.z + WANDER.h)
    }
  })

  it('does not step onto a blocked tile', () => {
    const collision = COLLISION.map((row, z) => (z === 6 ? '.'.repeat(5) + '#' + '.'.repeat(10) : row))
    const bull = makeBull({ x: 5, z: 5, wanderCooldown: 1 })
    for (let t = 1; t <= 300; t++) {
      tickNpc(bull, { tick: t, rocks: new Map(), npcs: new Map(), collision }, emptyResult())
      expect(collision[bull.z][bull.x]).toBe('.')
    }
  })
})

describe('death + respawn', () => {
  it('removes at removeAtTick and respawns at home with full hp', () => {
    const bull = makeBull({ state: 'dead', hp: 0, x: 7, z: 7, respawnAtTick: 30, removeAtTick: 13 })

    const removeRes = emptyResult()
    tickNpc(bull, ctx(13), removeRes)
    expect(removeRes.npcRemoved).toContain('bull_1')

    const respawnRes = emptyResult()
    tickNpc(bull, ctx(30), respawnRes)
    expect(respawnRes.npcChanged).toContain('bull_1')
    expect(bull.state).toBe('idle')
    expect(bull.hp).toBe(8)
    expect(bull).toMatchObject({ x: 5, z: 5 })
  })
})

describe('damage attribution', () => {
  it('accumulates damage per attacker; zero-damage hits contribute nothing', () => {
    const bull = makeBull()
    recordDamage(bull, '1', 3, 10)
    recordDamage(bull, '1', 2, 12)
    recordDamage(bull, '2', 4, 11)
    recordDamage(bull, '2', 0, 13)
    expect(bull.damageByChar.get('1')).toEqual({ dmg: 5, tick: 12 })
    expect(bull.damageByChar.get('2')).toEqual({ dmg: 4, tick: 11 })
    expect(topDamageContributor(bull)).toBe('1')
  })

  it('breaks a damage tie in favour of whoever reached the total first', () => {
    const bull = makeBull()
    recordDamage(bull, '2', 4, 11) // reached 4 at tick 11
    recordDamage(bull, '1', 4, 14) // reached 4 at tick 14
    expect(topDamageContributor(bull)).toBe('2')
  })

  it('returns null with no recorded damage', () => {
    expect(topDamageContributor(makeBull())).toBeNull()
  })
})

describe('aggro pursuit', () => {
  it('chases its attacker one tile per tick when they run out of range', () => {
    const bull = makeBull({ state: 'combat', attackerId: 'p1', lastCombatTick: 0 })
    const players = new Map([['p1', { x: 9, z: 5 }]])
    const before = { x: bull.x, z: bull.z }
    tickNpc(bull, chaseCtx(1, players), emptyResult())
    expect(bull.x).toBeGreaterThan(before.x)
    expect(bull.z).toBe(before.z)
  })

  it('rounds an obstacle instead of wedging on it (A* chase, not greedy)', () => {
    // A vertical wall at x=8 (z rows 3..7) sits directly between the bull at
    // (7,5) and its attacker at (9,5). The old greedy step wedged against the
    // wall forever; the A* chase must route around an end of it and close in.
    const collision = COLLISION.map((row, z) =>
      z >= 3 && z <= 7 ? row.slice(0, 8) + '#' + row.slice(9) : row
    )
    const bull = makeBull({ x: 7, z: 5, home: { x: 7, z: 5 }, state: 'combat', attackerId: 'p1', lastCombatTick: 0 })
    const players = new Map([['p1', { x: 9, z: 5 }]])
    let reached = false
    for (let t = 1; t <= 40 && !reached; t++) {
      tickNpc(bull, chaseCtx(t, players, collision), emptyResult())
      expect(collision[bull.z][bull.x]).toBe('.') // never stands on the wall
      if (Math.max(Math.abs(bull.x - 9), Math.abs(bull.z - 5)) <= 1) reached = true
    }
    expect(reached).toBe(true)
  })

  it('stands still once adjacent to its attacker again', () => {
    const bull = makeBull({ x: 5, z: 5, state: 'combat', attackerId: 'p1', lastCombatTick: 0 })
    const players = new Map([['p1', { x: 6, z: 5 }]])
    tickNpc(bull, chaseCtx(1, players), emptyResult())
    expect(bull).toMatchObject({ x: 5, z: 5 })
  })

  it('gives up and snaps home once the chase clears the leash radius', () => {
    // Home is (5,5); place the bull 10 tiles out (at the leash boundary) still
    // chasing an attacker even further away.
    const bull = makeBull({ x: 15, z: 5, state: 'combat', attackerId: 'p1', lastCombatTick: 0 })
    recordDamage(bull, 'p1', 3, 1)
    const players = new Map([['p1', { x: 20, z: 5 }]])
    const result = emptyResult()
    tickNpc(bull, chaseCtx(1, players), result)
    expect(bull.attackerId).toBeNull()
    expect(bull.state).toBe('idle')
    expect(bull).toMatchObject({ x: 5, z: 5, hp: 8 })
    expect(bull.damageByChar.size).toBe(0)
    expect(result.npcChanged).toContain('bull_1')
  })

  it('does not move while its attacker is missing from the players snapshot', () => {
    const bull = makeBull({ state: 'combat', attackerId: 'p1', lastCombatTick: 0 })
    const before = { x: bull.x, z: bull.z }
    tickNpc(bull, chaseCtx(1, new Map()), emptyResult())
    expect(bull).toMatchObject(before)
  })
})

describe('out-of-combat heal', () => {
  it('an abandoned bull (no attacker) heals to full and returns to idle', () => {
    const bull = makeBull({ state: 'combat', hp: 2, attackerId: null, lastCombatTick: 0 })
    recordDamage(bull, '1', 6, 5)
    tickNpc(bull, ctx(17), emptyResult())
    expect(bull.state).toBe('idle')
    expect(bull.hp).toBe(8)
    // A healed bull forgets old contributions — the next kill starts clean.
    expect(bull.damageByChar.size).toBe(0)
  })

  it('keeps fighting while an attacker is engaged', () => {
    const bull = makeBull({ state: 'combat', hp: 2, attackerId: '1', lastCombatTick: 0 })
    tickNpc(bull, ctx(50), emptyResult())
    expect(bull.state).toBe('combat')
    expect(bull.hp).toBe(2)
  })
})

describe('toNpcDiff', () => {
  it('always carries hp/maxHp so the client can hide the bar at full', () => {
    expect(toNpcDiff(makeBull({ state: 'idle' })).hp).toBe(8)
    const inCombat = toNpcDiff(makeBull({ state: 'combat', hp: 3 }))
    expect(inCombat.hp).toBe(3)
    expect(inCombat.maxHp).toBe(8)
    expect(inCombat.name).toBe('Pasture Bull')
  })

  it('carries targetId while actively fighting an attacker', () => {
    const inCombat = toNpcDiff(makeBull({ state: 'combat', attackerId: 'p1' }))
    expect(inCombat.targetId).toBe('p1')
  })

  it('omits targetId when idle, dead, or combat with no claimed attacker', () => {
    expect(toNpcDiff(makeBull({ state: 'idle' })).targetId).toBeUndefined()
    expect(toNpcDiff(makeBull({ state: 'dead', attackerId: 'p1' })).targetId).toBeUndefined()
    expect(toNpcDiff(makeBull({ state: 'combat', attackerId: null })).targetId).toBeUndefined()
  })
})
