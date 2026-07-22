import { afterEach, describe, expect, it, vi } from 'vitest'
import { tickPlayer, type StationState, type TickContext, type TickPlayer } from '../server/tick'
import { emptyInventory, countItem } from '../server/mining'
import { BURNT_FOOD_ITEM, BURN_XP, craftOnce, hasMaterials, maxCraftable } from '../server/crafting'
import { STATIONS, recipeFor, stationTypeForVerb } from '../shared/recipes'
import type { InvSlot } from '../shared/protocol'

const SMELT_BRONZE = recipeFor('furnace', 'smelt_bronze')!
const SMITH_SCIMITAR = recipeFor('anvil', 'smith_bronze_scimitar')!
const COOK_MEAT = recipeFor('range', 'cook_meat')!

function makePlayer(overrides: Partial<TickPlayer> = {}): TickPlayer {
  return {
    charId: '1',
    name: 'WorldTester',
    x: 4,
    z: 4,
    path: [],
    anim: 'idle',
    stats: { smithing: { xp: 0, level: 1 }, cooking: { xp: 0, level: 1 } },
    inventory: emptyInventory(),
    pendingXp: {},
    minted: {},
    mining: null,
    crafting: null,
    spell: null,
    pendingInteract: null,
    hp: 10,
    maxHp: 10,
    equipment: {},
    gear: {},
    combat: null,
    running: false,
    runEnergy: 100,
    lastRunSent: 100,
    stance: 'accurate',
    specialEnergy: 100,
    lastSpecSent: 100, lastSpecQueuedSent: false, pendingSpecial: false, prayerPoints: 1, maxPrayerPoints: 1, prayerDrainAccumulator: 0, activeProtectionPrayer: null, activeCombatPrayer: null, lastPrayerSent: null, activePotions: {}, following: null, followTargetTile: null,
    ...overrides,
  }
}

function stationCtx(station: StationState, tick = 1): TickContext {
  return { tick, rocks: new Map(), stations: new Map([[station.id, station]]) }
}

const FURNACE: StationState = { id: 'furnace_1', type: 'furnace', x: 5, z: 4 }
const RANGE: StationState = { id: 'range_1', type: 'range', x: 5, z: 4 }

function fill(inventory: InvSlot[], items: [string, number][]): void {
  let i = 0
  for (const [itemId, quantity] of items) inventory[i++] = { itemId, quantity }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('recipe tables', () => {
  it('come entirely from skills.json, split by station', () => {
    expect(STATIONS.furnace.recipes.every((r) => r.id.startsWith('smelt_'))).toBe(true)
    expect(STATIONS.anvil.recipes.length).toBeGreaterThan(50)
    expect(STATIONS.anvil.recipes.every((r) => !r.id.startsWith('smelt_'))).toBe(true)
    expect(STATIONS.range.recipes.every((r) => r.burnStopLevel)).toBe(true)
    expect(SMELT_BRONZE.materials).toEqual({ tin_ore: 1, copper_ore: 1 })
  })

  it('maps interact verbs to station types', () => {
    expect(stationTypeForVerb('smelt')).toBe('furnace')
    expect(stationTypeForVerb('smith')).toBe('anvil')
    expect(stationTypeForVerb('cook')).toBe('range')
    expect(stationTypeForVerb('bank')).toBeNull()
  })
})

describe('craftOnce', () => {
  it('consumes every material and adds the product', () => {
    const inventory = emptyInventory()
    fill(inventory, [['tin_ore', 2], ['copper_ore', 2]])
    const outcome = craftOnce(inventory, SMELT_BRONZE, 1)
    expect(outcome).toMatchObject({ ok: true, product: 'bronze_bar', burnt: false, xp: SMELT_BRONZE.xp })
    expect(countItem(inventory, 'tin_ore')).toBe(1)
    expect(countItem(inventory, 'copper_ore')).toBe(1)
    expect(countItem(inventory, 'bronze_bar')).toBe(1)
  })

  it('consumes multi-quantity materials (2 bars per scimitar)', () => {
    const inventory = emptyInventory()
    fill(inventory, [['bronze_bar', 3]])
    const outcome = craftOnce(inventory, SMITH_SCIMITAR, 4)
    expect(outcome).toMatchObject({ ok: true, product: 'bronze_scimitar' })
    expect(countItem(inventory, 'bronze_bar')).toBe(1)
  })

  it('fails without materials, leaving the pack untouched', () => {
    const inventory = emptyInventory()
    fill(inventory, [['tin_ore', 1]])
    expect(craftOnce(inventory, SMELT_BRONZE, 1)).toEqual({ ok: false, reason: 'materials' })
    expect(countItem(inventory, 'tin_ore')).toBe(1)
  })

  it('rolls the pack back when the product does not fit', () => {
    // Full pack of a stackable material: removing one unit frees no slot, so a
    // non-stackable product has nowhere to go.
    const inventory = emptyInventory()
    for (let i = 0; i < 27; i++) inventory[i] = { itemId: 'bones', quantity: 1 }
    inventory[27] = { itemId: 'bronze_bar', quantity: 5 }
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const outcome = craftOnce(inventory, SMITH_SCIMITAR, 99)
    expect(outcome).toEqual({ ok: false, reason: 'space' })
    expect(countItem(inventory, 'bronze_bar')).toBe(5)
    expect(countItem(inventory, 'bones')).toBe(27)
  })

  it('burns food below burnStopLevel via the real engine roll', () => {
    const inventory = emptyInventory()
    fill(inventory, [['raw_beef', 2]])
    vi.spyOn(Math, 'random').mockReturnValue(0) // always burn
    const burnt = craftOnce(inventory, COOK_MEAT, 1)
    expect(burnt).toMatchObject({ ok: true, product: BURNT_FOOD_ITEM, burnt: true, xp: BURN_XP })
    vi.spyOn(Math, 'random').mockReturnValue(0.999) // never burn
    const cooked = craftOnce(inventory, COOK_MEAT, 1)
    expect(cooked).toMatchObject({ ok: true, product: 'cooked_meat', burnt: false, xp: COOK_MEAT.xp })
    expect(countItem(inventory, 'raw_beef')).toBe(0)
  })

  it('never burns at or above burnStopLevel', () => {
    const inventory = emptyInventory()
    fill(inventory, [['raw_beef', 1]])
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const outcome = craftOnce(inventory, COOK_MEAT, COOK_MEAT.burnStopLevel!)
    expect(outcome).toMatchObject({ ok: true, product: 'cooked_meat', burnt: false })
  })
})

describe('maxCraftable / hasMaterials', () => {
  it('clamps to the scarcest material', () => {
    const inventory = emptyInventory()
    fill(inventory, [['tin_ore', 5], ['copper_ore', 2]])
    expect(maxCraftable(inventory, SMELT_BRONZE)).toBe(2)
    fill(inventory, [['bronze_bar', 5]])
    expect(maxCraftable(inventory, SMITH_SCIMITAR)).toBe(2)
    expect(hasMaterials(emptyInventory(), SMELT_BRONZE)).toBe(false)
  })
})

describe('tickCrafting via tickPlayer', () => {
  it('produces one bar per ticks-cycle, minting products and granting XP', () => {
    const player = makePlayer()
    fill(player.inventory, [['tin_ore', 2], ['copper_ore', 2]])
    player.crafting = { station: 'furnace', stationId: FURNACE.id, recipeId: 'smelt_bronze', remaining: 2, progress: 0 }
    const ctx = stationCtx(FURNACE)

    const consumed: Record<string, number>[] = []
    let xpEvents = 0
    for (let i = 0; i < SMELT_BRONZE.ticks * 2; i++) {
      const result = tickPlayer(player, ctx)
      consumed.push(...result.consumed)
      xpEvents += result.events.filter((e) => e.e === 'xp').length
      if (i < SMELT_BRONZE.ticks * 2 - 1) expect(player.anim).toBe('mine')
    }
    expect(player.anim).toBe('idle')
    expect(player.crafting).toBeNull()
    expect(countItem(player.inventory, 'bronze_bar')).toBe(2)
    expect(player.minted.bronze_bar).toBe(2)
    expect(consumed).toEqual([{ tin_ore: 1, copper_ore: 1 }, { tin_ore: 1, copper_ore: 1 }])
    expect(xpEvents).toBe(2)
    expect(player.stats.smithing.xp).toBe(SMELT_BRONZE.xp * 2)
    expect(player.pendingXp.smithing).toBe(SMELT_BRONZE.xp * 2)
  })

  it('stops with a message when materials run out mid-run', () => {
    const player = makePlayer()
    fill(player.inventory, [['tin_ore', 1], ['copper_ore', 1]])
    player.crafting = { station: 'furnace', stationId: FURNACE.id, recipeId: 'smelt_bronze', remaining: 5, progress: 0 }
    const ctx = stationCtx(FURNACE)

    let sawMsg = false
    for (let i = 0; i < SMELT_BRONZE.ticks; i++) {
      const result = tickPlayer(player, ctx)
      sawMsg ||= result.events.some((e) => e.e === 'msg' && e.text === 'You have run out of materials.')
    }
    expect(countItem(player.inventory, 'bronze_bar')).toBe(1)
    expect(sawMsg).toBe(true)
    expect(player.crafting).toBeNull()
  })

  it('cancels when the player is no longer adjacent to the station', () => {
    const player = makePlayer({ x: 10, z: 10 })
    fill(player.inventory, [['tin_ore', 1], ['copper_ore', 1]])
    player.crafting = { station: 'furnace', stationId: FURNACE.id, recipeId: 'smelt_bronze', remaining: 1, progress: 0 }
    tickPlayer(player, stationCtx(FURNACE))
    expect(player.crafting).toBeNull()
    expect(player.anim).toBe('idle')
  })

  it('burn grants 1 XP and burnt food, with the burn message', () => {
    const player = makePlayer()
    fill(player.inventory, [['raw_beef', 1]])
    player.crafting = { station: 'range', stationId: RANGE.id, recipeId: 'cook_meat', remaining: 1, progress: 0 }
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const ctx = stationCtx(RANGE)
    let events: string[] = []
    for (let i = 0; i < COOK_MEAT.ticks; i++) {
      const result = tickPlayer(player, ctx)
      events = events.concat(result.events.filter((e) => e.e === 'msg').map((e) => (e as { text: string }).text))
    }
    expect(countItem(player.inventory, BURNT_FOOD_ITEM)).toBe(1)
    expect(player.minted[BURNT_FOOD_ITEM]).toBe(1)
    expect(player.stats.cooking.xp).toBe(BURN_XP)
    expect(events).toContain('You accidentally burn the food.')
  })

  it('station arrival intent opens the recipe panel', () => {
    const player = makePlayer({ x: 4, z: 4 })
    player.pendingInteract = { kind: 'object', id: FURNACE.id, action: 'smelt' }
    const result = tickPlayer(player, stationCtx(FURNACE))
    expect(result.stationOpen).toBe('furnace')
  })
})
