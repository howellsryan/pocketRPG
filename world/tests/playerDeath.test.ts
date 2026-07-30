// A world death has to LOOK like one. The bar the player watches is fed by
// `{e:'hp'}` echoes, and every death path either heals them to full or takes
// them out of the zone before the zone's own echo loop runs — so the death tick
// carries its own 0. Without it the last reading a dying client ever got was the
// tick BEFORE the killing blow: you died with health to spare, and in an
// instanced lair (Zaryth) the killing splat never arrived either.
import { describe, expect, it } from 'vitest'
import { tickPlayer, type TickContext, type TickPlayer } from '../server/tick'
import { npcsFromZone, type NpcState } from '../server/npc'
import { emptyInventory } from '../server/mining'
import { findPathAdjacent } from '../server/pathfind'

const COLLISION = Array.from({ length: 16 }, () => '.'.repeat(16))

function makePlayer(overrides: Partial<TickPlayer> = {}): TickPlayer {
  return {
    charId: '1', name: 'WorldTester', x: 5, z: 6, path: [], anim: 'idle',
    stats: {
      attack: { xp: 0, level: 1 }, strength: { xp: 0, level: 1 },
      defence: { xp: 0, level: 1 }, ranged: { xp: 0, level: 1 },
      magic: { xp: 0, level: 1 }, hitpoints: { xp: 1154, level: 10 },
    },
    inventory: emptyInventory(), pendingXp: {}, minted: {}, mining: null, crafting: null, pendingInteract: null,
    hp: 1, maxHp: 10, equipment: {}, gear: {}, combat: null,
    running: false, runEnergy: 100, lastRunSent: 100, stance: 'accurate', spell: null, specialEnergy: 100, lastSpecSent: 100, lastSpecQueuedSent: false, pendingSpecial: false, prayerPoints: 1, maxPrayerPoints: 1, prayerDrainAccumulator: 0, activeProtectionPrayer: null, activeCombatPrayer: null, lastPrayerSent: null, activePotions: {}, following: null, followTargetTile: null,
    ...overrides,
  }
}

function ctx(tick: number, npcs: Map<string, NpcState>): TickContext {
  return { tick, rocks: new Map(), npcs, collision: COLLISION, pathAdjacent: (from, to) => findPathAdjacent(COLLISION, from, to) }
}

/** Fights an adjacent bull on 1 HP until the bull lands a hit. */
function fightToDeath(): { died: boolean; events: unknown[]; hp: number } {
  const npcs = npcsFromZone([{ id: 'bull_1', monsterId: 'pasture_bull', x: 5, z: 5, wander: { x: 0, z: 0, w: 16, h: 16 } }])
  const player = makePlayer({ pendingInteract: { kind: 'npc', id: 'bull_1', action: 'attack' } })
  for (let tick = 1; tick <= 2000; tick++) {
    const result = tickPlayer(player, ctx(tick, npcs))
    if (result.died) return { died: true, events: result.events, hp: player.hp }
    // The bull is unkillable at level 1 with bare hands over this window, but
    // don't let a lucky run end the test on the wrong outcome.
    if (npcs.get('bull_1')!.state === 'dead') break
  }
  return { died: false, events: [], hp: player.hp }
}

describe('the death tick empties the bar', () => {
  it('carries an hp event of 0 out with the death', () => {
    const { died, events, hp } = fightToDeath()

    expect(died).toBe(true)
    expect(hp).toBe(0)
    expect(events).toContainEqual({ e: 'hp', hp: 0, maxHp: 10 })
  })

  it('reports the death and the 0 on the same tick, never a tick apart', () => {
    // The respawn heal (WorldZone) and the eject both run after this result is
    // handed back, so an hp event deferred to "the next tick" is an hp event
    // that either shows full health or never sends at all.
    const { events } = fightToDeath()
    const hpEvents = (events as { e: string; hp?: number }[]).filter((e) => e.e === 'hp')

    expect(hpEvents).toEqual([{ e: 'hp', hp: 0, maxHp: 10 }])
  })
})
