// Covers the 2026-07 HUD feature batch that touches pure server logic: run
// energy (running = 2 tiles/tick with drain/regen), combat stance selection,
// and the fully-functional special attack (queue → drain → hits).
import { describe, expect, it } from 'vitest'
import {
  RUN_DRAIN_PER_TILE,
  RUN_REGEN_PER_TICK,
  tickPlayer,
  type TickContext,
  type TickPlayer,
} from '../server/tick'
import { startCombat } from '../server/combat'
import { npcsFromZone, type NpcState } from '../server/npc'
import { emptyInventory } from '../server/mining'
import { findPathAdjacent } from '../server/pathfind'
import type { Tile } from '../server/pathfind'
import { keyToHudTab, runEscapeHandlers } from '../client/src/ui'

const COLLISION = Array.from({ length: 16 }, () => '.'.repeat(16))

function makePlayer(overrides: Partial<TickPlayer> = {}): TickPlayer {
  return {
    charId: '1', name: 'WorldTester', x: 0, z: 0, path: [], anim: 'idle',
    stats: {
      attack: { xp: 100000, level: 40 }, strength: { xp: 100000, level: 40 },
      defence: { xp: 100000, level: 40 }, hitpoints: { xp: 100000, level: 40 },
    },
    inventory: emptyInventory(), pendingXp: {}, minted: {}, mining: null, crafting: null, pendingInteract: null,
    hp: 40, maxHp: 40, equipment: {}, gear: {}, combat: null,
    running: false, runEnergy: 100, lastRunSent: 100, stance: 'accurate', spell: null, specialEnergy: 100, lastSpecSent: 100, lastSpecQueuedSent: false, pendingSpecial: false, prayerPoints: 1, maxPrayerPoints: 1, prayerDrainAccumulator: 0, activeProtectionPrayer: null, activeCombatPrayer: null, lastPrayerSent: null, activePotions: {}, following: null, followTargetTile: null,
    ...overrides,
  }
}

function straightPath(len: number): Tile[] {
  return Array.from({ length: len }, (_, i) => ({ x: i + 1, z: 0 }))
}

function ctx(tick: number, npcs?: Map<string, NpcState>): TickContext {
  return { tick, rocks: new Map(), npcs, collision: COLLISION, pathAdjacent: (from, to) => findPathAdjacent(COLLISION, from, to) }
}

describe('run energy', () => {
  it('walks 1 tile/tick and regenerates energy when not running', () => {
    const player = makePlayer({ path: straightPath(6), runEnergy: 50 })
    tickPlayer(player, ctx(1))
    expect(player.x).toBe(1)
    expect(player.runEnergy).toBeCloseTo(50 + RUN_REGEN_PER_TICK)
  })

  it('runs 2 tiles/tick and drains energy while running', () => {
    const player = makePlayer({ path: straightPath(6), running: true, runEnergy: 100 })
    tickPlayer(player, ctx(1))
    expect(player.x).toBe(2)
    expect(player.runEnergy).toBeCloseTo(100 - RUN_DRAIN_PER_TILE * 2)
  })

  it('falls back to walking (and regenerates) when run energy is exhausted', () => {
    const player = makePlayer({ path: straightPath(6), running: true, runEnergy: 0 })
    tickPlayer(player, ctx(1))
    expect(player.x).toBe(1)
    expect(player.runEnergy).toBeCloseTo(RUN_REGEN_PER_TICK)
  })

  it('emits a {e:run} echo when the integer energy readout changes', () => {
    const player = makePlayer({ path: straightPath(6), running: true, runEnergy: 100 })
    const result = tickPlayer(player, ctx(1))
    const run = result.events.find((e) => e.e === 'run')
    expect(run).toBeTruthy()
    expect(run).toMatchObject({ running: true })
  })

  it('caps run energy at 100 while regenerating', () => {
    const player = makePlayer({ runEnergy: 99.9 })
    tickPlayer(player, ctx(1))
    expect(player.runEnergy).toBe(100)
  })
})

function bull(): { npcs: Map<string, NpcState>; npc: NpcState } {
  const npcs = npcsFromZone([{ id: 'bull_1', monsterId: 'pasture_bull', x: 5, z: 5, wander: { x: 0, z: 0, w: 16, h: 16 } }])
  return { npcs, npc: npcs.get('bull_1')! }
}

describe('combat stance', () => {
  it('starts a fight in the player’s selected stance', () => {
    const { npc } = bull()
    const p = makePlayer({ x: 5, z: 6, stance: 'aggressive' })
    startCombat(p, npc)
    expect(p.combat?.state.stance).toBe('aggressive')
  })
})

describe('special attack', () => {
  it('fires the weapon special on queue, draining special energy and dealing hits', () => {
    const { npcs } = bull()
    // Weak attacker so the bull survives the special — otherwise the kill
    // refills special energy to 100 and masks the drain we're asserting.
    const weak = { attack: { xp: 0, level: 1 }, strength: { xp: 0, level: 1 }, defence: { xp: 0, level: 1 }, hitpoints: { xp: 1154, level: 10 } }
    const player = makePlayer({
      x: 5, z: 6, stats: weak,
      equipment: { weapon: { itemId: 'dragon_dagger' } },
      pendingInteract: { kind: 'npc', id: 'bull_1', action: 'attack' },
    })

    // Approach + start the fight (one adjacent step is enough here).
    let tick = 0
    while (!player.combat && tick < 20) {
      tick++
      tickPlayer(player, ctx(tick, npcs))
    }
    expect(player.combat).toBeTruthy()

    // Queue the special (as WorldZone does on {t:'special'}), then tick until it
    // fires — the engine only fires when the attack timer is ready.
    player.combat!.state.specialAttackQueued = true
    let specEnergyAfterFire: number | null = null
    let specEventSeen = false
    for (let i = 0; i < 15 && specEnergyAfterFire === null && player.combat; i++) {
      tick++
      const r = tickPlayer(player, ctx(tick, npcs))
      if (r.events.some((e) => e.e === 'spec')) specEventSeen = true
      if (player.specialEnergy < 100) specEnergyAfterFire = player.specialEnergy
    }
    expect(specEventSeen).toBe(true)
    expect(specEnergyAfterFire).not.toBeNull()
    // dragon_dagger's special costs 25.
    expect(specEnergyAfterFire).toBeLessThanOrEqual(75)
  })
})

describe('F1-F5 tab shortcuts', () => {
  it('maps each F-key to its HUD tab', () => {
    expect(keyToHudTab('F1')).toBe('inventory')
    expect(keyToHudTab('F2')).toBe('equipment')
    expect(keyToHudTab('F3')).toBe('prayer')
    expect(keyToHudTab('F4')).toBe('magic')
    expect(keyToHudTab('F5')).toBe('combat')
  })

  it('ignores every other key', () => {
    expect(keyToHudTab('F6')).toBeNull()
    expect(keyToHudTab('a')).toBeNull()
    expect(keyToHudTab('Escape')).toBeNull()
  })
})

describe('Escape priority routing', () => {
  it('runs handlers in priority order (independent of registration order) and stops at the first that closes something', () => {
    const calls: number[] = []
    const closesEverything = runEscapeHandlers([
      { priority: 3, handler: () => (calls.push(3), true) },
      { priority: 1, handler: () => (calls.push(1), false) },
      { priority: 2, handler: () => (calls.push(2), true) },
    ])
    expect(closesEverything).toBe(true)
    expect(calls).toEqual([1, 2])
  })

  it('returns false when nothing is open', () => {
    expect(runEscapeHandlers([{ priority: 1, handler: () => false }])).toBe(false)
  })
})
