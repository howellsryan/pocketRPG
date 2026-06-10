import { describe, expect, it } from 'vitest'
import skills from '../src/data/skills.json'
import items from '../src/data/items.json'
import { PRODUCTION_SKILLS, STUB_SKILLS } from '../src/utils/constants.js'
import { canPerformAction, createSkillingState, processSkillingTick } from '../src/engine/skilling.js'
import { simulateIdleSkilling } from '../src/engine/idleEngine.js'

// Runecrafting grants 2× XP per action across the board.
const RUNES = [
  ['craft_air_rune', 1, 10.0, 'air_rune'],
  ['craft_mind_rune', 2, 11.0, 'mind_rune'],
  ['craft_water_rune', 5, 12.0, 'water_rune'],
  ['craft_earth_rune', 9, 13.0, 'earth_rune'],
  ['craft_fire_rune', 14, 14.0, 'fire_rune'],
  ['craft_body_rune', 20, 15.0, 'body_rune'],
  ['craft_cosmic_rune', 27, 16.0, 'cosmic_rune'],
  ['craft_chaos_rune', 35, 17.0, 'chaos_rune'],
  ['craft_astral_rune', 40, 17.4, 'astral_rune'],
  ['craft_nature_rune', 44, 18.0, 'nature_rune'],
  ['craft_law_rune', 54, 19.0, 'law_rune'],
  ['craft_death_rune', 65, 25.0, 'death_rune'],
  ['craft_blood_rune', 77, 30.0, 'blood_rune'],
  ['craft_soul_rune', 90, 35.0, 'soul_rune'],
  ['craft_wrath_rune', 95, 40.0, 'wrath_rune'],
] as const

describe('runecrafting enablement and data', () => {
  it('is in production skills and not in stub skills', () => {
    expect(PRODUCTION_SKILLS).toContain('runecraft')
    expect(STUB_SKILLS.has('runecraft')).toBe(false)
    expect((skills as any).runecraft?.actions?.length).toBeGreaterThan(0)
  })

  it('has expected runecrafting actions', () => {
    const actions = (skills as any).runecraft.actions
    for (const [id, level, xp, product] of RUNES) {
      const action = actions.find((a: any) => a.id === id)
      expect(action, `${id} missing`).toBeTruthy()
      expect(action.level).toBe(level)
      expect(action.xp).toBe(xp)
      expect(action.materials).toEqual({ rune_essence: 1 })
      expect(action.product).toBe(product)
      expect(action.productQty).toBe(1)
      expect(action.ticks).toBe(2)
    }
  })

  it('has rune essence item and all rune products defined stackable', () => {
    expect((items as any).rune_essence).toBeTruthy()
    // Rune essence is mined or player-traded, not General Store stock
    // (the curated store list covers crafted runes, not essence).
    expect((items as any).rune_essence.isGeneralStore).toBe(false)
    expect((items as any).rune_essence.stackable).toBe(true)

    for (const [, , , product] of RUNES) {
      expect((items as any)[product], `${product} missing`).toBeTruthy()
      expect((items as any)[product].stackable, `${product} not stackable`).toBe(true)
    }
  })

  it('adds mine rune essence action to mining', () => {
    const mineAction = (skills as any).mining.actions.find((a: any) => a.id === 'rune_essence')
    expect(mineAction).toBeTruthy()
    expect(mineAction.name).toBe('Mine rune essence')
    expect(mineAction.level).toBe(1)
    expect(mineAction.xp).toBe(5)
    expect(mineAction.product).toBe('rune_essence')
  })

  it('canPerformAction requires rune essence in inventory or bank', () => {
    const action = (skills as any).runecraft.actions[0]
    expect(canPerformAction(action, 0, [], items as any, {}, 'runecraft').can).toBe(false)
    expect(canPerformAction(action, 0, [{ itemId: 'rune_essence', quantity: 1 }] as any, items as any, {}, 'runecraft').can).toBe(true)
    expect(canPerformAction(action, 0, [] as any, items as any, { rune_essence: { quantity: 1 } } as any, 'runecraft').can).toBe(true)
  })

  it('processSkillingTick completes runecrafting action on configured duration', () => {
    const action = (skills as any).runecraft.actions[0]
    let state = createSkillingState('runecraft', action)
    let completed = false
    for (let i = 0; i < action.ticks; i++) {
      const result = processSkillingTick(state)
      state = result.skillingState
      completed = completed || result.events.some((e: any) => e.type === 'actionComplete')
    }
    expect(completed).toBe(true)
  })
})

describe('runecrafting idle simulation', () => {
  it('caps actions by available rune essence and grants expected xp/items', () => {
    const action = (skills as any).runecraft.actions.find((a: any) => a.id === 'craft_air_rune')
    const sim = simulateIdleSkilling({ skill: 'runecraft', action } as any, 60_000, {}, {}, {}, items as any, [{ itemId: 'rune_essence', quantity: 10 }, ...Array(27).fill(null)] as any)
    expect(sim?.actions).toBe(10)
    expect(sim?.xpGained.runecraft).toBe(100)
    const gained = (sim?.itemsGained.air_rune || 0) + (sim?.itemsBanked.air_rune || 0)
    expect(gained).toBe(10)
    expect(sim?.finalInventory.find((s: any) => s?.itemId === 'rune_essence')).toBeFalsy()
  })

  it('returns null with no rune essence', () => {
    const action = (skills as any).runecraft.actions.find((a: any) => a.id === 'craft_air_rune')
    const sim = simulateIdleSkilling({ skill: 'runecraft', action } as any, 60_000, {}, {}, {}, items as any, Array(28).fill(null) as any)
    expect(sim).toBeNull()
  })

  it('caps partial rune essence correctly', () => {
    const action = (skills as any).runecraft.actions.find((a: any) => a.id === 'craft_air_rune')
    const sim = simulateIdleSkilling({ skill: 'runecraft', action } as any, 60_000, {}, {}, {}, items as any, [{ itemId: 'rune_essence', quantity: 3 }, ...Array(27).fill(null)] as any)
    expect(sim?.actions).toBe(3)
    expect(sim?.xpGained.runecraft).toBe(30)
  })

  it('runecraft action ids are unique and no duplicate item ids exist', () => {
    const ids = (skills as any).runecraft.actions.map((a: any) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    const itemIds = Object.keys(items as any)
    expect(new Set(itemIds).size).toBe(itemIds.length)
  })
})
