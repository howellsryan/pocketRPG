// The protection prayer a player is using shows over their head, so an opponent
// (or a party member) can read what they are praying against — the same job the
// boss's phase tint does from the other side of the fight.
import { describe, expect, it } from 'vitest'
import { protectionOverhead } from '../shared/prayer'
import { toEntityDiff, tickPlayer, type TickContext, type TickPlayer } from '../server/tick'
import { emptyInventory } from '../server/mining'

const COLLISION = Array.from({ length: 8 }, () => '.'.repeat(8))

function makePlayer(overrides: Partial<TickPlayer> = {}): TickPlayer {
  return {
    charId: '1', name: 'WorldTester', x: 2, z: 2, path: [], anim: 'idle',
    stats: { attack: { xp: 0, level: 1 }, strength: { xp: 0, level: 1 }, defence: { xp: 0, level: 1 }, hitpoints: { xp: 1154, level: 10 } },
    inventory: emptyInventory(), pendingXp: {}, minted: {}, mining: null, crafting: null, pendingInteract: null,
    hp: 10, maxHp: 10, equipment: {}, gear: {}, combat: null,
    running: false, runEnergy: 100, lastRunSent: 100, stance: 'accurate', spell: null,
    specialEnergy: 100, lastSpecSent: 100, lastSpecQueuedSent: false, pendingSpecial: false,
    prayerPoints: 10, maxPrayerPoints: 10, prayerDrainAccumulator: 0,
    activeProtectionPrayer: null, activeCombatPrayer: null, lastPrayerSent: null,
    activePotions: {}, following: null, followTargetTile: null,
    ...overrides,
  } as TickPlayer
}

const ctx = (tick: number): TickContext => ({ tick, rocks: new Map(), collision: COLLISION } as TickContext)

describe('protectionOverhead', () => {
  it('names the style each protection prayer blocks', () => {
    expect(protectionOverhead('protection_from_melee')).toBe('melee')
    expect(protectionOverhead('protection_from_missiles')).toBe('ranged')
    expect(protectionOverhead('protection_from_magic')).toBe('magic')
  })

  it('has nothing to show for no prayer, an unknown one, or a combat prayer', () => {
    expect(protectionOverhead(null)).toBeNull()
    expect(protectionOverhead('not_a_prayer')).toBeNull()
    // A stat boost is not something an opponent needs to read off your head.
    expect(protectionOverhead('ultimate_strength')).toBeNull()
  })
})

describe('the overhead rides the entity diff', () => {
  it('carries the style while a protection prayer is on, and nothing when it is off', () => {
    const player = makePlayer({ activeProtectionPrayer: 'protection_from_magic' })
    expect(toEntityDiff(player).overhead).toBe('magic')

    player.activeProtectionPrayer = null
    // Absent, not null: the client treats an absent field as "cleared".
    expect(toEntityDiff(player).overhead).toBeUndefined()
  })

  it('broadcasts a player who toggled a prayer without moving', () => {
    // Prayers toggle between ticks (a client message), so the tick's own
    // before/after snapshot cannot see the change — a standing player would
    // otherwise wear the icon in silence until they next walked or took a hit.
    const player = makePlayer()
    expect(tickPlayer(player, ctx(1)).entChanged).toBe(false)

    player.activeProtectionPrayer = 'protection_from_melee'
    expect(tickPlayer(player, ctx(2)).entChanged).toBe(true)
    // Only once — the diff is not re-sent every tick the prayer stays on.
    expect(tickPlayer(player, ctx(3)).entChanged).toBe(false)

    player.activeProtectionPrayer = null
    expect(tickPlayer(player, ctx(4)).entChanged).toBe(true)
  })
})
