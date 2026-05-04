import { describe, expect, it } from 'vitest'
import { calculatePvpRiskValues, getItemShopValue } from '../src/engine/pvpRisk.js'

const itemsData: any = {
  coins: { id: 'coins', isUntradeable: true, shopValue: 0 },
  whip: { id: 'whip', shopValue: 1_500_000 },
  shark: { id: 'shark', shopValue: 900 },
  fire_cape: { id: 'fire_cape', isUntradeable: true, shopValue: 50_000 },
  dragon_defender: { id: 'dragon_defender', isUntradeable: true, shopValue: 1 },
}

describe('pvpRisk', () => {
  it('computes inventory-only value', () => {
    const out = calculatePvpRiskValues({ inventory: [{ itemId: 'shark', quantity: 2 }], equipment: {}, itemsData })
    expect(out.inventoryShopValue).toBe(1_800)
    expect(out.equipmentShopValue).toBe(0)
    expect(out.totalShopValue).toBe(1_800)
  })

  it('computes equipment-only value', () => {
    const out = calculatePvpRiskValues({ inventory: [], equipment: { weapon: { itemId: 'whip', quantity: 1 } }, itemsData })
    expect(out.inventoryShopValue).toBe(0)
    expect(out.equipmentShopValue).toBe(1_500_000)
    expect(out.totalShopValue).toBe(1_500_000)
  })

  it('multiplies by quantity and combines totals', () => {
    const out = calculatePvpRiskValues({ inventory: [{ itemId: 'shark', quantity: 10 }], equipment: { weapon: { itemId: 'whip' } }, itemsData })
    expect(out.totalShopValue).toBe(1_509_000)
  })

  it('includes coins as a special case even if metadata says untradeable', () => {
    expect(getItemShopValue({ itemId: 'coins', quantity: 1234 }, itemsData)).toBe(1234)
  })

  it('includes untradeables based on PvP coin-replacement value', () => {
    const out = calculatePvpRiskValues({ inventory: [{ itemId: 'fire_cape', quantity: 1 }], equipment: { cape: { itemId: 'fire_cape' } }, itemsData })
    expect(out.totalShopValue).toBe(100_000)
  })

  it('uses fixed 5m risk for minigame unlock untradeables', () => {
    const out = calculatePvpRiskValues({ inventory: [{ itemId: 'dragon_defender', quantity: 1 }], equipment: {}, itemsData })
    expect(out.totalShopValue).toBe(5_000_000)
  })

  it('handles null and malformed slots defensively', () => {
    const out = calculatePvpRiskValues({ inventory: [null, {}, { itemId: 'missing' }], equipment: { weapon: null, head: {} }, itemsData })
    expect(out.totalShopValue).toBe(0)
  })
})
