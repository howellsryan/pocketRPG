// Special energy in the open world is a SESSION resource, not a per-fight one.
// Reported bug: clicking away from a fight refilled the bar to full. It used to
// snap to 100 on every combat exit (and inherit the shared engine's refill-on-
// kill); now it only ever climbs on the clock, at SPECIAL_REGEN_PER_TICK.
import { describe, expect, it } from 'vitest'
import { SPECIAL_REGEN_PER_TICK, tickPlayer, type TickContext, type TickPlayer } from '../server/tick'
import { startCombat, stepCombat } from '../server/combat'
import { emptyResult } from '../server/tick'
import { npcsFromZone, type NpcState } from '../server/npc'
import { emptyInventory } from '../server/mining'
import { findPathAdjacent } from '../server/pathfind'

const COLLISION = Array.from({ length: 16 }, () => '.'.repeat(16))

function makePlayer(overrides: Partial<TickPlayer> = {}): TickPlayer {
  return {
    charId: '1', name: 'WorldTester', x: 5, z: 6, path: [], anim: 'idle',
    stats: {
      attack: { xp: 100000, level: 40 }, strength: { xp: 100000, level: 40 },
      defence: { xp: 100000, level: 40 }, hitpoints: { xp: 100000, level: 40 },
    },
    inventory: emptyInventory(), pendingXp: {}, minted: {}, mining: null, crafting: null, pendingInteract: null,
    hp: 40, maxHp: 40, equipment: { weapon: { itemId: 'dragon_dagger' } }, gear: {}, combat: null,
    running: false, runEnergy: 100, lastRunSent: 100, stance: 'accurate', spell: null, specialEnergy: 100, lastSpecSent: 100, lastSpecQueuedSent: false, pendingSpecial: false, prayerPoints: 1, maxPrayerPoints: 1, prayerDrainAccumulator: 0, activeProtectionPrayer: null, activeCombatPrayer: null, lastPrayerSent: null, activePotions: {}, following: null, followTargetTile: null,
    ...overrides,
  }
}

function bull(): { npcs: Map<string, NpcState>; npc: NpcState } {
  const npcs = npcsFromZone([{ id: 'bull_1', monsterId: 'pasture_bull', x: 5, z: 5, wander: { x: 0, z: 0, w: 16, h: 16 } }])
  return { npcs, npc: npcs.get('bull_1')! }
}

function ctx(tick: number, npcs?: Map<string, NpcState>): TickContext {
  return { tick, rocks: new Map(), npcs, collision: COLLISION, pathAdjacent: (from, to) => findPathAdjacent(COLLISION, from, to) }
}

describe('special energy is a session resource, not a per-fight one', () => {
  it('does not refill when the player walks out of a fight', () => {
    const { npcs, npc } = bull()
    const player = makePlayer({ specialEnergy: 40 })
    startCombat(player, npc, emptyResult())
    expect(player.combat).toBeTruthy()

    // Step far enough that neither side is in reach — the fight ends.
    player.x = 15
    player.z = 15
    stepCombat(player, ctx(1, npcs), emptyResult())
    expect(player.combat).toBeNull()
    expect(player.specialEnergy).toBe(40)
  })

  it('does not refill when the monster dies, even though the shared engine resets its own energy', () => {
    const { npcs, npc } = bull()
    const player = makePlayer({ specialEnergy: 30 })
    startCombat(player, npc, emptyResult())
    // Kill it outright on the next tick.
    npc.hp = 1
    player.combat!.state.monster.currentHP = 1
    for (let tick = 1; tick <= 12 && player.combat; tick++) stepCombat(player, ctx(tick, npcs), emptyResult())
    expect(npc.state).toBe('dead')
    expect(player.specialEnergy).toBeLessThan(100)
  })

  it('carries the remaining energy into the next fight instead of seeding at full', () => {
    const { npc } = bull()
    const player = makePlayer({ specialEnergy: 55 })
    startCombat(player, npc, emptyResult())
    expect(player.combat!.state.specialAttackEnergy).toBe(55)
    expect(player.specialEnergy).toBe(55)
  })

  it('regenerates on the clock while idle, and caps at full', () => {
    const player = makePlayer({ specialEnergy: 90 })
    tickPlayer(player, ctx(1))
    expect(player.specialEnergy).toBeCloseTo(90 + SPECIAL_REGEN_PER_TICK)

    const brimming = makePlayer({ specialEnergy: 99.95 })
    tickPlayer(brimming, ctx(1))
    expect(brimming.specialEnergy).toBe(100)
  })

  it('regenerates mid-fight too, and pushes the new value onto the live engine state', () => {
    const { npcs, npc } = bull()
    const player = makePlayer({ specialEnergy: 20 })
    startCombat(player, npc, emptyResult())
    // A level-40 player one-shots an 8 HP bull often enough to make this flaky;
    // the tick under test has to land mid-fight, so put the kill out of reach.
    npc.hp = 999
    player.combat!.state.monster.currentHP = 999
    tickPlayer(player, ctx(1, npcs))
    expect(player.combat).toBeTruthy()
    expect(player.specialEnergy).toBeGreaterThan(20)
    expect(player.combat!.state.specialAttackEnergy).toBe(player.specialEnergy)
  })

  it('takes 50 ticks (30s) to recover 10 points', () => {
    const player = makePlayer({ specialEnergy: 0 })
    for (let tick = 1; tick <= 50; tick++) tickPlayer(player, ctx(tick))
    expect(player.specialEnergy).toBeCloseTo(10)
  })

  it('refills an empty bar outright for a player with Master Rejuvenation', () => {
    const player = makePlayer({ specialEnergy: 0, masterRejuvenation: true })
    tickPlayer(player, ctx(1))
    expect(player.specialEnergy).toBe(100)
  })

  it('refills a bar spent down to the clock fraction the world always leaves', () => {
    // 50 debited from 50.2 leaves 0.2, not 0 — the bar reads 0% and the perk
    // has to fire, or it never fires in the world at all.
    const player = makePlayer({ specialEnergy: 0.2, masterRejuvenation: true })
    tickPlayer(player, ctx(1))
    expect(player.specialEnergy).toBe(100)
  })

  it('leaves a part-spent bar on the clock — the perk only fires at empty', () => {
    const player = makePlayer({ specialEnergy: 40, masterRejuvenation: true })
    tickPlayer(player, ctx(1))
    expect(player.specialEnergy).toBeCloseTo(40 + SPECIAL_REGEN_PER_TICK)
  })

  it('never refills in the Wilderness, where a free bar would decide the duel', () => {
    const player = makePlayer({ specialEnergy: 0, masterRejuvenation: true })
    for (let tick = 1; tick <= 50; tick++) tickPlayer(player, { ...ctx(tick), pvpZone: true })
    expect(player.specialEnergy).toBeCloseTo(10)
  })
})
