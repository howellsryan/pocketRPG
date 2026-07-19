// R2-1 (docs/open-world-changes-plan.md): regression coverage for the
// Sunbearer Ring pinning special-attack energy at 100 through the world's
// combat adapter (as opposed to tests/sunbearerRing.test.ts, which covers the
// shared engine directly). Mirrors the stepCombat harness pattern of
// world-hud.test.ts's 'special attack' describe block.
import { describe, expect, it } from 'vitest'
import { tickPlayer, type TickContext, type TickPlayer } from '../server/tick'
import { npcsFromZone, type NpcState } from '../server/npc'
import { emptyInventory } from '../server/mining'
import { findPathAdjacent } from '../server/pathfind'

const COLLISION = Array.from({ length: 16 }, () => '.'.repeat(16))

function makePlayer(overrides: Partial<TickPlayer> = {}): TickPlayer {
  return {
    charId: '1', name: 'WorldTester', x: 0, z: 0, path: [], anim: 'idle',
    stats: {
      attack: { xp: 0, level: 1 }, strength: { xp: 0, level: 1 },
      defence: { xp: 0, level: 1 }, hitpoints: { xp: 1154, level: 10 },
    },
    inventory: emptyInventory(), pendingXp: {}, minted: {}, mining: null, crafting: null, pendingInteract: null,
    hp: 40, maxHp: 40, equipment: {}, gear: {}, combat: null,
    running: false, runEnergy: 100, lastRunSent: 100, stance: 'accurate', spell: null, specialEnergy: 100, lastSpecSent: 100, prayerPoints: 1, maxPrayerPoints: 1, prayerDrainAccumulator: 0, activeProtectionPrayer: null, activeCombatPrayer: null, lastPrayerSent: null, activePotions: {},
    ...overrides,
  }
}

function ctx(tick: number, npcs?: Map<string, NpcState>): TickContext {
  return { tick, rocks: new Map(), npcs, collision: COLLISION, pathAdjacent: (from, to) => findPathAdjacent(COLLISION, from, to) }
}

function bull(): { npcs: Map<string, NpcState>; npc: NpcState } {
  const npcs = npcsFromZone([{ id: 'bull_1', monsterId: 'pasture_bull', x: 5, z: 5, wander: { x: 0, z: 0, w: 16, h: 16 } }])
  return { npcs, npc: npcs.get('bull_1')! }
}

describe('Sunbearer Ring in the open world', () => {
  it('keeps special-attack energy pinned at 100 through the world combat adapter', () => {
    const { npcs } = bull()
    const player = makePlayer({
      x: 5, z: 6,
      equipment: { weapon: { itemId: 'dragon_dagger' }, ring: { itemId: 'sunbearer_ring' } },
      pendingInteract: { kind: 'npc', id: 'bull_1', action: 'attack' },
    })

    let tick = 0
    while (!player.combat && tick < 20) {
      tick++
      tickPlayer(player, ctx(tick, npcs))
    }
    expect(player.combat).toBeTruthy()

    player.combat!.state.specialAttackQueued = true
    let specialFired = false
    for (let i = 0; i < 15 && player.combat; i++) {
      tick++
      const r = tickPlayer(player, ctx(tick, npcs))
      // The special fired once specialAttackQueued clears and a hit landed —
      // no {e:'spec'} echo is expected here since the readout never moves off
      // 100 (emitSpecIfChanged only fires on a change).
      if (r.hits.length > 0) specialFired = true
      expect(r.events.every((e) => e.e !== 'spec' || e.energy >= 100)).toBe(true)
      expect(player.specialEnergy).toBe(100)
    }
    expect(specialFired).toBe(true)
    expect(player.combat!.state.specialAttackQueued).toBe(false)
  })
})
