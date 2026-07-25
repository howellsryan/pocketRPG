// Regression for the "outside of combat" special-attack report: tapping
// Special with no active fight used to be silently ignored (a refusal
// message) — it should arm instead, firing as the opening swing of the very
// next fight, and a second tap before that fight starts should disarm it.
import { describe, expect, it } from 'vitest'
import { tickPlayer, emptyResult, type TickContext, type TickPlayer } from '../server/tick'
import { startCombat, emitSpecIfChanged } from '../server/combat'
import { npcsFromZone, type NpcState } from '../server/npc'
import { emptyInventory } from '../server/mining'
import { findPathAdjacent } from '../server/pathfind'
import type { ZoneEvent } from '../shared/protocol'

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
  const npcs = npcsFromZone([{ id: 'bull_1', monsterId: 'warlord_grondar', x: 5, z: 5, wander: { x: 0, z: 0, w: 16, h: 16 } }])
  return { npcs, npc: npcs.get('bull_1')! }
}

function ctx(tick: number, npcs: Map<string, NpcState>): TickContext {
  return { tick, rocks: new Map(), npcs, collision: COLLISION, pathAdjacent: (from, to) => findPathAdjacent(COLLISION, from, to) }
}

describe('special attack armed before combat exists', () => {
  it('fires as the opening swing once the next fight starts', () => {
    const { npcs, npc } = bull()
    const player = makePlayer({ pendingSpecial: true })

    startCombat(player, npc)
    expect(player.combat).not.toBeNull()
    expect(player.combat!.state.specialAttackQueued).toBe(true)
    expect(player.pendingSpecial).toBe(false)

    let sawSpecialHit = false
    for (let tick = 1; tick <= 10 && player.combat; tick++) {
      const r = tickPlayer(player, ctx(tick, npcs))
      if (r.hits.length >= 2) sawSpecialHit = true // dragon dagger's double_hit
    }
    expect(sawSpecialHit).toBe(true)
  })

  it('broadcasts the distinct attack_special anim on the tick the special fires, not the normal swing', () => {
    const { npcs, npc } = bull()
    const player = makePlayer({ pendingSpecial: true })
    startCombat(player, npc)

    let specialAnim: string | null = null
    let normalAnim: string | null = null
    for (let tick = 1; tick <= 12 && player.combat; tick++) {
      const r = tickPlayer(player, ctx(tick, npcs))
      if (r.hits.some((h) => h.targetId === npc.id)) {
        if (r.hits.filter((h) => h.targetId === npc.id).length >= 2) specialAnim = player.anim // dragon dagger double_hit
        else normalAnim = player.anim
      }
    }
    expect(specialAnim).toBe('attack_special')
    expect(normalAnim).toBe('attack')
  })

  it('a second tap before any fight starts disarms it (toggle off)', () => {
    const player = makePlayer()
    // Mirrors WorldZone's case 'special' handler: no player.combat -> toggles pendingSpecial.
    player.pendingSpecial = !player.pendingSpecial
    expect(player.pendingSpecial).toBe(true)
    player.pendingSpecial = !player.pendingSpecial
    expect(player.pendingSpecial).toBe(false)

    const { npc } = bull()
    startCombat(player, npc)
    expect(player.combat!.state.specialAttackQueued).toBe(false)
  })

  it('emits a {e:spec} echo with queued:true the instant it arms, even though energy does not move', () => {
    const player = makePlayer({ pendingSpecial: true })
    const events: ZoneEvent[] = []
    emitSpecIfChanged(player, events)
    expect(events).toEqual([{ e: 'spec', energy: 100, queued: true }])
  })

  it('startCombat echoes queued:true when it carries an armed special into the new fight', () => {
    const { npc } = bull()
    const player = makePlayer({ pendingSpecial: true })
    const result = emptyResult()
    startCombat(player, npc, result)
    const specEvents = result.events.filter((e) => e.e === 'spec')
    expect(specEvents.at(-1)).toEqual({ e: 'spec', energy: 100, queued: true })
  })
})
