import { describe, expect, it } from 'vitest'
import { npcsFromZone, tickNpc, toNpcDiff, type NpcState } from '../server/npc'
import { emptyResult, type TickContext } from '../server/tick'

const WANDER = { x: 4, z: 4, w: 4, h: 4 } // tiles 4..7 in each axis
// All-walkable 16x16 collision.
const COLLISION = Array.from({ length: 16 }, () => '.'.repeat(16))

function makeBull(overrides: Partial<NpcState> = {}): NpcState {
  const npc = npcsFromZone([{ id: 'bull_1', monsterId: 'pasture_bull', x: 5, z: 5, wander: WANDER }]).get('bull_1')!
  return { ...npc, ...overrides }
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

describe('out-of-combat heal', () => {
  it('an abandoned bull (no attacker) heals to full and returns to idle', () => {
    const bull = makeBull({ state: 'combat', hp: 2, attackerId: null, lastCombatTick: 0 })
    tickNpc(bull, ctx(17), emptyResult())
    expect(bull.state).toBe('idle')
    expect(bull.hp).toBe(8)
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
})
