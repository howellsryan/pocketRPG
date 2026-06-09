import { describe, it, expect } from 'vitest'
import skillsData from '../src/data/skills.json'
import { hasRequiredRunes } from '../src/engine/runes.js'

const magicActions: any[] = (skillsData as any).magic.actions

// Group definitions matching MagicScreen.jsx TYPE_GROUPS
const TYPE_GROUPS = [
  { types: ['utility_spell'], label: 'Utility Spells' },
  { types: ['alchemy'], label: 'Alchemy' },
  { types: ['superheat'], label: 'Superheat' },
  { types: ['enchant_jewel'], label: 'Enchant Jewellery' },
  { types: ['enchant_bolts'], label: 'Enchant Bolts' },
  { types: ['tan_leather', 'plank_make'], label: 'Utility' },
]

function groupActions(actions: any[]) {
  return TYPE_GROUPS.map(group => ({
    label: group.label,
    actions: actions.filter(a => group.types.includes(a.type)).sort((a: any, b: any) => a.level - b.level),
  })).filter(g => g.actions.length > 0)
}

describe('MagicScreen action grouping', () => {
  it('has magic actions in skills data', () => {
    expect(magicActions.length).toBeGreaterThan(0)
  })

  it('groups utility spells correctly', () => {
    const grouped = groupActions(magicActions)
    const utilitySpells = grouped.find(g => g.label === 'Utility Spells')
    expect(utilitySpells).toBeDefined()
    expect(utilitySpells!.actions.every((a: any) => a.type === 'utility_spell')).toBe(true)
    const ids = utilitySpells!.actions.map((a: any) => a.id)
    expect(ids).toContain('curse')
    expect(ids).toContain('stun')
  })

  it('groups alchemy actions correctly', () => {
    const grouped = groupActions(magicActions)
    const alchemy = grouped.find(g => g.label === 'Alchemy')
    expect(alchemy).toBeDefined()
    expect(alchemy!.actions.every((a: any) => a.type === 'alchemy')).toBe(true)
    expect(alchemy!.actions.find((a: any) => a.id === 'high_alch')).toBeDefined()
  })

  it('groups enchant jewel actions correctly', () => {
    const grouped = groupActions(magicActions)
    const enchant = grouped.find(g => g.label === 'Enchant Jewellery')
    expect(enchant).toBeDefined()
    expect(enchant!.actions.every((a: any) => a.type === 'enchant_jewel')).toBe(true)
    expect(enchant!.actions.length).toBeGreaterThanOrEqual(5)
  })

  it('groups enchant bolts actions correctly', () => {
    const grouped = groupActions(magicActions)
    const bolts = grouped.find(g => g.label === 'Enchant Bolts')
    expect(bolts).toBeDefined()
    expect(bolts!.actions.every((a: any) => a.type === 'enchant_bolts')).toBe(true)
  })

  it('groups tan_leather and plank_make into Utility', () => {
    const grouped = groupActions(magicActions)
    const utility = grouped.find(g => g.label === 'Utility')
    expect(utility).toBeDefined()
    const types = utility!.actions.map((a: any) => a.type)
    expect(types).toContain('tan_leather')
    expect(types).toContain('plank_make')
  })

  it('sorts actions by level within each group', () => {
    const grouped = groupActions(magicActions)
    for (const group of grouped) {
      for (let i = 1; i < group.actions.length; i++) {
        expect(group.actions[i].level).toBeGreaterThanOrEqual(group.actions[i - 1].level)
      }
    }
  })

  it('all actions are covered by exactly one group', () => {
    const grouped = groupActions(magicActions)
    const coveredIds = new Set(grouped.flatMap(g => g.actions.map((a: any) => a.id)))
    for (const action of magicActions) {
      expect(coveredIds.has(action.id), `action ${action.id} (type: ${action.type}) not covered by any group`).toBe(true)
    }
  })
})

describe('MagicScreen rune availability logic', () => {
  const makeInventory = (items: Record<string, number>) => {
    const inv: any[] = Array(28).fill(null)
    let slot = 0
    for (const [itemId, quantity] of Object.entries(items)) {
      inv[slot++] = { itemId, quantity }
    }
    return inv
  }

  it('returns available when inventory has sufficient runes', () => {
    const curseAction = magicActions.find((a: any) => a.id === 'curse')
    expect(curseAction).toBeDefined()
    // curse needs: body_rune x1, water_rune x2, earth_rune x3
    const inv = makeInventory({ body_rune: 10, water_rune: 10, earth_rune: 10 })
    const result = hasRequiredRunes(curseAction.runeReq, inv, {}, {}, {})
    expect(result).toBe(true)
  })

  it('returns not available when runes are missing', () => {
    const curseAction = magicActions.find((a: any) => a.id === 'curse')
    expect(curseAction).toBeDefined()
    const inv = makeInventory({ body_rune: 10 }) // missing water and earth runes
    const result = hasRequiredRunes(curseAction.runeReq, inv, {}, {}, {})
    expect(result).toBe(false)
  })

  it('returns available when bank has sufficient runes', () => {
    const curseAction = magicActions.find((a: any) => a.id === 'curse')
    expect(curseAction).toBeDefined()
    const inv = makeInventory({})
    const bank = { body_rune: { quantity: 5 }, water_rune: { quantity: 10 }, earth_rune: { quantity: 20 } }
    const result = hasRequiredRunes(curseAction.runeReq, inv, bank, {}, {})
    expect(result).toBe(true)
  })

  it('returns available when elemental staff covers fire rune requirement', () => {
    const highAlch = magicActions.find((a: any) => a.id === 'high_alch')
    expect(highAlch).toBeDefined()
    // high_alch needs: nature_rune x1, fire_rune x5
    const inv = makeInventory({ nature_rune: 10 }) // no fire runes
    const equipment = { weapon: { itemId: 'fire_staff' } }
    const itemsStub: any = { fire_staff: { id: 'fire_staff', name: 'Fire Staff', elemental: 'fire_rune' } }
    const result = hasRequiredRunes(highAlch.runeReq, inv, {}, equipment, itemsStub)
    expect(result).toBe(true)
  })

  it('returns not available when elemental staff covers wrong rune type', () => {
    const highAlch = magicActions.find((a: any) => a.id === 'high_alch')
    expect(highAlch).toBeDefined()
    // high_alch needs nature_rune x1 and fire_rune x5
    // water staff only covers water runes, not nature or fire
    const inv = makeInventory({ fire_rune: 10 }) // has fire but not nature
    const equipment = { weapon: { itemId: 'water_staff' } }
    const itemsStub: any = { water_staff: { id: 'water_staff', name: 'Water Staff', elemental: 'water_rune' } }
    const result = hasRequiredRunes(highAlch.runeReq, inv, {}, equipment, itemsStub)
    expect(result).toBe(false)
  })
})
