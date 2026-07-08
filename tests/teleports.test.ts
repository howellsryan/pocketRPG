import { describe, it, expect } from 'vitest'
import { getTeleport, teleportCheck, deductRunes, formatRuneCost } from '../src/engine/teleports.js'
import world from '../src/data/world.json'
import items from '../src/data/items.json'

const PLACES = Object.values(world.places) as any[]
const inv = (...stacks: Array<[string, number]>) => {
  const slots: any[] = new Array(28).fill(null)
  stacks.forEach(([itemId, quantity], i) => { slots[i] = { itemId, quantity } })
  return slots
}
const VARRICK = getTeleport('varrick')! // level 25 — 1 law, 3 air, 1 fire

describe('teleport data', () => {
  it('every place has a castable teleport whose runes exist', () => {
    for (const p of PLACES) {
      const tp = p.teleport
      expect(tp, p.id).toBeTruthy()
      expect(tp.level, p.id).toBeGreaterThanOrEqual(1)
      expect(tp.level, p.id).toBeLessThanOrEqual(99)
      expect(tp.xp, p.id).toBeGreaterThan(0)
      expect(tp.runes.law_rune, `${p.id} needs law runes`).toBeGreaterThanOrEqual(1)
      for (const runeId of Object.keys(tp.runes)) {
        expect((items as any)[runeId], `${p.id} references ${runeId}`).toBeTruthy()
      }
    }
  })

  it('cities are low-level, towns higher, villages highest', () => {
    const levels = (tier: string) => PLACES.filter((p) => p.tier === tier).map((p) => p.teleport.level)
    expect(Math.max(...levels('city'))).toBeLessThan(Math.min(...levels('town')))
    expect(Math.max(...levels('town'))).toBeLessThan(Math.min(...levels('village')))
  })

  it('Varrick matches the design spec: Magic 25, 1 law + 3 air + 1 fire', () => {
    expect(VARRICK.level).toBe(25)
    expect(VARRICK.runes).toEqual({ law_rune: 1, air_rune: 3, fire_rune: 1 })
  })
})

describe('teleportCheck', () => {
  const ctx = (over: Record<string, unknown> = {}) => ({
    magicLevel: 99,
    inventory: inv(['law_rune', 10], ['air_rune', 10], ['fire_rune', 10]),
    bank: {},
    equipment: null,
    itemsData: items as any,
    ...over,
  })

  it('passes with the level and runes in inventory', () => {
    expect(teleportCheck('varrick', ctx()).ok).toBe(true)
  })

  it('blocks below the Magic requirement', () => {
    const res = teleportCheck('varrick', ctx({ magicLevel: 24 }))
    expect(res.ok).toBe(false)
    expect(res.reason).toContain('Magic 25')
  })

  it('blocks when runes are short, naming the missing rune', () => {
    const res = teleportCheck('varrick', ctx({ inventory: inv(['law_rune', 1], ['air_rune', 2], ['fire_rune', 1]) }))
    expect(res.ok).toBe(false)
    expect(res.reason).toContain('Air Rune')
  })

  it('counts bank runes toward the cost', () => {
    const res = teleportCheck('varrick', ctx({
      inventory: inv(['law_rune', 1]),
      bank: { air_rune: { quantity: 3 }, fire_rune: { quantity: 1 } },
    }))
    expect(res.ok).toBe(true)
  })

  it('an equipped elemental staff supplies its element for free', () => {
    const staff = Object.values(items as any).find((i: any) => i.elemental === 'air_rune') as any
    expect(staff).toBeTruthy()
    const res = teleportCheck('varrick', ctx({
      inventory: inv(['law_rune', 1], ['fire_rune', 1]),
      equipment: { weapon: { itemId: staff.id } },
    }))
    expect(res.ok).toBe(true)
    expect(res.runes.air_rune).toBeUndefined()
  })

  it('rejects a place with no teleport', () => {
    expect(teleportCheck('atlantis', ctx()).ok).toBe(false)
  })
})

describe('deductRunes', () => {
  it('takes from inventory first, then the bank as negative deltas', () => {
    const inventory = inv(['law_rune', 1], ['air_rune', 2])
    const res = deductRunes(VARRICK.runes, inventory)!
    expect(res.inventory.filter(Boolean)).toEqual([]) // 1 law + 2 air fully consumed
    expect(res.bankUpdates).toEqual({ air_rune: -1, fire_rune: -1 })
    // and the input inventory is untouched
    expect(inventory[0]).toEqual({ itemId: 'law_rune', quantity: 1 })
  })

  it('leaves no bank updates when inventory covers everything', () => {
    const res = deductRunes(VARRICK.runes, inv(['law_rune', 5], ['air_rune', 5], ['fire_rune', 5]))!
    expect(res.bankUpdates).toEqual({})
    expect(res.inventory.filter(Boolean)).toEqual([
      { itemId: 'law_rune', quantity: 4 },
      { itemId: 'air_rune', quantity: 2 },
      { itemId: 'fire_rune', quantity: 4 },
    ])
  })
})

describe('formatRuneCost', () => {
  it('renders a compact cost string without the Rune suffix', () => {
    expect(formatRuneCost(VARRICK.runes, items as any)).toBe('1× Law, 3× Air, 1× Fire')
  })
})
