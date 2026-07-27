// Attack-speed invariants per weapon family. Derived from items.json by item
// kind, not from a hand-kept list, so adding a new crossbow or shortbow at the
// wrong speed fails here instead of shipping.
import { describe, it, expect } from 'vitest'
import items from '../src/data/items.json'
import { kindOf } from '../src/utils/armoury.js'

const itemsData = items as Record<string, any>
const weaponsOfKind = (kind: string) =>
  Object.values(itemsData).filter(i => i?.slot === 'weapon' && kindOf(i) === kind)

describe('ranged weapon families', () => {
  it('fires every bolt-loading crossbow on 4 ticks', () => {
    const crossbows = weaponsOfKind('Crossbow').filter(i => i.ammoType === 'bolt')
    expect(crossbows.length).toBeGreaterThan(5)
    for (const bow of crossbows) expect([bow.id, bow.attackSpeed]).toEqual([bow.id, 4])
  })

  it("leaves Kaelor's Crossbow faster still — it loads no ammo and is a set piece", () => {
    expect(itemsData.kaelor_s_crossbow.attackSpeed).toBe(3)
    expect(itemsData.kaelor_s_crossbow.ammoType).toBeUndefined()
  })

  it('fires every shortbow on 3 ticks, a tick ahead of the crossbows', () => {
    const shortbows = weaponsOfKind('Shortbow')
    expect(shortbows.length).toBeGreaterThan(5)
    for (const bow of shortbows) expect([bow.id, bow.attackSpeed]).toEqual([bow.id, 3])
  })

  it('leaves longbows slow — the shortbow change did not touch them', () => {
    for (const bow of weaponsOfKind('Longbow')) expect(bow.attackSpeed).toBeGreaterThanOrEqual(4)
  })
})

describe('Duskmare staves', () => {
  it('keeps the Attuned staff exactly one tick ahead of every other Duskmare staff', () => {
    expect(itemsData.attuned_duskmare_staff.attackSpeed).toBe(3)
    for (const id of ['duskmare_staff', 'umbral_duskmare_staff', 'volatile_duskmare_staff']) {
      expect(itemsData[id].attackSpeed).toBe(4)
    }
    expect(itemsData.attuned_duskmare_staff.description).toContain('one tick faster')
  })
})

describe('powered staves', () => {
  it('swings the Trident of Venom and the Sanguine Staff every 4 ticks', () => {
    expect(itemsData.trident_of_venom.attackSpeed).toBe(4)
    expect(itemsData.sanguine_staff.attackSpeed).toBe(4)
  })
})

describe('Chaotic weapons', () => {
  it('casts with the Chaotic Staff every 4 ticks, matching the powered staves', () => {
    expect(itemsData.chaotic_staff.attackSpeed).toBe(4)
  })
})
