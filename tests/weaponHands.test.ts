import { describe, it, expect } from 'vitest'
import itemsData from '../src/data/items.json'

const items = itemsData as Record<string, { name?: string; slot?: string; twoHanded?: boolean }>

describe('weapon hand requirements', () => {
  it('Dragon Claws are two-handed', () => {
    expect(items.dragon_claws.twoHanded).toBe(true)
  })

  const oneHandedStaves = [
    'morvyn_s_staff',
    'duskmare_staff',
    'umbral_duskmare_staff',
    'attuned_duskmare_staff',
    'volatile_duskmare_staff'
  ]

  it.each(oneHandedStaves)('%s is one-handed', (id) => {
    expect(items[id].slot).toBe('weapon')
    expect(items[id].twoHanded).toBe(false)
  })
})
