import { describe, it, expect } from 'vitest'
import skillsData from '../src/data/skills.json'

const magicActions: any[] = (skillsData as any).magic.actions

describe('Magic enchant action material integrity', () => {
  it('enchant jewel actions consume base jewellery via materials', () => {
    const jewelActions = magicActions.filter((a) => a.type === 'enchant_jewel')
    expect(jewelActions.length).toBeGreaterThan(0)
    for (const action of jewelActions) {
      expect(action.itemReq, `${action.id} should not use itemReq`).toBeUndefined()
      expect(action.materials, `${action.id} should define materials`).toBeDefined()
      const mats = Object.entries(action.materials || {})
      expect(mats.length, `${action.id} should consume exactly one base item`).toBe(1)
      expect(mats[0][1], `${action.id} should consume one base item`).toBe(1)
    }
  })

  it('enchant bolts actions consume and produce matching quantities', () => {
    const boltActions = magicActions.filter((a) => a.type === 'enchant_bolts')
    expect(boltActions.length).toBeGreaterThan(0)
    for (const action of boltActions) {
      const mats = Object.entries(action.materials || {})
      expect(mats.length, `${action.id} should consume exactly one bolt type`).toBe(1)
      const inputQty = Number(mats[0][1])
      const outputQty = Number(action.productQty || 1)
      expect(inputQty, `${action.id} must consume same quantity it produces`).toBe(outputQty)
      expect(action.runeReq && Object.keys(action.runeReq).length > 0, `${action.id} requires runes`).toBe(true)
    }
  })
})
