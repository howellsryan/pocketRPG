// Item 9 (P1): a boss must focus the top-threat player it can reach in a group
// fight (not the first attacker), and bosses respawn far slower than trash so a
// world boss can't be farmed on the regular timer.
import { describe, expect, it } from 'vitest'
import { npcsFromZone, recordDamage, reselectAttacker, threatContributors, threatKey, type NpcState } from '../server/npc'
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

function grondar(x = 5, z = 5): NpcState {
  return npcsFromZone([{ id: 'g1', monsterId: 'warlord_grondar', x, z, wander: { x, z, w: 1, h: 1 } }]).get('g1')!
}

describe('respawnTicksFor', () => {
  it('holds a boss far longer than a regular monster', () => {
    expect(respawnTicksFor('warlord_grondar')).toBe(100)
    expect(respawnTicksFor('pasture_bull')).toBe(25)
    expect(respawnTicksFor('warlord_grondar')).toBeGreaterThan(respawnTicksFor('pasture_bull'))
  })
})

// Item 11 (P1): damage-contribution readout — makes the top-damage loot rule
// legible mid-fight.
describe('threatContributors / threatKey', () => {
  it('sorts contributors by damage descending', () => {
    const g = grondar()
    recordDamage(g, '1', 10, 1)
    recordDamage(g, '2', 40, 2)
    recordDamage(g, '3', 25, 3)
    const names = new Map([['1', 'Alice'], ['2', 'Bob'], ['3', 'Cara']])
    expect(threatContributors(g, names)).toEqual([
      { charId: '2', name: 'Bob', dmg: 40 },
      { charId: '3', name: 'Cara', dmg: 25 },
      { charId: '1', name: 'Alice', dmg: 10 },
    ])
  })

  it('drops a contributor with no resolvable name (disconnected mid-fight)', () => {
    const g = grondar()
    recordDamage(g, '1', 10, 1)
    recordDamage(g, 'gone', 99, 2)
    expect(threatContributors(g, new Map([['1', 'Alice']]))).toEqual([{ charId: '1', name: 'Alice', dmg: 10 }])
  })

  it('threatKey changes when damage totals change and is stable when they do not', () => {
    const g = grondar()
    recordDamage(g, '1', 10, 1)
    const names = new Map([['1', 'Alice']])
    const key1 = threatKey(threatContributors(g, names))
    const key1Again = threatKey(threatContributors(g, names))
    expect(key1Again).toBe(key1)
    recordDamage(g, '1', 5, 2)
    const key2 = threatKey(threatContributors(g, names))
    expect(key2).not.toBe(key1)
  })
})
