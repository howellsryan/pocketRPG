// Item 9 (P1): a boss must focus the top-threat player it can reach in a group
// fight (not the first attacker), and bosses respawn far slower than trash so a
// world boss can't be farmed on the regular timer.
import { describe, expect, it } from 'vitest'
import { BOSS_DEFAULT_AGGRO_RADIUS, npcsFromZone, pickAggroTarget, recordDamage, reselectAttacker, type NpcState } from '../server/npc'
import { respawnTicksFor } from '../server/combat'

const OPEN = Array.from({ length: 12 }, () => '.'.repeat(12))

function bull(x = 5, z = 5): NpcState {
  const npc = npcsFromZone([{ id: 'bull_1', monsterId: 'pasture_bull', x, z, wander: { x, z, w: 1, h: 1 } }]).get('bull_1')!
  npc.state = 'combat'
  return npc
}

describe('reselectAttacker (threat targeting)', () => {
  it('clears the target when nobody is engaged', () => {
    const b = bull()
    b.attackerId = '1'
    reselectAttacker(b, [], OPEN)
    expect(b.attackerId).toBeNull()
  })

  it('targets the sole engaged player', () => {
    const b = bull()
    reselectAttacker(b, [{ charId: '7', x: 5, z: 6 }], OPEN)
    expect(b.attackerId).toBe('7')
  })

  it('focuses the top-damage reachable player in a group', () => {
    const b = bull()
    recordDamage(b, '1', 10, 1)
    recordDamage(b, '2', 40, 2)
    reselectAttacker(b, [{ charId: '1', x: 5, z: 6 }, { charId: '2', x: 6, z: 5 }], OPEN)
    expect(b.attackerId).toBe('2')
  })

  it('keeps the current target on a threat tie so the indicator does not flicker', () => {
    const b = bull()
    b.attackerId = '1'
    recordDamage(b, '1', 20, 1)
    recordDamage(b, '2', 20, 1)
    reselectAttacker(b, [{ charId: '1', x: 5, z: 6 }, { charId: '2', x: 6, z: 5 }], OPEN)
    expect(b.attackerId).toBe('1')
  })

  it('prefers a reachable player over a higher-threat one that has kited out of reach', () => {
    const b = bull(5, 5)
    recordDamage(b, 'far', 100, 1) // biggest threat, but 6 tiles away (melee reach is 1)
    recordDamage(b, 'near', 10, 2)
    reselectAttacker(b, [{ charId: 'far', x: 5, z: 11 }, { charId: 'near', x: 5, z: 6 }], OPEN)
    expect(b.attackerId).toBe('near')
  })
})

function grondar(x = 5, z = 5, aggroRadius?: number): NpcState {
  const def = { id: 'g1', monsterId: 'warlord_grondar', x, z, wander: { x, z, w: 1, h: 1 }, ...(aggroRadius === undefined ? {} : { aggroRadius }) }
  return npcsFromZone([def]).get('g1')!
}

describe('aggression radius seeding', () => {
  it('makes bosses aggressive by default', () => {
    expect(grondar().aggroRadius).toBe(BOSS_DEFAULT_AGGRO_RADIUS)
  })
  it('leaves regular monsters passive by default', () => {
    expect(npcsFromZone([{ id: 'b', monsterId: 'pasture_bull', x: 5, z: 5, wander: { x: 5, z: 5, w: 1, h: 1 } }]).get('b')!.aggroRadius).toBe(0)
  })
  it('honours an explicit per-npc aggro radius', () => {
    expect(grondar(5, 5, 3).aggroRadius).toBe(3)
    expect(grondar(5, 5, 0).aggroRadius).toBe(0)
  })
})

describe('pickAggroTarget', () => {
  it('pulls the nearest unengaged player within radius and sight', () => {
    const g = grondar(5, 5)
    const target = pickAggroTarget(g, [
      { charId: 'near', x: 5, z: 7, inCombat: false },
      { charId: 'far', x: 5, z: 9, inCombat: false },
    ], OPEN)
    expect(target).toBe('near')
  })
  it('ignores players already in combat', () => {
    const g = grondar(5, 5)
    expect(pickAggroTarget(g, [{ charId: 'busy', x: 5, z: 6, inCombat: true }], OPEN)).toBeNull()
  })
  it('ignores players beyond the aggro radius', () => {
    const g = grondar(5, 5, 3)
    expect(pickAggroTarget(g, [{ charId: 'p', x: 5, z: 10, inCombat: false }], OPEN)).toBeNull()
  })
  it('does not aggro through a wall (no line of sight)', () => {
    const walled = OPEN.map((row, z) => (z === 6 ? '############'.slice(0, 12) : row))
    const g = grondar(5, 5)
    expect(pickAggroTarget(g, [{ charId: 'p', x: 5, z: 8, inCombat: false }], walled)).toBeNull()
  })
  it('is inert for a passive npc', () => {
    const bull = npcsFromZone([{ id: 'b', monsterId: 'pasture_bull', x: 5, z: 5, wander: { x: 5, z: 5, w: 1, h: 1 } }]).get('b')!
    expect(pickAggroTarget(bull, [{ charId: 'p', x: 5, z: 6, inCombat: false }], OPEN)).toBeNull()
  })
})

describe('respawnTicksFor', () => {
  it('holds a boss far longer than a regular monster', () => {
    expect(respawnTicksFor('warlord_grondar')).toBe(100)
    expect(respawnTicksFor('pasture_bull')).toBe(25)
    expect(respawnTicksFor('warlord_grondar')).toBeGreaterThan(respawnTicksFor('pasture_bull'))
  })
})
