import { describe, it, expect } from 'vitest'
import { NAV_TABS, SETTINGS_NAV_LINKS } from '../src/components/navTabs.js'
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
      SCREENS.CONNECT_AI,
      SCREENS.CHARACTER_UNLOCKS,
      SCREENS.ARMOURY,
      SCREENS.COLLECTION_LOG,
      SCREENS.LEADERBOARD,
    ])
    // The moved screens must no longer appear in the nav rails.
    const navIds = new Set(NAV_TABS.map((t) => t.id))
    for (const id of settingsIds) expect(navIds.has(id)).toBe(false)
    // But Settings itself must stay reachable.
    expect(navIds.has(SCREENS.HELP)).toBe(true)
  })
})
