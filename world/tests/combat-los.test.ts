// Item 4 (P0): the safespot exploit. A ranged/magic attacker must NOT be able to
// damage a monster through a wall — line of sight now gates the shot. Drives the
// real per-player state machine (tickPlayer), exactly as WorldZone does.
import { describe, expect, it } from 'vitest'
import { tickPlayer, type TickContext, type TickPlayer } from '../server/tick'
import { npcsFromZone, type NpcState } from '../server/npc'
import { emptyInventory } from '../server/mining'
import { findPathAdjacent } from '../server/pathfind'

// 12x12 open grid.
const OPEN = Array.from({ length: 12 }, () => '.'.repeat(12))
function withWallRow(z: number, xs: number[]): string[] {
  return OPEN.map((row, rz) => {
    if (rz !== z) return row
    const cells = row.split('')
    for (const x of xs) cells[x] = '#'
    return cells.join('')
  })
}

function makeRanger(): TickPlayer {
  return {
    charId: '1', name: 'Ranger', x: 5, z: 9, path: [], anim: 'idle',
    stats: {
      attack: { xp: 0, level: 1 }, strength: { xp: 0, level: 1 },
      defence: { xp: 100000, level: 40 }, ranged: { xp: 100000, level: 40 },
      magic: { xp: 0, level: 1 }, hitpoints: { xp: 100000, level: 40 },
    },
    inventory: emptyInventory(), pendingXp: {}, minted: {}, mining: null, crafting: null, pendingInteract: { kind: 'npc', id: 'bull_1', action: 'attack' },
    hp: 40, maxHp: 40,
    equipment: { weapon: { itemId: 'shortbow' }, ammo: { itemId: 'bronze_arrow', quantity: 500 } },
    gear: {}, combat: null,
    running: false, runEnergy: 100, lastRunSent: 100, stance: 'accurate', spell: null, specialEnergy: 100, lastSpecSent: 100, lastSpecQueuedSent: false, pendingSpecial: false, prayerPoints: 1, maxPrayerPoints: 1, prayerDrainAccumulator: 0, activeProtectionPrayer: null, activeCombatPrayer: null, lastPrayerSent: null, activePotions: {}, following: null, followTargetTile: null,
  }
}

function bull(): { npcs: Map<string, NpcState>; bull: NpcState } {
  const npcs = npcsFromZone([{ id: 'bull_1', monsterId: 'pasture_bull', x: 5, z: 5, wander: { x: 5, z: 5, w: 1, h: 1 } }])
  return { npcs, bull: npcs.get('bull_1')! }
}

function ctx(tick: number, npcs: Map<string, NpcState>, collision: string[]): TickContext {
  return { tick, rocks: new Map(), npcs, collision, pathAdjacent: (from, to) => findPathAdjacent(collision, from, to) }
}

describe('line-of-sight gating in world combat (safespot fix)', () => {
  it('a ranged attacker deals NO damage through a wall between it and the monster', () => {
    // Wall at z=7 spanning the whole width: the bull at (5,5) is walled off from
    // the ranger at (5,9). Bull is pinned to a 1x1 wander rect so it can't path
    // around within the test window.
    const collision = withWallRow(7, Array.from({ length: 12 }, (_, i) => i))
    const { npcs, bull: b } = bull()
    const player = makeRanger()
    let dmgToBull = 0
    for (let t = 1; t <= 30 && b.state !== 'dead'; t++) {
      const r = tickPlayer(player, ctx(t, npcs, collision))
      for (const h of r.hits) if (h.targetId === 'bull_1') dmgToBull += h.dmg
    }
    expect(dmgToBull).toBe(0)
    expect(b.hp).toBe(b.maxHp)
  })

  it('the same attacker DOES damage the monster once the line is clear (positive control)', () => {
    const { npcs, bull: b } = bull()
    const player = makeRanger()
    let dmgToBull = 0
    for (let t = 1; t <= 30 && b.state !== 'dead'; t++) {
      const r = tickPlayer(player, ctx(t, npcs, OPEN))
      for (const h of r.hits) if (h.targetId === 'bull_1' && h.dmg > 0) dmgToBull += h.dmg
    }
    expect(dmgToBull).toBeGreaterThan(0)
  })
})
