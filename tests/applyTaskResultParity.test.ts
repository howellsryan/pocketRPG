// Parity guard: applyTaskResult must produce identical bank/inventory/XP/HP
// deltas regardless of which caller (MCP vs client) triggers it. Tests run the
// function directly with representative sim outputs for each task type and pin
// the expected state delta. A failing test means the shared module diverged from
// what the browser or MCP path used to compute — fix applyTaskResult, not the test.
import { describe, it, expect } from 'vitest'
import { applyTaskResult } from '../src/engine/applyTaskResult.js'
import { getLevelFromXP } from '../src/engine/experience.js'
import { runIdleTask, buildIdleTask, runCombatTask, buildCombatTask } from '../functions/_lib/mcp/intents.js'

function makeState(overrides: Record<string, any> = {}) {
  return {
    stats: {},
    inventory: new Array(28).fill(null) as any[],
    bank: {} as Record<string, any>,
    equipment: {} as Record<string, any>,
    settings: { dungeoneeringTokens: 0 } as Record<string, any>,
    ...overrides,
  }
}

describe('applyTaskResult — skill type', () => {
  it('applies XP and banks output; replaces inventory with finalInventory', () => {
    const state = makeState({
      stats: { firemaking: { xp: 0, level: 1 } },
      bank: { raw_shrimps: { itemId: 'raw_shrimps', quantity: 10 } },
    })
    const sim = {
      xpGained: { firemaking: 150 },
      itemsConsumed: { raw_shrimps: 5 },
      itemsBanked: { shrimps: 5 },
      finalInventory: [{ itemId: 'pickaxe', quantity: 1 }, ...new Array(27).fill(null)],
    }
    applyTaskResult(state, sim, 'skill')

    expect(state.stats.firemaking.xp).toBe(150)
    expect(state.stats.firemaking.level).toBe(getLevelFromXP(150))
    expect(state.bank.raw_shrimps.quantity).toBe(5)
    expect(state.bank.shrimps).toEqual({ itemId: 'shrimps', quantity: 5 })
    expect(state.inventory[0]).toMatchObject({ itemId: 'pickaxe', quantity: 1 })
  })

  it('initializes a missing skill rather than dropping its XP (MCP save-init regression)', () => {
    // A server-side (MCP-created) save may not have every skill seeded. The XP
    // must still land — previously it was silently dropped while the claim
    // result reported the gain, so levels never rose and requirements never
    // unlocked (the "stuck on Spryroot" bug).
    const state = makeState({ stats: { firemaking: { xp: 0, level: 1 } } })
    applyTaskResult(state, { xpGained: { firemaking: 100, agility: 999 } }, 'skill')
    expect(state.stats.firemaking.xp).toBe(100)
    expect(state.stats.agility).toEqual({ skill: 'agility', xp: 999, level: getLevelFromXP(999) })
  })

  it('caps XP at 200,000,000', () => {
    const state = makeState({ stats: { firemaking: { xp: 199_999_990, level: 99 } } })
    applyTaskResult(state, { xpGained: { firemaking: 100 } }, 'skill')
    expect(state.stats.firemaking.xp).toBe(200_000_000)
  })

  it('accumulates dungeoneeringTokens', () => {
    const state = makeState({ settings: { dungeoneeringTokens: 100 } })
    applyTaskResult(state, { xpGained: {}, dungeoneeringTokensGained: 50 }, 'skill')
    expect(state.settings.dungeoneeringTokens).toBe(150)
  })
})

describe('applyTaskResult — agility/thieving coins', () => {
  it('adds coins to empty inventory slot', () => {
    const state = makeState()
    applyTaskResult(state, { coinsGained: 100 }, 'agility')
    const slot = state.inventory.find((s: any) => s?.itemId === 'coins')
    expect(slot?.quantity).toBe(100)
  })

  it('coalesces with existing coins slot', () => {
    const inv = new Array(28).fill(null)
    inv[3] = { itemId: 'coins', quantity: 50 }
    const state = makeState({ inventory: inv })
    applyTaskResult(state, { coinsGained: 30 }, 'thieving')
    expect(state.inventory[3].quantity).toBe(80)
  })

  it('falls back to bank when inventory is full', () => {
    const inv = Array.from({ length: 28 }, (_, i) => ({ itemId: `item_${i}`, quantity: 1 }))
    const state = makeState({ inventory: inv })
    applyTaskResult(state, { coinsGained: 200 }, 'agility')
    expect(state.bank.coins?.quantity).toBe(200)
    expect(state.inventory.every((s: any) => s?.itemId !== 'coins')).toBe(true)
  })
})

describe('applyTaskResult — hunter rewards', () => {
  it('banks reward items', () => {
    const state = makeState()
    applyTaskResult(state, { xpGained: {}, rewards: [{ itemId: 'cowhide', quantity: 5 }] }, 'hunter')
    expect(state.bank.cowhide).toEqual({ itemId: 'cowhide', quantity: 5 })
  })

  it('accumulates with existing bank stock', () => {
    const state = makeState({ bank: { cowhide: { itemId: 'cowhide', quantity: 3 } } })
    applyTaskResult(state, { xpGained: {}, rewards: [{ itemId: 'cowhide', quantity: 2 }] }, 'hunter')
    expect(state.bank.cowhide.quantity).toBe(5)
  })
})

describe('applyTaskResult — combat type', () => {
  it('applies combat XP, HP, finalInventory, and lootBanked', () => {
    const finalInv = new Array(28).fill(null)
    finalInv[0] = { itemId: 'bones', quantity: 1 }
    const state = makeState({
      stats: {
        attack: { xp: 0, level: 1 },
        hitpoints: { xp: 1154, level: 10 },
      },
      settings: { currentHP: 10 },
    })
    const sim = {
      xpGained: { attack: 200, hitpoints: 66 },
      finalInventory: finalInv,
      lootBanked: { coins: 50 },
      finalHP: 8,
      died: false,
      monstersKilled: 1,
      itemsConsumed: {},
    }
    const result = applyTaskResult(state, sim, 'combat')
    expect(state.stats.attack.xp).toBe(200)
    expect(state.stats.hitpoints.xp).toBe(1154 + 66)
    expect(state.settings.currentHP).toBe(8)
    expect(state.inventory[0]).toMatchObject({ itemId: 'bones', quantity: 1 })
    expect(state.bank.coins?.quantity).toBe(50)
    expect(result.died).toBe(false)
    expect(result.finalHP).toBe(8)
    expect(result.monstersKilled).toBe(1)
  })

  it('resets HP to max on death, sets died flag', () => {
    const state = makeState({
      stats: { hitpoints: { xp: 1154, level: 10 } },
      settings: { currentHP: 10 },
    })
    const result = applyTaskResult(state, { xpGained: {}, finalInventory: [], lootBanked: {}, died: true, monstersKilled: 0 }, 'combat')
    expect(result.died).toBe(true)
    expect(result.finalHP).toBe(0)
    expect(state.settings.currentHP).toBe(10)  // reset to max
  })

  it('drains ammo when type matches', () => {
    const state = makeState({ equipment: { ammo: { itemId: 'bronze_arrow', quantity: 100 } } })
    applyTaskResult(state, { xpGained: {}, finalInventory: [], lootBanked: {}, died: false, ammoConsumed: { itemId: 'bronze_arrow', quantity: 15 } }, 'combat')
    expect(state.equipment.ammo.quantity).toBe(85)
  })

  it('nulls ammo slot when all ammo is consumed', () => {
    const state = makeState({ equipment: { ammo: { itemId: 'bronze_arrow', quantity: 10 } } })
    applyTaskResult(state, { xpGained: {}, finalInventory: [], lootBanked: {}, died: false, ammoConsumed: { itemId: 'bronze_arrow', quantity: 10 } }, 'combat')
    expect(state.equipment.ammo).toBeNull()
  })

  it('does not drain ammo when itemId does not match', () => {
    const state = makeState({ equipment: { ammo: { itemId: 'iron_arrow', quantity: 50 } } })
    applyTaskResult(state, { xpGained: {}, finalInventory: [], lootBanked: {}, died: false, ammoConsumed: { itemId: 'bronze_arrow', quantity: 10 } }, 'combat')
    expect(state.equipment.ammo.quantity).toBe(50)
  })

  it('drains weapon charges', () => {
    const state = makeState({ equipment: { weapon: { itemId: 'blighted_sword', charges: 200 } } })
    applyTaskResult(state, { xpGained: {}, finalInventory: [], lootBanked: {}, died: false, chargesConsumed: 50 }, 'combat')
    expect(state.equipment.weapon.charges).toBe(150)
  })
})

describe('applyTaskResult — itemsConsumed from bank', () => {
  it('deducts consumed items from bank', () => {
    const state = makeState({ bank: { raw_lobster: { itemId: 'raw_lobster', quantity: 10 } } })
    applyTaskResult(state, { xpGained: {}, itemsConsumed: { raw_lobster: 4 } }, 'skill')
    expect(state.bank.raw_lobster.quantity).toBe(6)
  })

  it('deletes bank slot when quantity drops to zero', () => {
    const state = makeState({ bank: { raw_lobster: { itemId: 'raw_lobster', quantity: 4 } } })
    applyTaskResult(state, { xpGained: {}, itemsConsumed: { raw_lobster: 4 } }, 'skill')
    expect(state.bank.raw_lobster).toBeUndefined()
  })

  it('ignores consumed items not in bank', () => {
    const state = makeState()
    applyTaskResult(state, { xpGained: {}, itemsConsumed: { missing_item: 5 } }, 'skill')
    expect(state.bank.missing_item).toBeUndefined()
  })
})

// `consumed` is the declared half of the item-loss ledger
// (src/engine/lossLedger.js). It must report what actually LEFT holdings, since
// over-declaring lets a real loss of the same item hide behind the excess.
describe('applyTaskResult — declared consumption', () => {
  it('reports what left the bank, capped by what it held', () => {
    const state = makeState({ bank: { raw_lobster: { itemId: 'raw_lobster', quantity: 3 } } })
    const result = applyTaskResult(state, { xpGained: {}, itemsConsumed: { raw_lobster: 10 } }, 'skill')
    expect(result.consumed).toEqual({ raw_lobster: 3 })
  })

  it('reports nothing for an item the bank never held', () => {
    const state = makeState()
    const result = applyTaskResult(state, { xpGained: {}, itemsConsumed: { missing_item: 5 } }, 'skill')
    expect(result.consumed).toEqual({})
  })

  it('reports ammo fired from the equipped stack', () => {
    const state = makeState({
      stats: { hitpoints: { xp: 1154, level: 10 } },
      equipment: { ammo: { itemId: 'rune_arrow', quantity: 100 } },
    })
    const result = applyTaskResult(
      state,
      { xpGained: {}, finalHP: 10, ammoConsumed: { itemId: 'rune_arrow', quantity: 250 } },
      'combat',
    )
    expect(result.consumed).toEqual({ rune_arrow: 100 })
  })
})

describe('applyTaskResult — quest type is a no-op', () => {
  it('does not apply XP for quest type (handled by applyQuestTask)', () => {
    const state = makeState({ stats: { slayer: { xp: 0, level: 1 } } })
    applyTaskResult(state, { xpGained: { slayer: 1000 } }, 'quest')
    expect(state.stats.slayer.xp).toBe(0)
  })
})

describe('MCP runIdleTask and runCombatTask use applyTaskResult', () => {
  it('skill task: XP and tokens flow through correctly', () => {
    const save = {
      stats: { dungeoneering: { xp: 0, level: 1 } },
      inventory: [] as any[],
      bank: {} as any,
      equipment: {} as any,
      settings: { dungeoneeringTokens: 0 } as any,
      coins: 0,
    }
    const task = buildIdleTask(save as any, 'dungeoneering', 'dungeoneering_floor_1')
    runIdleTask(save as any, task, 600_000)  // 1000 ticks = 2 floors
    expect(save.stats.dungeoneering.xp).toBe(2000)
    expect(save.settings.dungeoneeringTokens).toBe(300)
  })

  it('agility task: coins land in inventory', () => {
    const save = {
      stats: { agility: { xp: 0, level: 1 } },
      inventory: [] as any[],
      bank: {} as any,
      equipment: {} as any,
      settings: {} as any,
      coins: 0,
    }
    runIdleTask(save as any, buildIdleTask(save as any, 'agility', 'gnome_stronghold'), 240_000)
    const coinsSlot = save.inventory.find((s: any) => s?.itemId === 'coins')
    expect(coinsSlot?.quantity).toBeGreaterThan(0)
  })

  it('combat task: HP, XP, and loot all applied correctly', () => {
    const save = {
      stats: {
        attack: { xp: 1_000_000, level: 60 },
        strength: { xp: 1_000_000, level: 60 },
        defence: { xp: 1_000_000, level: 60 },
        hitpoints: { xp: 1_000_000, level: 60 },
        ranged: { xp: 0, level: 1 },
        magic: { xp: 0, level: 1 },
      },
      inventory: [] as any[],
      bank: {} as any,
      equipment: {} as any,
      settings: { currentHP: 60, idleCombatSetup: { food: [], potions: [], prayers: {} } } as any,
      coins: 0,
    }
    const r = runCombatTask(save as any, buildCombatTask(save as any, 'field_chicken', 'accurate'), 60_000)
    expect(r.applied).toBe(true)
    expect(r.died).toBe(false)
    expect(r.monstersKilled).toBeGreaterThan(0)
    expect(save.stats.attack.xp).toBeGreaterThan(1_000_000)
    expect(Number.isFinite(save.settings.currentHP)).toBe(true)
    expect(save.inventory.some((s: any) => s?.itemId === 'bones')).toBe(true)
  })
})
