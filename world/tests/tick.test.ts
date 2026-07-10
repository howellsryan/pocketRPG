import { describe, expect, it } from 'vitest'
import {
  respawnedRocks,
  sessionInventoryFromSave,
  sessionStatsFromSave,
  tickPlayer,
  toEntityDiff,
  type RockState,
  type TickContext,
  type TickPlayer,
} from '../server/tick'
import { ROCK_DEPLETED_TICKS, emptyInventory } from '../server/mining'

function makePlayer(overrides: Partial<TickPlayer> = {}): TickPlayer {
  return {
    charId: '1',
    name: 'WorldTester',
    x: 0,
    z: 0,
    path: [],
    anim: 'idle',
    stats: { mining: { xp: 0, level: 1 } },
    inventory: emptyInventory(),
    pendingXp: {},
    minted: {},
    mining: null,
    pendingInteract: null,
    hp: 10,
    maxHp: 10,
    equipment: {},
    gear: {},
    combat: null,
    ...overrides,
  }
}

function makeRock(overrides: Partial<RockState> = {}): RockState {
  return { id: 'rock_tin_1', rock: 'tin', x: 1, z: 0, depletedUntilTick: 0, ...overrides }
}

function makeCtx(rock: RockState, tick = 1): TickContext {
  return { tick, rocks: new Map([[rock.id, rock]]) }
}

function mineIntent(rockId = 'rock_tin_1'): TickPlayer['pendingInteract'] {
  return { kind: 'rock', id: rockId, action: 'mine' }
}

describe('movement', () => {
  it('consumes one tile per tick and settles to idle once', () => {
    const player = makePlayer({ path: [{ x: 1, z: 0 }, { x: 2, z: 0 }] })
    const ctx = makeCtx(makeRock())

    expect(tickPlayer(player, ctx).entChanged).toBe(true)
    expect(player).toMatchObject({ x: 1, z: 0, anim: 'walk' })

    tickPlayer(player, ctx)
    expect(player).toMatchObject({ x: 2, z: 0, anim: 'walk', path: [] })

    expect(tickPlayer(player, ctx).entChanged).toBe(true)
    expect(player.anim).toBe('idle')
    expect(tickPlayer(player, ctx).entChanged).toBe(false)
  })
})

describe('mining', () => {
  it('runs a full cycle: 4 ticks -> ore + 17 xp + depleted rock', () => {
    const rock = makeRock()
    const player = makePlayer({ x: 0, z: 0, pendingInteract: mineIntent() })

    let events: ReturnType<typeof tickPlayer>['events'] = []
    let rockChanges: ReturnType<typeof tickPlayer>['rockChanges'] = []
    for (let tick = 1; tick <= 4; tick++) {
      const result = tickPlayer(player, makeCtx(rock, tick))
      events = events.concat(result.events)
      rockChanges = rockChanges.concat(result.rockChanges)
    }

    expect(player.inventory.filter((s) => s?.itemId === 'tin_ore')).toHaveLength(1)
    expect(player.minted.tin_ore).toBe(1)
    expect(player.stats.mining.xp).toBe(17)
    expect(player.pendingXp.mining).toBe(17)
    expect(events).toContainEqual({ e: 'xp', skill: 'mining', amount: 17 })
    expect(events.some((e) => e.e === 'inv')).toBe(true)
    expect(rockChanges).toContainEqual({ id: rock.id, depleted: true })
    expect(rock.depletedUntilTick).toBe(4 + ROCK_DEPLETED_TICKS)
  })

  it('waits out depletion and auto-continues on the same rock', () => {
    const rock = makeRock()
    const player = makePlayer({ pendingInteract: mineIntent() })
    let tick = 0
    const oreCount = () => player.inventory.filter((s) => s?.itemId === 'tin_ore').length

    for (tick = 1; tick <= 4; tick++) tickPlayer(player, makeCtx(rock, tick))
    expect(oreCount()).toBe(1)

    // Depletion window: mining latched but idle, no progress.
    for (; tick <= 4 + ROCK_DEPLETED_TICKS - 1; tick++) {
      tickPlayer(player, makeCtx(rock, tick))
      expect(player.anim).toBe('idle')
      expect(oreCount()).toBe(1)
    }

    for (; oreCount() < 2 && tick < 100; tick++) tickPlayer(player, makeCtx(rock, tick))
    expect(oreCount()).toBe(2)
    expect(player.mining).not.toBeNull()
  })

  it('refuses a rock above the player level', () => {
    const rock = makeRock()
    const player = makePlayer({ pendingInteract: mineIntent() })
    const ctx: TickContext = {
      ...makeCtx(rock),
      actions: { tin: { id: 'tin', name: 'Mine tin ore', level: 50, ticks: 4, xp: 17, product: 'tin_ore' } },
    }
    const result = tickPlayer(player, ctx)
    expect(result.events).toContainEqual({ e: 'msg', text: 'You need Mining level 50 to mine this rock.' })
    expect(player.mining).toBeNull()
  })

  it('stops with a message when the pack is full', () => {
    const rock = makeRock()
    const player = makePlayer({
      pendingInteract: mineIntent(),
      inventory: new Array(28).fill({ itemId: 'tin_ore', quantity: 1 }),
    })
    const result = tickPlayer(player, makeCtx(rock))
    expect(result.events).toContainEqual({ e: 'msg', text: 'Your pack is full.' })
    expect(player.mining).toBeNull()
  })

  it('stops when the player is no longer adjacent to the rock', () => {
    const rock = makeRock()
    const player = makePlayer({ pendingInteract: mineIntent() })
    tickPlayer(player, makeCtx(rock, 1))
    expect(player.mining).not.toBeNull()
    player.x = 5
    tickPlayer(player, makeCtx(rock, 2))
    expect(player.mining).toBeNull()
  })

  it('levels up in-session and reports it', () => {
    const rock = makeRock()
    // 83 xp = level 2; start close enough that one ore crosses the boundary.
    const player = makePlayer({ stats: { mining: { xp: 66, level: 1 } }, pendingInteract: mineIntent() })
    const events: ReturnType<typeof tickPlayer>['events'] = []
    for (let tick = 1; tick <= 4; tick++) events.push(...tickPlayer(player, makeCtx(rock, tick)).events)
    expect(player.stats.mining.level).toBe(2)
    expect(events).toContainEqual({ e: 'msg', text: "Congratulations, you've reached Mining level 2!" })
  })
})

describe('deposit', () => {
  it('signals a deposit on arrival at the chest', () => {
    const player = makePlayer({
      path: [{ x: 1, z: 1 }],
      pendingInteract: { kind: 'object', id: 'chest_1', action: 'deposit' },
    })
    const result = tickPlayer(player, makeCtx(makeRock()))
    expect(result.deposit).toBe(true)
    expect(player.pendingInteract).toBeNull()
  })
})

describe('respawnedRocks', () => {
  it('reports a respawn exactly when the window ends', () => {
    const rocks = new Map([
      ['a', makeRock({ id: 'a', depletedUntilTick: 10 })],
      ['b', makeRock({ id: 'b', depletedUntilTick: 12 })],
      ['c', makeRock({ id: 'c', depletedUntilTick: 0 })],
    ])
    expect(respawnedRocks(rocks, 10)).toEqual([{ id: 'a', depleted: false }])
    expect(respawnedRocks(rocks, 11)).toEqual([])
  })
})

describe('sessionInventoryFromSave', () => {
  it('seeds the pack from the save inventory and tallies save-backed units', () => {
    const { inventory, saveBacked } = sessionInventoryFromSave({
      inventory: [
        { itemId: 'tin_ore', quantity: 1 },
        { itemId: 'tin_ore', quantity: 1 },
        { itemId: 'coins', quantity: 250 },
        null,
        { itemId: '', quantity: 3 },
      ],
    })
    expect(inventory.filter(Boolean)).toEqual([
      { itemId: 'tin_ore', quantity: 1 },
      { itemId: 'tin_ore', quantity: 1 },
      { itemId: 'coins', quantity: 250 },
    ])
    expect(inventory).toHaveLength(28)
    expect(saveBacked).toEqual({ tin_ore: 2, coins: 250 })
  })

  it('returns an empty pack for a save with no inventory', () => {
    const { inventory, saveBacked } = sessionInventoryFromSave({})
    expect(inventory.every((s) => s === null)).toBe(true)
    expect(saveBacked).toEqual({})
  })
})

describe('sessionStatsFromSave', () => {
  it('copies xp and derives missing levels from xp', () => {
    const stats = sessionStatsFromSave({ stats: { mining: { xp: 83 }, attack: { xp: 0, level: 5 } } })
    expect(stats.mining).toEqual({ xp: 83, level: 2 })
    expect(stats.attack).toEqual({ xp: 0, level: 5 })
  })
})

describe('toEntityDiff', () => {
  it('maps a player to a wire-format entity diff', () => {
    const player = makePlayer({ x: 3, z: 4, anim: 'walk' })
    expect(toEntityDiff(player)).toEqual({
      id: '1', kind: 'player', x: 3, z: 4, anim: 'walk', name: 'WorldTester',
    })
  })
})
