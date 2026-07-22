// Regression: the open-world monster attack animation used to only broadcast
// on the exact tick the hit event landed, so the client's swing visibly
// started AFTER the damage number was already on screen — unlike the combat
// arena, which pre-starts the swing so it ends on the hit tick. combat.ts now
// pre-signals the anim one tick (MONSTER_ATTACK_LEAD_TICKS) before the real
// hit event fires. Scripted-engine pattern mirrors combat-swing-anim.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/engine/combat.js', () => ({
  createCombatState: vi.fn((monster: { hitpoints: number }, combatType: string) => ({
    combatType,
    monster: { hitpoints: monster.hitpoints, currentHP: monster.hitpoints },
    specialAttackEnergy: 100,
    monsterAttackTimer: 4,
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

describe('stepCombat monster attack windup lead', () => {
  it('broadcasts the attack anim one tick before the monsterHit event actually lands', () => {
    const { npcs, bull } = bullAt(5, 5)
    const player = makePlayer()
    startCombat(player, bull)
    expect(player.combat).not.toBeNull()

    // Tick 1: no event yet, monster is 2 ticks from swinging (post-decrement 1)
    // -> this is the lead tick, anim should pre-signal now.
    mockedProcessCombatTick.mockReturnValueOnce({
      combatState: { ...player.combat!.state, monsterAttackTimer: 1 },
      events: [],
    } as never)
    stepCombat(player, ctx(1, npcs), emptyResult())
    expect(bull.anim).toBe('attack')

    // Tick 2: the real hit lands (monsterAttackTimer resets after resolving).
    mockedProcessCombatTick.mockReturnValueOnce({
      combatState: { ...player.combat!.state, monsterAttackTimer: 4 },
      events: [{ type: 'monsterHit', damage: 5 }],
    } as never)
    const r2 = emptyResult()
    stepCombat(player, ctx(2, npcs), r2)
    expect(bull.anim).toBe('attack')
    expect(r2.hits.some((h) => h.targetId === player.charId && h.dmg === 5)).toBe(true)

    // Tick 3: nothing pending (still 3 ticks from the next swing) -> idle.
    mockedProcessCombatTick.mockReturnValueOnce({
      combatState: { ...player.combat!.state, monsterAttackTimer: 3 },
      events: [],
    } as never)
    stepCombat(player, ctx(3, npcs), emptyResult())
    expect(bull.anim).toBe('idle')
  })

  it('never pre-signals for a fight where this player is not the retaliation target', () => {
    const { npcs, bull } = bullAt(5, 5)
    const player = makePlayer()
    startCombat(player, bull)
    bull.attackerId = 'someone-else'

    mockedProcessCombatTick.mockReturnValueOnce({
      combatState: { ...player.combat!.state, monsterAttackTimer: 1 },
      events: [],
    } as never)
    stepCombat(player, ctx(1, npcs), emptyResult())
    expect(bull.anim).not.toBe('attack')
  })
})
