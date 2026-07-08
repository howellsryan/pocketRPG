import { describe, it, expect } from 'vitest'
import {
  SETTINGS_NAV_LINKS,
  GAME_FRAME_TOP_TABS,
  GAME_FRAME_BOTTOM_LEFT_TABS,
  GAME_FRAME_BOTTOM_RIGHT_TABS,
  DESKTOP_NAV_TABS,
} from '../src/components/navTabs.js'
import { SCREENS } from '../src/utils/constants.js'

const RAIL_TABS = [...GAME_FRAME_TOP_TABS, ...GAME_FRAME_BOTTOM_LEFT_TABS, ...GAME_FRAME_BOTTOM_RIGHT_TABS]

describe('navigation tabs', () => {
  it('keeps every rail tab id unique and backed by a SCREENS constant', () => {
    const ids = RAIL_TABS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    const known = new Set(Object.values(SCREENS))
    for (const id of ids) expect(known.has(id)).toBe(true)
  })

  it('moves Unlocks, Armoury, Collection Log and Leaderboard into Settings', () => {
    const settingsIds = SETTINGS_NAV_LINKS.map((l) => l.id)
    expect(settingsIds).toEqual([
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

  it('keeps world-map-only content (quests/clues/minigames/gather/skills) out of the frame rails', () => {
    const railIds = new Set(RAIL_TABS.map((t) => t.id))
    // Skills has no rail icon — its actions start from each skill's own
    // detail modal on the Home screen instead.
    for (const id of [SCREENS.QUESTS, SCREENS.CLUES, SCREENS.MINIGAMES, SCREENS.GATHER, SCREENS.SKILLS]) {
      expect(railIds.has(id), id).toBe(false)
    }
    // Their entry points — the World Map and the Adventures rail icon — must
    // stay in the nav, alongside Bank and Combat (both gate by location and
    // fall back to a travel prompt).
    expect(railIds.has(SCREENS.WORLD_MAP)).toBe(true)
    expect(railIds.has(SCREENS.ADVENTURES)).toBe(true)
    expect(railIds.has(SCREENS.BANK)).toBe(true)
    expect(railIds.has(SCREENS.COMBAT)).toBe(true)
  })

  it('keeps the game frame rails to the agreed screens', () => {
    // Top rail: World Map, Bank, Combat, Inventory, Equipment. Bottom rail:
    // Settings + Adventures (left) … Daily Tasks + Credits + Skip (rendered
    // by GameFrameBar itself) … Home (right, next to the floating chat button).
    expect(GAME_FRAME_TOP_TABS.map((t) => t.id)).toEqual([
      SCREENS.WORLD_MAP,
      SCREENS.BANK,
      SCREENS.COMBAT,
      SCREENS.INVENTORY,
      SCREENS.EQUIPMENT,
    ])
    expect(GAME_FRAME_BOTTOM_LEFT_TABS.map((t) => t.id)).toEqual([SCREENS.HELP, SCREENS.ADVENTURES])
    expect(GAME_FRAME_BOTTOM_RIGHT_TABS.map((t) => t.id)).toEqual([SCREENS.HOME])
    // Every frame tab must be backed by a SCREENS constant and carry an icon.
    const known = new Set(Object.values(SCREENS))
    for (const tab of RAIL_TABS) {
      expect(known.has(tab.id)).toBe(true)
      expect(typeof tab.iconKey).toBe('string')
    }
  })

  it('keeps the desktop side nav to the agreed screens, in order', () => {
    // Home and Adventures keep their usual desktop spots — only the mobile
    // rails move them (bottom-right/bottom-left) to make room for Bank.
    expect(DESKTOP_NAV_TABS.map((t) => t.id)).toEqual([
      SCREENS.HOME,
      SCREENS.WORLD_MAP,
      SCREENS.BANK,
      SCREENS.COMBAT,
      SCREENS.INVENTORY,
      SCREENS.EQUIPMENT,
      SCREENS.ADVENTURES,
      SCREENS.HELP,
    ])
  })
})
