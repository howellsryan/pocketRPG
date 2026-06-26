import { describe, expect, it } from 'vitest'
import { getEffectiveToolActionTicks } from '../src/engine/skilling.js'
import { buildGatherTask, isClaimableTask, runIdleTask } from '../functions/_lib/mcp/intents.js'

function makeSave(overrides: any = {}) {
  return {
    stats: {},
    inventory: [],
    bank: {},
    equipment: {},
    settings: {},
    ...overrides,
  }
}

const maxedWoodcuttingStats = {
  woodcutting: { xp: 13_034_431 },
} as any

const makeInventory = (itemId: string) => [
  { itemId, quantity: 1 },
  ...Array(27).fill(null),
] as any

const axeItems = {
  bronze_axe: {
    id: 'bronze_axe',
    name: 'Bronze axe',
    toolFor: 'woodcutting',
    requirements: { woodcutting: 1 },
  },
  iron_axe: {
    id: 'iron_axe',
    name: 'Iron axe',
    toolFor: 'woodcutting',
    requirements: { woodcutting: 1 },
  },
  runeforged_axe: {
    id: 'runeforged_axe',
    name: 'Rune axe',
    toolFor: 'woodcutting',
    requirements: { woodcutting: 41 },
  },
  shardglass_axe: {
    id: 'shardglass_axe',
    name: 'Crystal axe',
    toolFor: 'woodcutting',
    requirements: { woodcutting: 71 },
  },
  third_age_axe: {
    id: 'third_age_axe',
    name: 'Third-age axe',
    toolFor: 'woodcutting',
    requirements: { woodcutting: 61 },
  },
} as any

describe('woodcutting axe effective action ticks', () => {
  it('keeps bronze at the base action time', () => {
    expect(getEffectiveToolActionTicks(
      'woodcutting',
      4,
      {},
      axeItems,
      maxedWoodcuttingStats,
      makeInventory('bronze_axe'),
    )).toBe(4)
  })

  it('makes iron faster than bronze but slower than rune on low-tick trees', () => {
    const bronzeTicks = getEffectiveToolActionTicks(
      'woodcutting',
      4,
      {},
      axeItems,
      maxedWoodcuttingStats,
      makeInventory('bronze_axe'),
    )

    const ironTicks = getEffectiveToolActionTicks(
      'woodcutting',
      4,
      {},
      axeItems,
      maxedWoodcuttingStats,
      makeInventory('iron_axe'),
    )

    const runeTicks = getEffectiveToolActionTicks(
      'woodcutting',
      4,
      {},
      axeItems,
      maxedWoodcuttingStats,
      makeInventory('runeforged_axe'),
    )

    expect(ironTicks).toBeLessThan(bronzeTicks)
    expect(runeTicks).toBeLessThan(ironTicks)
  })

  it('makes crystal and third-age axes halve normal 4-tick tree actions', () => {
    expect(getEffectiveToolActionTicks(
      'woodcutting',
      4,
      {},
      axeItems,
      maxedWoodcuttingStats,
      makeInventory('shardglass_axe'),
    )).toBe(2)

    expect(getEffectiveToolActionTicks(
      'woodcutting',
      4,
      {},
      axeItems,
      maxedWoodcuttingStats,
      makeInventory('third_age_axe'),
    )).toBe(2)
  })

  it('makes crystal and third-age axes the fastest on high-tick tree actions', () => {
    const runeTicks = getEffectiveToolActionTicks(
      'woodcutting',
      9,
      {},
      axeItems,
      maxedWoodcuttingStats,
      makeInventory('runeforged_axe'),
    )

    const crystalTicks = getEffectiveToolActionTicks(
      'woodcutting',
      9,
      {},
      axeItems,
      maxedWoodcuttingStats,
      makeInventory('shardglass_axe'),
    )

    const thirdAgeTicks = getEffectiveToolActionTicks(
      'woodcutting',
      9,
      {},
      axeItems,
      maxedWoodcuttingStats,
      makeInventory('third_age_axe'),
    )

    expect(crystalTicks).toBe(4)
    expect(thirdAgeTicks).toBe(4)
    expect(crystalTicks).toBeLessThan(runeTicks)
    expect(thirdAgeTicks).toBeLessThan(runeTicks)
  })
})

describe('bare-handed gathering (no tool)', () => {
  const pickaxeItems = {
    bronze_pickaxe: {
      id: 'bronze_pickaxe',
      name: 'Bronze pickaxe',
      toolFor: 'mining',
      requirements: { mining: 1 },
      speedMultiplier: 1.0,
    },
  } as any
  const minedStats = { mining: { xp: 13_034_431 } } as any

  it('woodcutting: bare-handed takes twice the base action time', () => {
    const barehandTicks = getEffectiveToolActionTicks(
      'woodcutting',
      4,
      {},
      axeItems,
      maxedWoodcuttingStats,
      [],
    )
    expect(barehandTicks).toBe(8)
    expect(barehandTicks).toBeGreaterThan(
      getEffectiveToolActionTicks('woodcutting', 4, {}, axeItems, maxedWoodcuttingStats, makeInventory('bronze_axe')),
    )
  })

  it('mining: bare-handed is slower than holding the basic pickaxe', () => {
    const barehandTicks = getEffectiveToolActionTicks('mining', 5, {}, pickaxeItems, minedStats, [])
    const bronzeTicks = getEffectiveToolActionTicks('mining', 5, {}, pickaxeItems, minedStats, makeInventory('bronze_pickaxe'))
    expect(barehandTicks).toBe(10)
    expect(bronzeTicks).toBe(5)
    expect(barehandTicks).toBeGreaterThan(bronzeTicks)
  })

  it('non-tool skills are unaffected by the bare-handed penalty', () => {
    expect(getEffectiveToolActionTicks('cooking', 4, {}, {}, {}, [])).toBe(4)
  })
})

describe('buildGatherTask — validation', () => {
  it('returns a valid gather task for a known id', () => {
    const task = buildGatherTask(makeSave(), 'gather_bowstring')
    expect(task.type).toBe('gather')
    expect(task.gatherTask.id).toBe('gather_bowstring')
    expect(task.gatherTask.product).toBe('bowstring')
  })

  it('throws for an unknown gather task id', () => {
    expect(() => buildGatherTask(makeSave(), 'nonexistent_task')).toThrow()
  })

  it('accepts gpCost tasks (log→plank sawmill conversions)', () => {
    const task = buildGatherTask(makeSave(), 'convert_log_to_plank')
    expect(task.type).toBe('gather')
    expect(task.gatherTask.gpCost).toBe(150)
  })
})

describe('isClaimableTask — gather support', () => {
  it('returns true for a normal gather task', () => {
    const task = { type: 'gather', gatherTask: { id: 'gather_bowstring' } }
    expect(isClaimableTask(task)).toBe(true)
  })

  it('returns false for a clue-scroll gather task', () => {
    const task = { type: 'gather', gatherTask: { id: 'fake_clue', isClue: true } }
    expect(isClaimableTask(task)).toBe(false)
  })

  it('returns false for a one-shot minigame gather task', () => {
    const task = { type: 'gather', gatherTask: { id: 'fake_minigame', oneShot: true } }
    expect(isClaimableTask(task)).toBe(false)
  })
})

describe('runIdleTask — gather type', () => {
  it('bowstring gather: stackable items coalesce in one slot', () => {
    const save = makeSave()
    // gather_bowstring: 6 ticks × 600ms = 3600ms per bowstring; 36000ms → 10 actions
    // bowstring is stackable in items.json, so all 10 land in one slot
    const task = buildGatherTask(save, 'gather_bowstring')
    const result = runIdleTask(save, task, 36_000)
    expect(result.applied).toBe(true)
    expect(result.actions).toBe(10)
    const slot = save.inventory.find((s: any) => s?.itemId === 'bowstring')
    expect(slot?.quantity).toBe(10)
  })

  it('non-stackable gather (bucket_of_sand): fills separate inventory slots', () => {
    const save = makeSave()
    // collect_sand: 3 ticks × 600ms = 1800ms each; 5400ms → 3 actions
    // bucket_of_sand is non-stackable in items.json, so each occupies its own slot
    const task = buildGatherTask(save, 'collect_sand')
    const result = runIdleTask(save, task, 5_400)
    expect(result.applied).toBe(true)
    expect(result.actions).toBe(3)
    const slots = save.inventory.filter((s: any) => s?.itemId === 'bucket_of_sand')
    expect(slots.length).toBe(3)
    expect(slots.every((s: any) => s.quantity === 1)).toBe(true)
  })

  it('gather with materials (burn_seaweed): consumes from bank', () => {
    const save = makeSave({ bank: { seaweed: { itemId: 'seaweed', quantity: 5 } } })
    // burn_seaweed: 3 ticks = 1800ms each; 9000ms → 5 actions, consuming 5 seaweed
    // soda_ash is non-stackable in items.json → 5 separate slots
    const task = buildGatherTask(save, 'burn_seaweed')
    const result = runIdleTask(save, task, 9_000)
    expect(result.applied).toBe(true)
    expect(result.actions).toBe(5)
    expect(save.bank.seaweed).toBeUndefined()
    const slots = save.inventory.filter((s: any) => s?.itemId === 'soda_ash')
    expect(slots.length).toBe(5)
  })

  it('log→plank conversion deducts gpCost coins and logs', () => {
    // 1 tick = 600ms each; 3000ms → 5 actions
    // gpCost 150 × 5 = 750 coins; 5 logs consumed; 5 planks gained
    const save = makeSave({
      inventory: [{ itemId: 'coins', quantity: 1000 }, ...Array(27).fill(null)],
      bank: { logs: { itemId: 'logs', quantity: 10 } },
    })
    const task = buildGatherTask(save, 'convert_log_to_plank')
    const result = runIdleTask(save, task, 3_000)
    expect(result.applied).toBe(true)
    expect(result.actions).toBe(5)
    // 750 coins deducted from inventory (1000 - 750 = 250)
    const coinSlot = save.inventory.find((s: any) => s?.itemId === 'coins')
    expect(coinSlot?.quantity).toBe(250)
    // 5 logs consumed from bank
    expect(save.bank.logs.quantity).toBe(5)
    // 5 planks in inventory (stackable)
    const plankSlot = save.inventory.find((s: any) => s?.itemId === 'plank')
    expect(plankSlot?.quantity).toBe(5)
  })

  it('log→plank conversion is capped by available coins', () => {
    // 300 coins → only 2 actions at 150gp each despite having time and logs
    const save = makeSave({
      bank: {
        coins: { itemId: 'coins', quantity: 300 },
        logs: { itemId: 'logs', quantity: 10 },
      },
    })
    const task = buildGatherTask(save, 'convert_log_to_plank')
    const result = runIdleTask(save, task, 30_000)
    expect(result.applied).toBe(true)
    expect(result.actions).toBe(2)
    expect(save.bank.coins).toBeUndefined()
  })
})
