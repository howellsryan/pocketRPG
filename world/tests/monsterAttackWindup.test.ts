// The open-world monster swing is led so its animation's IMPACT frame lands on
// the hit splat, exactly like the combat arena (shared src/utils/combatWindup.js).
// combat.ts broadcasts a SINGLE 'attack' pulse `leadTicks` before the resolve —
// derived from the monster's `attackImpactSec` — and the hit/miss events no
// longer re-broadcast the anim (a second, non-adjacent pulse would restart the
// clip on the splat tick and desync it). Scripted-engine pattern mirrors
// combat-swing-anim.test.ts.
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

function npcAt(monsterId: string, x: number, z: number): { npcs: Map<string, NpcState>; npc: NpcState } {
  const npcs = npcsFromZone([{ id: 'm_1', monsterId, x, z, wander: { x: 0, z: 0, w: 16, h: 16 } }])
  return { npcs, npc: npcs.get('m_1')! }
}

function ctx(tick: number, npcs: Map<string, NpcState>): TickContext {
  return { tick, rocks: new Map(), npcs, collision: Array.from({ length: 16 }, () => '.'.repeat(16)), pathAdjacent: () => null }
}

afterEach(() => vi.clearAllMocks())

describe('stepCombat monster attack windup lead', () => {
  it('pre-signals a no-impact monster one tick before the hit, and the resolve tick does not re-broadcast the swing', () => {
    const { npcs, npc } = npcAt('pasture_bull', 5, 5) // no attackImpactSec => 1-tick lead
    const player = makePlayer()
    startCombat(player, npc)
    expect(player.combat).not.toBeNull()

    // Lead tick: one tick from the swing (post-decrement 1) -> single pulse now.
    mockedProcessCombatTick.mockReturnValueOnce({
      combatState: { ...player.combat!.state, monsterAttackTimer: 1 },
      events: [],
    } as never)
    stepCombat(player, ctx(1, npcs), emptyResult())
    expect(npc.anim).toBe('attack')

    // Resolve tick: the real hit lands. The anim is NOT re-broadcast (idle), but
    // the splat still fires at the true resolved tick.
    mockedProcessCombatTick.mockReturnValueOnce({
      combatState: { ...player.combat!.state, monsterAttackTimer: 4 },
      events: [{ type: 'monsterHit', damage: 5 }],
    } as never)
    const r2 = emptyResult()
    stepCombat(player, ctx(2, npcs), r2)
    expect(npc.anim).toBe('idle')
    expect(r2.hits.some((h) => h.targetId === player.charId && h.dmg === 5)).toBe(true)
  })

  it('leads a mid-clip-impact boss (Grondar, 2.25s) by four ticks, not one', () => {
    const { npcs, npc } = npcAt('warlord_grondar', 5, 5)
    const player = makePlayer()
    startCombat(player, npc)

    // A one-tick lead would fire here — but Grondar's impact needs four ticks,
    // so this tick must stay idle.
    mockedProcessCombatTick.mockReturnValueOnce({
      combatState: { ...player.combat!.state, monsterAttackTimer: 1 },
      events: [],
    } as never)
    stepCombat(player, ctx(1, npcs), emptyResult())
    expect(npc.anim).toBe('idle')

    // Four ticks out is the lead tick for a 2.25s impact.
    mockedProcessCombatTick.mockReturnValueOnce({
      combatState: { ...player.combat!.state, monsterAttackTimer: 4 },
      events: [],
    } as never)
    stepCombat(player, ctx(2, npcs), emptyResult())
    expect(npc.anim).toBe('attack')
  })

  it('a miss still fires a 0 splat without re-broadcasting the swing anim', () => {
    const { npcs, npc } = npcAt('pasture_bull', 5, 5)
    const player = makePlayer()
    startCombat(player, npc)

    mockedProcessCombatTick.mockReturnValueOnce({
      combatState: { ...player.combat!.state, monsterAttackTimer: 4 },
      events: [{ type: 'monsterMiss' }],
    } as never)
    const r = emptyResult()
    stepCombat(player, ctx(1, npcs), r)
    expect(npc.anim).toBe('idle')
    expect(r.hits.some((h) => h.targetId === player.charId && h.dmg === 0)).toBe(true)
  })

  it('never pre-signals for a fight where this player is not the retaliation target', () => {
    const { npcs, npc } = npcAt('pasture_bull', 5, 5)
    const player = makePlayer()
    startCombat(player, npc)
    npc.attackerId = 'someone-else'

    mockedProcessCombatTick.mockReturnValueOnce({
      combatState: { ...player.combat!.state, monsterAttackTimer: 1 },
      events: [],
    } as never)
    stepCombat(player, ctx(1, npcs), emptyResult())
    expect(npc.anim).not.toBe('attack')
  })
})
