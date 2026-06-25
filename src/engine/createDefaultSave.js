/**
 * Canonical fresh-character save.
 *
 * The browser seeds a brand-new character in IndexedDB via
 * `src/db/stores.js:initNewGame` (all skills initialized, Hitpoints at the
 * level-10 baseline, an empty 28-slot inventory plus the bronze starter kit).
 * A character created server-side through the MCP `create_character` tool never
 * runs that path, so without this its save is an empty `{}` — every skill reads
 * as uninitialized, idle XP is dropped on claim, and level requirements never
 * unlock. This module is the single source of truth for that baseline so the
 * server can hand a save-less character the exact same starting state.
 */
import { ALL_SKILLS, HITPOINTS_START_XP, INVENTORY_SIZE, EQUIPMENT_SLOTS } from '../utils/constants.js'

// Hitpoints starts at level 10; everything else at level 1. Keyed by skill id,
// matching the shape the engine and MCP summary read (`stats[skill].xp`).
export function createDefaultStats() {
  const stats = {}
  for (const skill of new Set(ALL_SKILLS)) {
    const xp = skill === 'hitpoints' ? HITPOINTS_START_XP : 0
    const level = skill === 'hitpoints' ? 10 : 1
    stats[skill] = { skill, xp, level }
  }
  return stats
}

// The head slot every new character starts with depends on account type:
// Ironman and One Life Ironman get their exclusive horned full helm, everyone
// else the bronze full helm.
export function starterHelmetId({ isIronman = false, isOneLife = false } = {}) {
  if (isIronman && isOneLife) return 'onelife_ironman_helm'
  if (isIronman) return 'ironman_helm'
  return 'bronze_full_helm'
}

// The deterministic starter kit every new character receives — single source of
// truth shared with initNewGame's browser path. Not RNG, so granting it
// server-side carries no integrity concern (it is the baseline). The head slot
// varies by account type; everything else is identical for every account.
export function getStarterKit({ isIronman = false, isOneLife = false } = {}) {
  return [
    { itemId: 'bronze_dagger', quantity: 1 },
    { itemId: 'bronze_scimitar', quantity: 1 },
    { itemId: starterHelmetId({ isIronman, isOneLife }), quantity: 1 },
    { itemId: 'bronze_platebody', quantity: 1 },
    { itemId: 'bronze_platelegs', quantity: 1 },
    { itemId: 'bronze_kiteshield', quantity: 1 },
    { itemId: 'shortbow', quantity: 1 },
    { itemId: 'bronze_arrow', quantity: 100 },
    { itemId: 'mind_rune', quantity: 100 },
    { itemId: 'air_rune', quantity: 100 },
    { itemId: 'fire_rune', quantity: 100 },
    { itemId: 'water_rune', quantity: 100 },
    { itemId: 'earth_rune', quantity: 100 },
    { itemId: 'shrimps', quantity: 1 },
    { itemId: 'shrimps', quantity: 1 },
    { itemId: 'shrimps', quantity: 1 },
    { itemId: 'shrimps', quantity: 1 },
    { itemId: 'shrimps', quantity: 1 },
    { itemId: 'coins', quantity: 25 },
  ]
}

export function createDefaultEquipment() {
  const equipment = {}
  for (const slot of EQUIPMENT_SLOTS) equipment[slot] = null
  return equipment
}

// A fresh, well-formed save object. `withStarterKit: false` yields the same
// baseline with an empty inventory (used where the kit is not wanted).
//
// `name` / `isIronman` / `isOneLife` seed the player profile the same way the
// browser's initNewGame does. Without `name` the Home Screen greets the player
// with an empty "Welcome," and the in-game ironman/one-life gates (which read
// `player.is_ironman` / `player.is_one_life` from the save) default to off — so
// an MCP-created character must carry its username and flags here.
export function createDefaultSave({ withStarterKit = true, name = null, isIronman = false, isOneLife = false } = {}) {
  const inventory = new Array(INVENTORY_SIZE).fill(null)
  if (withStarterKit) {
    getStarterKit({ isIronman, isOneLife }).forEach((item, i) => { inventory[i] = { ...item } })
  }
  return {
    player: {
      ...(name ? { name } : {}),
      is_ironman: !!isIronman,
      is_one_life: !!isOneLife,
      created: Date.now(),
      totalPlayTime: 0,
      currentHP: 10,
    },
    stats: createDefaultStats(),
    inventory,
    bank: {},
    equipment: createDefaultEquipment(),
    settings: { currentHP: 10 },
  }
}
