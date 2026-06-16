import { describe, it, expect } from 'vitest'
import { createDefaultSave, createDefaultStats } from '../src/engine/createDefaultSave.js'
import { ALL_SKILLS, HITPOINTS_START_XP, INVENTORY_SIZE, EQUIPMENT_SLOTS } from '../src/utils/constants.js'
import { summarizeSave } from '../functions/_lib/mcp/summary.js'

describe('createDefaultSave — canonical fresh-character baseline', () => {
  it('seeds every skill, with Hitpoints at the level-10 baseline', () => {
    const stats = createDefaultStats()
    for (const skill of new Set(ALL_SKILLS)) {
      expect(stats[skill], `missing ${skill}`).toBeDefined()
    }
    expect(stats.hitpoints).toEqual({ skill: 'hitpoints', xp: HITPOINTS_START_XP, level: 10 })
    // Every non-HP skill starts at level 1 / 0 xp.
    for (const skill of new Set(ALL_SKILLS)) {
      if (skill === 'hitpoints') continue
      expect(stats[skill]).toEqual({ skill, xp: 0, level: 1 })
    }
    // The exact skills the MCP "stuck on Spryroot" bug hit are present.
    for (const utility of ['agility', 'thieving', 'hunter']) {
      expect(stats[utility]).toEqual({ skill: utility, xp: 0, level: 1 })
    }
  })

  it('produces a full 28-slot inventory with the bronze starter kit', () => {
    const save = createDefaultSave()
    expect(save.inventory).toHaveLength(INVENTORY_SIZE)
    expect(save.inventory[0]).toEqual({ itemId: 'bronze_dagger', quantity: 1 })
    expect(save.inventory[11]).toEqual({ itemId: 'coins', quantity: 25 })
    expect(save.inventory[12]).toBeNull()
    // Empty equipment with every slot keyed.
    for (const slot of EQUIPMENT_SLOTS) expect(save.equipment[slot]).toBeNull()
    expect(save.bank).toEqual({})
  })

  it('can be summarized for get_character_state (real starting levels, not all level 1)', () => {
    const summary = summarizeSave(JSON.stringify(createDefaultSave()))
    expect(summary.skills.hitpoints.level).toBe(10)
    expect(summary.skills.agility.level).toBe(1)
    expect(summary.currentHP).toBe(10)
    // The starter kit shows up as occupied inventory slots.
    expect(summary.inventoryUsed).toBe(12)
  })

  it('omits the starter kit when asked', () => {
    const save = createDefaultSave({ withStarterKit: false })
    expect(save.inventory.every((s) => s === null)).toBe(true)
    // Stats baseline is unchanged.
    expect(save.stats.hitpoints.level).toBe(10)
  })
})
