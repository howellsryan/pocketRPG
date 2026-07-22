// Q1 regression, deterministic version: complements combat-flow.test.ts's
// probabilistic "many ticks" test with a scripted-events unit test that pins
// down the exact acceptance criterion — a playerHit event with damage:0 (a
// MISS, not just a hit) must still set the attack animation, since the engine
// emits the same 'playerHit' event type for both outcomes and combat.ts must
// not filter on ev.damage. Mocks the engine so the miss case is guaranteed
// instead of left to RNG (a real fight could run 60 ticks against a weak foe
// without ever rolling a miss).
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/engine/combat.js', () => ({
  createCombatState: vi.fn((monster: { hitpoints: number }, combatType: string) => ({
    combatType,
    monster: { hitpoints: monster.hitpoints, currentHP: monster.hitpoints },
    specialAttackEnergy: 100,
    runesConsumed: null,
  })),
  processCombatTick: vi.fn(),
}))

import { processCombatTick } from '../../src/engine/combat.js'
import { startCombat, stepCombat } from '../server/combat'
import { npcsFromZone, type NpcState } from '../server/npc'
import { emptyResult, type TickContext, type TickPlayer } from '../server/tick'
import { emptyInventory } from '../server/mining'

const mockedProcessCombatTick = vi.mocked(processCombatTick)

function makePlayer(): TickPlayer {
  return {
    charId: '1', name: 'Tester', x: 5, z: 6, path: [], anim: 'idle',
    stats: {
      attack: { xp: 0, level: 1 }, strength: { xp: 0, level: 1 }, defence: { xp: 0, level: 1 },
      ranged: { xp: 0, level: 1 }, magic: { xp: 0, level: 1 }, hitpoints: { xp: 0, level: 1 },
    },
    inventory: emptyInventory(), pendingXp: {}, minted: {}, mining: null, crafting: null, pendingInteract: null,
    hp: 40, maxHp: 40, equipment: {}, gear: {}, combat: null,
    running: false, runEnergy: 100, lastRunSent: 100, stance: 'accurate', spell: null, specialEnergy: 100, lastSpecSent: 100, lastSpecQueuedSent: false, pendingSpecial: false, prayerPoints: 1, maxPrayerPoints: 1, prayerDrainAccumulator: 0, activeProtectionPrayer: null, activeCombatPrayer: null, lastPrayerSent: null, activePotions: {}, following: null, followTargetTile: null,
  }
}

function bullAt(x: number, z: number): { npcs: Map<string, NpcState>; bull: NpcState } {
  const npcs = npcsFromZone([{ id: 'bull_1', monsterId: 'pasture_bull', x, z, wander: { x: 0, z: 0, w: 16, h: 16 } }])
  return { npcs, bull: npcs.get('bull_1')! }
}

function ctx(tick: number, npcs: Map<string, NpcState>): TickContext {
  return { tick, rocks: new Map(), npcs, collision: Array.from({ length: 16 }, () => '.'.repeat(16)), pathAdjacent: () => null }
}

afterEach(() => vi.clearAllMocks())

describe('stepCombat swing animation (scripted engine events)', () => {
  it('sets the attack anim on a playerHit event even when damage is 0 (a miss)', () => {
    const { npcs, bull } = bullAt(5, 5)
    const player = makePlayer()
    startCombat(player, bull)
    expect(player.combat).not.toBeNull()

    mockedProcessCombatTick.mockReturnValue({
      combatState: player.combat!.state,
      events: [{ type: 'playerHit', damage: 0 }],
    } as never)

    player.anim = 'idle'
    stepCombat(player, ctx(1, npcs), emptyResult())
    expect(player.anim).toBe('attack')
  })

  it('keeps the attack anim on the killing tick so a one-hit kill still swings', () => {
    // Regression: killNpc used to reset player.anim to 'idle' on the same tick
    // the fatal playerHit set it to 'attack' (monsterDeath fires after playerHit
    // in the engine's event list), so the killing swing was never broadcast and
    // the client saw the animation cut off. The kill tick must broadcast the
    // attack; the next idle tick returns to idle upstream (tick.ts).
    const { npcs, bull } = bullAt(5, 5)
    const player = makePlayer()
    startCombat(player, bull)

    mockedProcessCombatTick.mockReturnValue({
      combatState: player.combat!.state,
      events: [{ type: 'playerHit', damage: 12 }, { type: 'monsterDeath', loot: [] }],
    } as never)

    player.anim = 'idle'
    stepCombat(player, ctx(1, npcs), emptyResult())
    expect(player.anim).toBe('attack')
    expect(player.combat).toBeNull()
  })

  it('stays idle on a tick with no playerHit/specialHit event (engine still winding up)', () => {
    const { npcs, bull } = bullAt(5, 5)
    const player = makePlayer()
    startCombat(player, bull)

    mockedProcessCombatTick.mockReturnValue({
      combatState: player.combat!.state,
      events: [],
    } as never)

    player.anim = 'idle'
    stepCombat(player, ctx(1, npcs), emptyResult())
    expect(player.anim).toBe('idle')
  })

  it('sets the ranged attack anim on specialHit for a ranged combat type', () => {
    const { npcs, bull } = bullAt(5, 5)
    const player = makePlayer()
    player.equipment = { weapon: { itemId: 'oak_shortbow' } }
    startCombat(player, bull)
    expect(player.combat!.state.combatType).toBe('ranged')

    mockedProcessCombatTick.mockReturnValue({
      combatState: player.combat!.state,
      events: [{ type: 'specialHit', totalDamage: 12, hits: [12] }],
    } as never)

    player.anim = 'idle'
    stepCombat(player, ctx(1, npcs), emptyResult())
    expect(player.anim).toBe('attack_ranged')
  })
})
