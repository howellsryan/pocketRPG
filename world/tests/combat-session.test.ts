// Q5 regression: spam-clicking the monster you're ALREADY fighting must not
// reset the engine's attack timer for a free instant hit. isSameFightTarget is
// the predicate WorldZone.handleInteract uses to keep player.combat alive when
// the click re-targets the fight in progress.
import { describe, expect, it } from 'vitest'
import { isSameFightTarget, playerAttackRange, startCombat } from '../server/combat'
import { npcsFromZone, type NpcState } from '../server/npc'
import { cutPathToRange, tickPlayer, type TickContext, type TickPlayer } from '../server/tick'
import { emptyInventory } from '../server/mining'
import { findPathAdjacent } from '../server/pathfind'

function playerFighting(npcId: string | null): TickPlayer {
  return { combat: npcId ? { npcId, state: {} as never } : null } as TickPlayer
}

describe('isSameFightTarget', () => {
  it('is true when re-clicking the npc already being fought', () => {
    expect(isSameFightTarget(playerFighting('bull_1'), { kind: 'npc', id: 'bull_1' })).toBe(true)
  })

  it('is false when clicking a different npc', () => {
    expect(isSameFightTarget(playerFighting('bull_1'), { kind: 'npc', id: 'goblin_2' })).toBe(false)
  })

  it('is false when the player is not in combat', () => {
    expect(isSameFightTarget(playerFighting(null), { kind: 'npc', id: 'bull_1' })).toBe(false)
  })

  it('is false for a non-npc intent even when the id matches', () => {
    expect(isSameFightTarget(playerFighting('bull_1'), { kind: 'rock', id: 'bull_1' })).toBe(false)
  })

  it('is false for a null intent', () => {
    expect(isSameFightTarget(playerFighting('bull_1'), null)).toBe(false)
  })
})

// WorldZone.handleInteract's npc/attack branch (WorldZone.ts:917-930) is not
// unit-testable directly (no DO harness), so this replicates its exact
// sequence with the real, exported production primitives it calls
// (findPathAdjacent, cutPathToRange, isSameFightTarget, playerAttackRange) to
// check the FULL wiring, not just the isSameFightTarget predicate in
// isolation. isSameFightTarget keeps `player.combat` from being nulled by
// clearIntents, but every click — including a same-target re-click — also
// re-arms `player.pendingInteract`. On the next tick, tickPlayer's
// `else if (player.pendingInteract) startInteract(...)` branch (tick.ts:420)
// fires startInteract, whose npc/attack case (tick.ts:241) calls
// `startCombat` unconditionally whenever the player is within range — with NO
// check for "is player.combat already an active session against this exact
// npc". startCombat always creates a brand-new engine state via
// createCombatState, whose playerAttackTimer starts at 0 (a fresh fight's
// "player always gets the first hit"). So even though clearIntents no longer
// nulls player.combat on a same-target click, the very next tick's
// startInteract call clobbers it with a freshly-timed state anyway —
// reproducing the exact free-extra-hit exploit Q5 claims to have closed.
describe('Q5 wiring: does a same-target re-click actually stay a no-op end to end', () => {
  const COLLISION = Array.from({ length: 16 }, () => '.'.repeat(16))

  function makePlayer(): TickPlayer {
    return {
      charId: '1', name: 'Tester', x: 5, z: 6, path: [], anim: 'idle',
      stats: {
        attack: { xp: 0, level: 1 }, strength: { xp: 0, level: 1 }, defence: { xp: 0, level: 1 },
        ranged: { xp: 0, level: 1 }, magic: { xp: 0, level: 1 }, hitpoints: { xp: 200000, level: 99 },
      },
      inventory: emptyInventory(), pendingXp: {}, minted: {}, mining: null, crafting: null, pendingInteract: null,
      hp: 400, maxHp: 400, equipment: {}, gear: {}, combat: null,
      running: false, runEnergy: 100, lastRunSent: 100, stance: 'accurate', spell: null, specialEnergy: 100, lastSpecSent: 100, lastSpecQueuedSent: false, pendingSpecial: false, prayerPoints: 1, maxPrayerPoints: 1, prayerDrainAccumulator: 0, activeProtectionPrayer: null, activeCombatPrayer: null, lastPrayerSent: null, activePotions: {}, following: null, followTargetTile: null,
    }
  }

  function bullAt(x: number, z: number): { npcs: Map<string, NpcState>; bull: NpcState } {
    const npcs = npcsFromZone([{ id: 'bull_1', monsterId: 'pasture_bull', x, z, wander: { x: 0, z: 0, w: 16, h: 16 } }])
    return { npcs, bull: npcs.get('bull_1')! }
  }

  function ctx(tick: number, npcs: Map<string, NpcState>): TickContext {
    return { tick, rocks: new Map(), npcs, collision: COLLISION, pathAdjacent: (from, to) => findPathAdjacent(COLLISION, from, to) }
  }

  /** Exactly what WorldZone.handleInteract's npc/attack branch does on a
   * click, using the same exported primitives (WorldZone.ts:917-930). */
  function simulateAttackClick(player: TickPlayer, npc: { x: number; z: number; id: string }): void {
    const path = findPathAdjacent(COLLISION, { x: player.x, z: player.z }, npc)
    if (!path) return
    const intent = { kind: 'npc' as const, id: npc.id, action: 'attack' as const }
    player.path = cutPathToRange(path.slice(1), npc, playerAttackRange(player))
    const keepCombat = isSameFightTarget(player, intent)
    player.pendingInteract = null
    player.mining = null
    player.crafting = null
    if (!keepCombat) player.combat = null
    player.pendingInteract = intent
  }

  it('a same-target re-click must not grant an extra playerHit beyond the weapon attack speed (pasture_bull attackSpeed 4)', () => {
    const { npcs, bull } = bullAt(5, 5)
    const player = makePlayer()
    startCombat(player, bull) // tick 0 equivalent: player is now fighting, fresh session

    const c = ctx(1, npcs)
    const r1 = tickPlayer(player, c) // tick 1: "player always gets first hit" — one playerHit fires here
    const hitsAfterTick1 = r1.hits.filter((h) => h.targetId === 'bull_1').length
    expect(hitsAfterTick1).toBe(1)

    // Re-click the SAME npc the player is already fighting (adjacent, no
    // movement needed) — the Q5 scenario.
    simulateAttackClick(player, bull)
    expect(player.combat).not.toBeNull() // isSameFightTarget kept it alive

    // pasture_bull's attackSpeed is 4 — with no re-click, the next real
    // attack should land on tick 5, not tick 2.
    const r2 = tickPlayer(player, ctx(2, npcs))
    const hitsAfterTick2 = r2.hits.filter((h) => h.targetId === 'bull_1').length
    expect(hitsAfterTick2).toBe(0) // FAILS if the re-click reset the attack timer
  })
})
