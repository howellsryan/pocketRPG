import { describe, it, expect } from 'vitest'
import {
  NAV_TABS,
  SETTINGS_NAV_LINKS,
  GAME_FRAME_TOP_TABS,
  GAME_FRAME_TOP_LEFT_TABS,
  GAME_FRAME_BOTTOM_LEFT_TABS,
} from '../src/components/navTabs.js'
import { SCREENS } from '../src/utils/constants.js'

describe('navigation tabs', () => {
  it('keeps every tab id unique and backed by a SCREENS constant', () => {
    const ids = NAV_TABS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    const known = new Set(Object.values(SCREENS))
    for (const id of ids) expect(known.has(id)).toBe(true)
  })

  it('moves Connect AI, Unlocks, Armoury, Collection Log and Leaderboard into Settings', () => {
    const settingsIds = SETTINGS_NAV_LINKS.map((l) => l.id)
    expect(settingsIds).toEqual([
      SCREENS.STORE,
      SCREENS.CLUES,
      SCREENS.CONNECT_AI,
      SCREENS.CHARACTER_UNLOCKS,
      SCREENS.ARMOURY,
      SCREENS.COLLECTION_LOG,
      SCREENS.LEADERBOARD,
    ])
    // The moved screens must no longer appear in the nav rails. Trading Post
    // and Clues are exempt: they stay on the desktop rail but need a Settings
    // link as their only mobile (GameFrameBar) entry point.
    const navIds = new Set(NAV_TABS.map((t) => t.id))
    const desktopRailAlso = new Set([SCREENS.STORE, SCREENS.CLUES])
    for (const id of settingsIds) {
      if (desktopRailAlso.has(id)) continue
      expect(navIds.has(id)).toBe(false)
    }
    // But Settings itself must stay reachable.
    expect(navIds.has(SCREENS.HELP)).toBe(true)
  })

  it('keeps world-map-only content (skills/combat/quests/minigames/gather) out of the nav', () => {
    const navIds = new Set(NAV_TABS.map((t) => t.id))
    for (const id of [SCREENS.SKILLS, SCREENS.COMBAT, SCREENS.QUESTS, SCREENS.MINIGAMES, SCREENS.GATHER]) {
      expect(navIds.has(id), id).toBe(false)
    }
    // Their entry point — the World Map — must stay in the nav.
    expect(navIds.has(SCREENS.WORLD_MAP)).toBe(true)
  })

  it('keeps the mobile game frame rails to the agreed screens', () => {
    // Top rail: Home (top-left), World Map, Inventory, Equipment (plus the
    // Skip action, rendered by GameFrameBar itself). Bottom rail: Settings …
    // Credits + Skip.
    expect(GAME_FRAME_TOP_LEFT_TABS.map((t) => t.id)).toEqual([SCREENS.HOME])
    expect(GAME_FRAME_TOP_TABS.map((t) => t.id)).toEqual([
      SCREENS.WORLD_MAP,
      SCREENS.INVENTORY,
      SCREENS.EQUIPMENT,
    ])
    expect(GAME_FRAME_BOTTOM_LEFT_TABS.map((t) => t.id)).toEqual([SCREENS.HELP])
    // Every frame tab must be backed by a SCREENS constant and carry an icon.
    const known = new Set(Object.values(SCREENS))
    for (const tab of [...GAME_FRAME_TOP_LEFT_TABS, ...GAME_FRAME_TOP_TABS, ...GAME_FRAME_BOTTOM_LEFT_TABS]) {
      expect(known.has(tab.id)).toBe(true)
      expect(typeof tab.iconKey).toBe('string')
    }
  })
})
