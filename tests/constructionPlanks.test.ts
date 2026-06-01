import { describe, it, expect } from 'vitest'
import items from '../src/data/items.json'

// Regression guard for the "can't build with planks" bug: the Construction
// build recipes must consume canonical item ids that actually exist in
// items.json, otherwise inventory/bank counting (which matches on the literal
// stored itemId) silently fails. These ids mirror the `materials` keys in
// src/screens/ConstructionScreen.jsx BUILDING_ACTIONS.
const CONSTRUCTION_PLANK_IDS = ['plank', 'oak_plank', 'teak_plank', 'mahogany_plank']

describe('construction plank recipes', () => {
  it('every build recipe material resolves to a canonical item in items.json', () => {
    const itemsMap = items as Record<string, any>
    for (const id of CONSTRUCTION_PLANK_IDS) {
      const entry = itemsMap[id]
      expect(entry, `${id} missing from items.json`).toBeTruthy()
      // canonical entry: key equals id (not a legacy alias whose id points elsewhere)
      expect(entry.id, `${id} is not canonical`).toBe(id)
    }
  })

  it('does not retain a legacy "planks" alias now that it is actively migrated', () => {
    // The `planks` -> `plank` rename is handled by itemMigrations, so the
    // dormant alias entry was removed. Keeping this assertion prevents it from
    // being reintroduced and re-splitting plank stacks across two ids.
    expect((items as Record<string, any>).planks).toBeUndefined()
  })
})
