import { describe, it, expect } from 'vitest'
import { NAV_TABS } from '../src/components/navTabs.js'
import { SCREENS } from '../src/utils/constants.js'

describe('navigation tabs', () => {
  it('exposes a "Connect AI" tab as the last nav entry', () => {
    const last = NAV_TABS[NAV_TABS.length - 1]
    expect(last.id).toBe(SCREENS.CONNECT_AI)
    expect(last.label).toBe('Connect AI')
  })

  it('keeps every tab id unique and backed by a SCREENS constant', () => {
    const ids = NAV_TABS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    const known = new Set(Object.values(SCREENS))
    for (const id of ids) expect(known.has(id)).toBe(true)
  })
})
