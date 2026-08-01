import { describe, expect, it } from 'vitest'
import { tickPlayer, type TickContext, type TickPlayer } from '../server/tick'
import { emptyPools } from '../server/sessionItems'
import { seedPrayer } from '../shared/prayer'
import { crossesIntoDanger, isDangerTile, PVP_LINE_Z } from '../shared/pvpArea'
import wilderness from '../zones/wilderness.json'
import type { InvSlot } from '../shared/protocol'

/** A world session parked one tile south of the line, walking north. */
function walker(consented: boolean, path: { x: number; z: number }[]): TickPlayer & { pvpConsent: boolean } {
  const pools = emptyPools({})
  return {
    charId: '1', name: 'A', x: 20, z: PVP_LINE_Z + 1, path,
    anim: 'idle', stats: {}, inventory: new Array<InvSlot>(28).fill(null),
    pendingXp: {}, minted: pools.minted, mining: null, crafting: null, pendingInteract: null,
    hp: 10, maxHp: 10, equipment: {}, gear: {}, combat: null,
    running: false, runEnergy: 100, lastRunSent: 100, stance: 'accurate', spell: null,
    specialEnergy: 100, lastSpecSent: 100, lastSpecQueuedSent: false, pendingSpecial: false,
    ...seedPrayer(1), lastPrayerSent: null, activePotions: {},
    following: null, followTargetTile: null,
    pvpConsent: consented,
  } as unknown as TickPlayer & { pvpConsent: boolean }
}

/** The DO builds exactly this guard (WorldZone.tick). */
const ctx = (): TickContext => ({
  tick: 1,
  rocks: new Map(),
  collision: wilderness.collision,
  blockStep: (player, to) => !(player as unknown as { pvpConsent: boolean }).pvpConsent && crossesIntoDanger(player, to),
})

const northPath = [
  { x: 20, z: PVP_LINE_Z },
  { x: 20, z: PVP_LINE_Z - 1 },
  { x: 20, z: PVP_LINE_Z - 2 },
]

describe('the Wilderness crossing', () => {
  it('stops a player who has not consented, on the safe side, and prompts once', () => {
    const player = walker(false, [...northPath])
    // Step 1 is still safe, so it is taken.
    const first = tickPlayer(player, ctx())
    expect(player.z).toBe(PVP_LINE_Z)
    expect(first.events.some((e) => e.e === 'pvpPrompt')).toBe(false)

    const second = tickPlayer(player, ctx())
    expect(isDangerTile(player)).toBe(false)
    expect(player.z).toBe(PVP_LINE_Z)
    expect(second.events.filter((e) => e.e === 'pvpPrompt')).toHaveLength(1)
    // The rest of the walk is dropped, so the prompt cannot re-fire every tick.
    expect(player.path).toEqual([])
  })

  it('lets a consenting player walk straight through', () => {
    const player = walker(true, [...northPath])
    for (let i = 0; i < 3; i++) tickPlayer(player, ctx())
    expect(isDangerTile(player)).toBe(true)
    expect(player.z).toBe(PVP_LINE_Z - 2)
  })

  it('stops a RUNNING player on the safe tile rather than letting the second step through', () => {
    const player = walker(false, [...northPath])
    player.running = true
    tickPlayer(player, ctx())
    // Running takes two tiles a tick; the first lands on the line, and the
    // second must be refused rather than carrying them across.
    expect(isDangerTile(player)).toBe(false)
    expect(player.z).toBe(PVP_LINE_Z)
  })

  it('never blocks the walk home', () => {
    const player = walker(false, [{ x: 20, z: PVP_LINE_Z + 2 }])
    player.z = PVP_LINE_Z + 1
    const result = tickPlayer(player, ctx())
    expect(player.z).toBe(PVP_LINE_Z + 2)
    expect(result.events.some((e) => e.e === 'pvpPrompt')).toBe(false)
  })

  it('never blocks a player already north of the line', () => {
    const player = walker(false, [{ x: 20, z: PVP_LINE_Z - 6 }])
    player.z = PVP_LINE_Z - 5
    const result = tickPlayer(player, ctx())
    expect(player.z).toBe(PVP_LINE_Z - 6)
    expect(result.events.some((e) => e.e === 'pvpPrompt')).toBe(false)
  })
})

describe('the Wilderness zone', () => {
  it('spawns the player in the safe camp', () => {
    expect(isDangerTile(wilderness.spawn)).toBe(false)
  })

  it('puts a bank chest within reach of the spawn tile', () => {
    const chests = wilderness.objects.filter((o) => o.type === 'bank_chest')
    expect(chests.length).toBeGreaterThan(0)
    const near = chests.some((c) => Math.max(Math.abs(c.x - wilderness.spawn.x), Math.abs(c.z - wilderness.spawn.z)) <= 1)
    expect(near).toBe(true)
  })

  it('has no monsters — everything dangerous out here is a player', () => {
    expect(wilderness.npcs).toEqual([])
  })

  it('has no walk-in exits, so nobody arrives without consenting to the trip', () => {
    expect((wilderness as { exits?: unknown[] }).exits ?? []).toEqual([])
  })

  it('walls the line except at its gates', () => {
    const row = wilderness.collision[PVP_LINE_Z]
    const gaps = [...row].filter((c) => c === '.').length
    expect(gaps).toBeGreaterThan(0)
    // A wall with a handful of doors, not an open field.
    expect(gaps).toBeLessThan(wilderness.width / 4)
  })
})
