import { describe, expect, it } from 'vitest'
import { calculatePvpRiskValues, getItemShopValue } from '../src/engine/pvpRisk.js'

const itemsData: any = {
  coins: { id: 'coins', tradeable: false, shopValue: 1 },
  whip: { id: 'whip', tradeable: true, shopValue: 1_500_000 },
  shark: { id: 'shark', tradeable: true, shopValue: 900 },
  fire_cape: { id: 'fire_cape', tradeable: false, shopValue: 50_000 },
}

describe('pvpRisk', () => {
  it('computes inventory-only value', () => {
    const out = calculatePvpRiskValues({
      inventory: [{ itemId: 'shark', quantity: 2 }],
      equipment: {},
      itemsData,
    })
    expect(out.inventoryShopValue).toBe(1_800)
    expect(out.equipmentShopValue).toBe(0)
    expect(out.totalShopValue).toBe(1_800)
  })

  it('computes equipment-only value', () => {
    const out = calculatePvpRiskValues({
      inventory: [],
      equipment: { weapon: { itemId: 'whip', quantity: 1 } },
      itemsData,
    })
    expect(out.inventoryShopValue).toBe(0)
    expect(out.equipmentShopValue).toBe(1_500_000)
    expect(out.totalShopValue).toBe(1_500_000)
  })

  it('multiplies by quantity and combines totals', () => {
    const out = calculatePvpRiskValues({
      inventory: [{ itemId: 'shark', quantity: 10 }],
      equipment: { weapon: { itemId: 'whip' } },
      itemsData,
    })
    expect(out.totalShopValue).toBe(1_509_000)
  })

  it('includes coins as a special case even if metadata says untradeable', () => {
    expect(getItemShopValue({ itemId: 'coins', quantity: 1234 }, itemsData)).toBe(1234)
  })

  it('excludes untradeables from risk totals', () => {
    const out = calculatePvpRiskValues({
      inventory: [{ itemId: 'fire_cape', quantity: 1 }],
      equipment: { cape: { itemId: 'fire_cape' } },
      itemsData,
    })
    expect(out.totalShopValue).toBe(0)
  })

  it('handles null and malformed slots defensively', () => {
    const out = calculatePvpRiskValues({
      inventory: [null, {}, { itemId: 'missing' }],
      equipment: { weapon: null, head: {} },
      itemsData,
    })
    expect(out.totalShopValue).toBe(0)
  })
})
