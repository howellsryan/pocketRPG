import { describe, expect, it } from 'vitest'
import { filterBankSlots, isTapNotDrag } from '../client/src/bank'

describe('isTapNotDrag', () => {
  it('is a tap when the pointer barely moved', () => {
    expect(isTapNotDrag(100, 100, 100, 100)).toBe(true)
    expect(isTapNotDrag(100, 100, 105, 103)).toBe(true)
  })
  it('is a drag once movement exceeds the tap threshold', () => {
    expect(isTapNotDrag(100, 100, 100, 140)).toBe(false)
    expect(isTapNotDrag(100, 100, 150, 100)).toBe(false)
  })
})

describe('filterBankSlots', () => {
  const NAMES: Record<string, string> = {
    rune_scimitar: 'Rune Scimitar',
    air_rune: 'Air Rune',
    bronze_bar: 'Bronze Bar',
  }
  const nameOf = (id: string): string => NAMES[id] ?? id
  const slots = [
    { itemId: 'rune_scimitar', quantity: 1 },
    { itemId: 'air_rune', quantity: 500 },
    { itemId: 'bronze_bar', quantity: 12 },
  ]

  it('passes everything through on an empty query', () => {
    expect(filterBankSlots(slots, '', nameOf)).toEqual(slots)
    expect(filterBankSlots(slots, '   ', nameOf)).toEqual(slots)
  })

  it('matches a case-insensitive substring of the item name', () => {
    expect(filterBankSlots(slots, 'rune', nameOf)).toEqual([slots[0], slots[1]])
    expect(filterBankSlots(slots, 'RUNE', nameOf)).toEqual([slots[0], slots[1]])
    expect(filterBankSlots(slots, 'bronze', nameOf)).toEqual([slots[2]])
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterBankSlots(slots, 'dragon', nameOf)).toEqual([])
  })
})
