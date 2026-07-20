// Item 8 (P1): active potions must carry from the session onto a fight's engine
// state and decay per combat tick (then sync back), so a boost drunk before or
// during a fight actually applies. Drives the real state machine (tickPlayer).
import { describe, expect, it } from 'vitest'
import { tickPlayer, type TickContext, type TickPlayer } from '../server/tick'
import { npcsFromZone, type NpcState } from '../server/npc'
import { emptyInventory } from '../server/mining'
import { findPathAdjacent } from '../server/pathfind'

const OPEN = Array.from({ length: 12 }, () => '.'.repeat(12))

function makeMeleePlayer(overrides: Partial<TickPlayer> = {}): TickPlayer {
  return {
    charId: '1', name: 'Melee', x: 5, z: 6, path: [], anim: 'idle',
    stats: {
      attack: { xp: 0, level: 1 }, strength: { xp: 0, level: 1 },
      defence: { xp: 0, level: 1 }, ranged: { xp: 0, level: 1 },
      magic: { xp: 0, level: 1 }, hitpoints: { xp: 5_000_000, level: 99 },
    },
    inventory: emptyInventory(), pendingXp: {}, minted: {}, mining: null, crafting: null,
    pendingInteract: { kind: 'npc', id: 'bull_1', action: 'attack' },
    hp: 99, maxHp: 99,
    equipment: {}, gear: {}, combat: null,
    running: false, runEnergy: 100, lastRunSent: 100, stance: 'accurate', spell: null,
    specialEnergy: 100, lastSpecSent: 100,
    prayerPoints: 1, maxPrayerPoints: 1, prayerDrainAccumulator: 0,
    activeProtectionPrayer: null, activeCombatPrayer: null, lastPrayerSent: null,
    activePotions: {}, following: null, followTargetTile: null,
    ...overrides,
  }
}

function bullAt(x: number, z: number): Map<string, NpcState> {
  return npcsFromZone([{ id: 'bull_1', monsterId: 'pasture_bull', x, z, wander: { x, z, w: 1, h: 1 } }])
}

function ctx(tick: number, npcs: Map<string, NpcState>): TickContext {
  return { tick, rocks: new Map(), npcs, collision: OPEN, pathAdjacent: (from, to) => findPathAdjacent(OPEN, from, to) }
}

describe('active potions in world combat', () => {
  it('carries a session potion onto the fight and decays it tick by tick', () => {
    const player = makeMeleePlayer({ activePotions: { super_strength: 100 } })
    const npcs = bullAt(5, 5)
    for (let t = 1; t <= 5; t++) tickPlayer(player, ctx(t, npcs))
    // The engine cloned the buff onto the fight, decremented it each tick, and
    // synced the remaining duration back onto the session.
    expect(player.activePotions.super_strength).toBeLessThan(100)
    expect(player.activePotions.super_strength).toBeGreaterThan(0)
  })

  it('drops an expired potion from the session once its duration runs out', () => {
    const player = makeMeleePlayer({ activePotions: { super_strength: 3 } })
    const npcs = bullAt(5, 5)
    for (let t = 1; t <= 6; t++) tickPlayer(player, ctx(t, npcs))
    expect(player.activePotions.super_strength).toBeUndefined()
  })
})
