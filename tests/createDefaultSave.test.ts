import { describe, it, expect } from 'vitest'
import { createDefaultSave, createDefaultStats, getStarterKit, starterHelmetId } from '../src/engine/createDefaultSave.js'
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

  it('produces a full 28-slot inventory with the starter kit', () => {
    const save = createDefaultSave()
    expect(save.inventory).toHaveLength(INVENTORY_SIZE)
    expect(save.inventory[0]).toEqual({ itemId: 'bronze_dagger', quantity: 1 })
    // Default account starts in the bronze full helm.
    expect(save.inventory[2]).toEqual({ itemId: 'bronze_full_helm', quantity: 1 })
    // Ranged + magic starter supplies.
    expect(save.inventory).toContainEqual({ itemId: 'shortbow', quantity: 1 })
    expect(save.inventory).toContainEqual({ itemId: 'bronze_arrow', quantity: 100 })
    for (const rune of ['mind_rune', 'air_rune', 'fire_rune', 'water_rune', 'earth_rune']) {
      expect(save.inventory).toContainEqual({ itemId: rune, quantity: 100 })
    }
    // Coins close out the kit (19 items in total).
    expect(save.inventory[18]).toEqual({ itemId: 'coins', quantity: 25 })
    expect(save.inventory[19]).toBeNull()
    // Empty equipment with every slot keyed.
    for (const slot of EQUIPMENT_SLOTS) expect(save.equipment[slot]).toBeNull()
    expect(save.bank).toEqual({})
  })

  it('swaps the head slot to the account-specific horned helm', () => {
    expect(starterHelmetId({})).toBe('bronze_full_helm')
    expect(starterHelmetId({ isIronman: true })).toBe('ironman_helm')
    expect(starterHelmetId({ isIronman: true, isOneLife: true })).toBe('onelife_ironman_helm')
    // One Life on its own (non-Ironman) keeps the bronze helm.
    expect(starterHelmetId({ isOneLife: true })).toBe('bronze_full_helm')

    expect(getStarterKit({ isIronman: true })[2]).toEqual({ itemId: 'ironman_helm', quantity: 1 })
    expect(createDefaultSave({ isIronman: true, isOneLife: true }).inventory[2])
      .toEqual({ itemId: 'onelife_ironman_helm', quantity: 1 })
  })

  it('can be summarized for get_character_state (real starting levels, not all level 1)', () => {
    const summary = summarizeSave(JSON.stringify(createDefaultSave()))
    expect(summary.skills.hitpoints.level).toBe(10)
    expect(summary.skills.agility.level).toBe(1)
    expect(summary.currentHP).toBe(10)
    // The starter kit shows up as occupied inventory slots.
    expect(summary.inventoryUsed).toBe(19)
  })

  it('seeds the player profile name and permanence flags for the Home Screen', () => {
    // Regression: an MCP-created character whose save omitted player.name greeted
    // the player with an empty "Welcome," and defaulted the ironman/one-life
    // gates (which read player.is_ironman / player.is_one_life) to off.
    const save = createDefaultSave({ name: 'MCP', isIronman: true, isOneLife: false })
    expect(save.player.name).toBe('MCP')
    expect(save.player.is_ironman).toBe(true)
    expect(save.player.is_one_life).toBe(false)
    expect(save.player.currentHP).toBe(10)
  })

  it('leaves the name unset when none is supplied', () => {
    const save = createDefaultSave()
    expect(save.player.name).toBeUndefined()
    expect(save.player.is_ironman).toBe(false)
    expect(save.player.is_one_life).toBe(false)
  })

  it('omits the starter kit when asked', () => {
    const save = createDefaultSave({ withStarterKit: false })
    expect(save.inventory.every((s) => s === null)).toBe(true)
    // Stats baseline is unchanged.
    expect(save.stats.hitpoints.level).toBe(10)
  })
})
