// Lookup + data-contract tests for the Construction content tables shared by
// the Construction screen and the MCP save intents.

import { describe, it, expect } from 'vitest'
import {
  BUILDING_ACTIONS,
  UNLOCKABLES,
  findBuildingAction,
  findConstructionPerk,
} from '../src/engine/construction.js'
import itemsData from '../src/data/items.json'

const items = itemsData as Record<string, unknown>

describe('BUILDING_ACTIONS', () => {
  it('has unique ids and ascending level gates', () => {
    const ids = BUILDING_ACTIONS.map((a: any) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    const levels = BUILDING_ACTIONS.map((a: any) => a.level)
    expect([...levels].sort((x, y) => x - y)).toEqual(levels)
  })

  it('consumes exactly one plank-type material that exists as an item', () => {
    for (const a of BUILDING_ACTIONS as any[]) {
      const mats = Object.entries(a.materials)
      expect(mats).toHaveLength(1)
      const [plankId, qty] = mats[0]
      expect(qty).toBe(1)
      expect(items[plankId], `building ${a.id} uses missing item "${plankId}"`).toBeDefined()
      expect(a.xp).toBeGreaterThan(0)
    }
  })
})

describe('UNLOCKABLES', () => {
  it('has unique perk ids', () => {
    const ids = UNLOCKABLES.map((p: any) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('findBuildingAction / findConstructionPerk', () => {
  it('finds known entries', () => {
    expect(findBuildingAction('build_plank')).toMatchObject({ id: 'build_plank' })
    expect(findConstructionPerk('money_purse')).toMatchObject({ id: 'money_purse' })
  })

  it('returns null for unknown ids', () => {
    expect(findBuildingAction('nope')).toBeNull()
    expect(findConstructionPerk('nope')).toBeNull()
  })
})
