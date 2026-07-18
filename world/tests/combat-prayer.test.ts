// Item 7 (P1): prayer in world combat. Drives the real per-player state machine
// (tickPlayer) exactly as WorldZone does, proving the pool drains while a prayer
// is active and that a protection prayer cuts incoming damage via the engine.
import { describe, expect, it } from 'vitest'
import { tickPlayer, type TickContext, type TickPlayer } from '../server/tick'
import { npcsFromZone, type NpcState } from '../server/npc'
import { emptyInventory } from '../server/mining'
import { findPathAdjacent } from '../server/pathfind'

const OPEN = Array.from({ length: 12 }, () => '.'.repeat(12))

/** A weak melee fighter (deals ~nothing) standing next to the bull, so the bull
 * survives the window and keeps swinging — high HP so it never dies either. */
function makeMeleePlayer(overrides: Partial<TickPlayer> = {}): TickPlayer {
  return {
    charId: '1', name: 'Melee', x: 5, z: 6, path: [], anim: 'idle',
    stats: {
      attack: { xp: 0, level: 1 }, strength: { xp: 0, level: 1 },
      defence: { xp: 0, level: 1 }, ranged: { xp: 0, level: 1 },
      magic: { xp: 0, level: 1 }, hitpoints: { xp: 5_000_000, level: 99 },
      prayer: { xp: 5_000_000, level: 99 },
    },
    inventory: emptyInventory(), pendingXp: {}, minted: {}, mining: null, crafting: null,
    pendingInteract: { kind: 'npc', id: 'bull_1', action: 'attack' },
    hp: 99, maxHp: 99,
    equipment: {}, gear: {}, combat: null,
    running: false, runEnergy: 100, lastRunSent: 100, stance: 'accurate', spell: null,
    specialEnergy: 100, lastSpecSent: 100,
    prayerPoints: 70, maxPrayerPoints: 70, prayerDrainAccumulator: 0,
    activeProtectionPrayer: null, activeCombatPrayer: null, lastPrayerSent: null,
    ...overrides,
  }
}

function bullAt(x: number, z: number): { npcs: Map<string, NpcState>; bull: NpcState } {
  const npcs = npcsFromZone([{ id: 'bull_1', monsterId: 'pasture_bull', x, z, wander: { x, z, w: 1, h: 1 } }])
  return { npcs, bull: npcs.get('bull_1')! }
}

function ctx(tick: number, npcs: Map<string, NpcState>): TickContext {
  return { tick, rocks: new Map(), npcs, collision: OPEN, pathAdjacent: (from, to) => findPathAdjacent(OPEN, from, to) }
}

function damageTakenOver(player: TickPlayer, ticks: number): { taken: number; prayerEvents: number } {
  const { npcs } = bullAt(5, 5)
  let taken = 0
  let prayerEvents = 0
  for (let t = 1; t <= ticks; t++) {
    const r = tickPlayer(player, ctx(t, npcs))
    for (const h of r.hits) if (h.targetId === '1') taken += h.dmg
    prayerEvents += r.events.filter((e) => e.e === 'prayer').length
  }
  return { taken, prayerEvents }
}

describe('prayer in world combat', () => {
  it('drains the pool while a combat prayer is active and echoes the readout', () => {
    const player = makeMeleePlayer({ activeCombatPrayer: 'piety' }) // 40/min => 0.4/tick
    const { prayerEvents } = damageTakenOver(player, 40)
    expect(player.prayerPoints).toBeLessThan(70)
    expect(player.prayerPoints).toBeGreaterThan(0)
    expect(prayerEvents).toBeGreaterThan(0)
  })

  it('does not drain the pool when no prayer is active', () => {
    const player = makeMeleePlayer()
    damageTakenOver(player, 40)
    expect(player.prayerPoints).toBe(70)
  })

  it('Protect from Melee blocks all melee damage from the bull (100% reduction)', () => {
    const guarded = makeMeleePlayer({ activeProtectionPrayer: 'protection_from_melee' })
    const exposed = makeMeleePlayer()
    const g = damageTakenOver(guarded, 100)
    const e = damageTakenOver(exposed, 100)
    expect(g.taken).toBe(0)
    expect(e.taken).toBeGreaterThan(0) // positive control: the bull does land hits unprotected
  })
})
