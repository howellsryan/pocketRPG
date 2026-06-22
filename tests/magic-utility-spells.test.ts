import { describe, it, expect } from 'vitest'
import skills from '../src/data/skills.json'
import items from '../src/data/items.json'
import { hasRequiredRunes, getRunesToConsume } from '../src/engine/runes.js'
import { simulateIdleSkilling } from '../src/engine/idleEngine.js'

const magicActions: any[] = (skills as any).magic.actions
const curse = magicActions.find((a) => a.id === 'curse')
const stun = magicActions.find((a) => a.id === 'stun')

describe('magic utility spell actions', () => {
  it('defines curse and stun with expected data and no product/material rewards', () => {
    expect(curse).toBeDefined()
    expect(curse.type).toBe('utility_spell')
    expect(curse.level).toBe(19)
    expect(curse.xp).toBe(29)
    expect(curse.runeReq.body_rune).toBe(1)
    expect(curse.runeReq.water_rune).toBe(2)
    expect(curse.runeReq.earth_rune).toBe(3)

    expect(stun).toBeDefined()
    expect(stun.type).toBe('utility_spell')
    expect(stun.level).toBe(80)
    expect(stun.xp).toBe(90)
    expect(stun.runeReq.soul_rune).toBe(1)
    expect(stun.runeReq.water_rune).toBe(12)
    expect(stun.runeReq.earth_rune).toBe(12)

    for (const action of [curse, stun]) {
      expect(action.product).toBeUndefined()
      expect(action.productQty).toBeUndefined()
      expect(action.materials).toBeUndefined()
      expect(action.dropTable).toBeUndefined()
      expect(action.coins).toBeUndefined()
      expect(action.coinsGained).toBeUndefined()
    }
  })

  it('references existing stackable rune items', () => {
    const runeIds = new Set([...Object.keys(curse.runeReq), ...Object.keys(stun.runeReq)])
    for (const runeId of runeIds) {
      const rune = (items as any)[runeId]
      expect(rune, `missing item ${runeId}`).toBeDefined()
      expect(rune.stackable, `${runeId} should be stackable`).toBe(true)
    }
  })

  it('has required runes across inventory + bank, and fails when body/soul is missing', () => {
    const inventory = [{ itemId: 'water_rune', quantity: 12 }, null]
    const bank = { body_rune: { quantity: 1 }, earth_rune: { quantity: 12 }, soul_rune: { quantity: 1 } }

    expect(hasRequiredRunes(curse.runeReq, inventory as any, bank as any, {} as any, items as any)).toBe(true)
    expect(hasRequiredRunes(stun.runeReq, inventory as any, bank as any, {} as any, items as any)).toBe(true)

    expect(hasRequiredRunes(curse.runeReq, inventory as any, { earth_rune: { quantity: 12 } } as any, {} as any, items as any)).toBe(false)
    expect(hasRequiredRunes(stun.runeReq, inventory as any, { earth_rune: { quantity: 12 } } as any, {} as any, items as any)).toBe(false)
  })

  it('getRunesToConsume only removes the elemental rune provided by a staff', () => {
    const equipment = { weapon: { itemId: 'staff_of_water' } }

    const curseConsume = getRunesToConsume(curse.runeReq, equipment as any, items as any)
    expect(curseConsume).toEqual({ body_rune: 1, earth_rune: 3 })

    const stunConsume = getRunesToConsume(stun.runeReq, equipment as any, items as any)
    expect(stunConsume).toEqual({ soul_rune: 1, earth_rune: 12 })
  })

  it('the Ancestral Wand covers air, water, earth and fire runes for every spell', () => {
    const equipment = { weapon: { itemId: 'ancestral_wand' } }

    // curse: body + water + earth → only the non-elemental body rune remains
    expect(getRunesToConsume(curse.runeReq, equipment as any, items as any)).toEqual({ body_rune: 1 })
    // stun: soul + water + earth → only the non-elemental soul rune remains
    expect(getRunesToConsume(stun.runeReq, equipment as any, items as any)).toEqual({ soul_rune: 1 })

    // With the elemental runes covered, only the catalytic runes are needed.
    const inventory = [{ itemId: 'body_rune', quantity: 1 }, { itemId: 'soul_rune', quantity: 1 }]
    expect(hasRequiredRunes(curse.runeReq, inventory as any, {} as any, equipment as any, items as any)).toBe(true)
    expect(hasRequiredRunes(stun.runeReq, inventory as any, {} as any, equipment as any, items as any)).toBe(true)
  })

  it('idle skilling caps on non-elemental runes, grants magic xp, and gives no products/coins', () => {
    const sim = simulateIdleSkilling(
      { skill: 'magic', action: curse } as any,
      60_000,
      { body_rune: { quantity: 3 }, earth_rune: { quantity: 100 }, water_rune: { quantity: 100 } } as any,
      {} as any,
      {} as any,
      items as any,
      Array(28).fill(null) as any,
    )

    expect(sim).toBeTruthy()
    expect(sim?.actions).toBe(3)
    expect(sim?.xpGained.magic).toBe(87)
    expect(sim?.itemsConsumed.body_rune).toBe(3)
    expect(sim?.itemsConsumed.water_rune).toBe(6)
    expect(sim?.itemsConsumed.earth_rune).toBe(9)
    expect(sim?.coinsGained).toBe(0)
    expect(Object.keys(sim?.itemsGained || {})).toEqual([])
    expect(Object.keys(sim?.itemsDropped || {})).toEqual([])
  })
})
