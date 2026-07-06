import { describe, it, expect } from 'vitest'
import {
  SETTINGS_NAV_LINKS,
  GAME_FRAME_TOP_TABS,
  GAME_FRAME_TOP_LEFT_TABS,
  GAME_FRAME_BOTTOM_LEFT_TABS,
} from '../src/components/navTabs.js'
import { SCREENS } from '../src/utils/constants.js'

const RAIL_TABS = [...GAME_FRAME_TOP_LEFT_TABS, ...GAME_FRAME_TOP_TABS, ...GAME_FRAME_BOTTOM_LEFT_TABS]

describe('navigation tabs', () => {
  it('keeps every rail tab id unique and backed by a SCREENS constant', () => {
    const ids = RAIL_TABS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    const known = new Set(Object.values(SCREENS))
    for (const id of ids) expect(known.has(id)).toBe(true)
  })

  it('moves Trading Post, Clues, Unlocks, Armoury, Collection Log and Leaderboard into Settings', () => {
    const settingsIds = SETTINGS_NAV_LINKS.map((l) => l.id)
    expect(settingsIds).toEqual([
      SCREENS.STORE,
      SCREENS.CLUES,
      SCREENS.CHARACTER_UNLOCKS,
      SCREENS.ARMOURY,
      SCREENS.COLLECTION_LOG,
      SCREENS.LEADERBOARD,
    ])
    // The moved screens must not also appear on the frame rails — Settings is
    // their only entry point.
    const railIds = new Set(RAIL_TABS.map((t) => t.id))
    for (const id of settingsIds) expect(railIds.has(id)).toBe(false)
    // But Settings itself must stay reachable.
    expect(railIds.has(SCREENS.HELP)).toBe(true)
  })

  it('keeps world-map-only content (skills/combat/quests/minigames/gather) out of the nav', () => {
    const railIds = new Set(RAIL_TABS.map((t) => t.id))
    for (const id of [SCREENS.SKILLS, SCREENS.COMBAT, SCREENS.QUESTS, SCREENS.MINIGAMES, SCREENS.GATHER]) {
      expect(railIds.has(id), id).toBe(false)
    }
    // Their entry point — the World Map — must stay in the nav.
    expect(railIds.has(SCREENS.WORLD_MAP)).toBe(true)
  })

  it('keeps the game frame rails to the agreed screens', () => {
    // Top rail: Home (top-left), World Map, Inventory, Equipment. Bottom rail:
    // Settings … Daily Tasks + Credits + Skip (rendered by GameFrameBar itself).
    expect(GAME_FRAME_TOP_LEFT_TABS.map((t) => t.id)).toEqual([SCREENS.HOME])
    expect(GAME_FRAME_TOP_TABS.map((t) => t.id)).toEqual([
      SCREENS.WORLD_MAP,
      SCREENS.INVENTORY,
      SCREENS.EQUIPMENT,
    ])
    expect(GAME_FRAME_BOTTOM_LEFT_TABS.map((t) => t.id)).toEqual([SCREENS.HELP])
    // Every frame tab must be backed by a SCREENS constant and carry an icon.
    const known = new Set(Object.values(SCREENS))
    for (const tab of RAIL_TABS) {
      expect(known.has(tab.id)).toBe(true)
      expect(typeof tab.iconKey).toBe('string')
    }
  })
})
