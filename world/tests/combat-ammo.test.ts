// Item 6 (P0): ranged ammo must be consumed from the equipped slot and persisted
// (equipmentDirty), and a fight that runs out of ammo must STOP with a message
// rather than stall forever splashing nothing. Drives the adapter through
// tickPlayer exactly as WorldZone does (mirrors combat-flow.test.ts).
import { describe, expect, it } from 'vitest'
import { tickPlayer, type TickContext, type TickPlayer } from '../server/tick'
import { npcsFromZone, type NpcState } from '../server/npc'
import { emptyInventory } from '../server/mining'
import { findPathAdjacent } from '../server/pathfind'

const COLLISION = Array.from({ length: 16 }, () => '.'.repeat(16))

function makeRanger(ammoQty: number, overrides: Partial<TickPlayer> = {}): TickPlayer {
  return {
    charId: '1', name: 'Ranger', x: 5, z: 9, path: [], anim: 'idle',
    stats: {
      attack: { xp: 0, level: 1 }, strength: { xp: 0, level: 1 },
      defence: { xp: 100000, level: 40 }, ranged: { xp: 100000, level: 40 },
      magic: { xp: 0, level: 1 }, hitpoints: { xp: 100000, level: 40 },
    },
    inventory: emptyInventory(), pendingXp: {}, minted: {}, mining: null, crafting: null, pendingInteract: null,
    hp: 40, maxHp: 40,
    equipment: { weapon: { itemId: 'shortbow' }, ammo: { itemId: 'bronze_arrow', quantity: ammoQty } },
    gear: {}, combat: null,
    running: false, runEnergy: 100, lastRunSent: 100, stance: 'accurate', spell: null, specialEnergy: 100, lastSpecSent: 100, prayerPoints: 1, maxPrayerPoints: 1, prayerDrainAccumulator: 0, activeProtectionPrayer: null, activeCombatPrayer: null, lastPrayerSent: null,
    ...overrides,
  }
}

function bullAt(x: number, z: number): { npcs: Map<string, NpcState>; bull: NpcState } {
  const npcs = npcsFromZone([{ id: 'bull_1', monsterId: 'pasture_bull', x, z, wander: { x: 0, z: 0, w: 16, h: 16 } }])
  return { npcs, bull: npcs.get('bull_1')! }
}

function ctx(tick: number, npcs: Map<string, NpcState>): TickContext {
  return { tick, rocks: new Map(), npcs, collision: COLLISION, pathAdjacent: (from, to) => findPathAdjacent(COLLISION, from, to) }
}

const ammoQty = (p: TickPlayer): number =>
  Number((p.equipment.ammo as { quantity?: number } | null | undefined)?.quantity ?? 0)

describe('ranged ammo accounting in world combat', () => {
  it('consumes equipped arrows on a shot and flags equipment dirty so the flush persists it', () => {
    const { npcs, bull } = bullAt(5, 5)
    const player = makeRanger(50, { pendingInteract: { kind: 'npc', id: 'bull_1', action: 'attack' } })
    let dirtyTicks = 0
    let tick = 0
    while (bull.state !== 'dead' && tick < 1000) {
      tick++
      const r = tickPlayer(player, ctx(tick, npcs))
      if (r.equipmentDirty) dirtyTicks++
    }
    expect(bull.state).toBe('dead')
    // Arrows actually left the equipped slot, and every consuming tick signalled
    // the equipment as dirty for the flush.
    expect(ammoQty(player)).toBeLessThan(50)
    expect(dirtyTicks).toBeGreaterThan(0)
  })

  it('nulls the ammo slot and STOPS the fight with a message when arrows run out', () => {
    const { npcs, bull } = bullAt(5, 5)
    // One arrow only: the first shot spends it, the next swing finds no ammo.
    const player = makeRanger(1, { pendingInteract: { kind: 'npc', id: 'bull_1', action: 'attack' } })
    let sawRanOut = false
    for (let tick = 1; tick <= 40 && !sawRanOut && bull.state !== 'dead'; tick++) {
      const r = tickPlayer(player, ctx(tick, npcs))
      sawRanOut = r.events.some((e) => e.e === 'msg' && e.text.includes('run out of ammunition'))
    }
    expect(sawRanOut).toBe(true)
    expect(player.combat).toBeNull()
    expect(bull.attackerId).toBeNull()
    expect(ammoQty(player)).toBe(0)
    expect((player.equipment.ammo as unknown) === null).toBe(true)
  })
})
