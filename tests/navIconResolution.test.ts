import { describe, expect, it } from 'vitest'
import bespokeIcons from '../src/data/bespokeIcons.json'
import gameIcons from '../src/data/gameIcons.json'
import {
  GAME_FRAME_TOP_TABS,
  GAME_FRAME_BOTTOM_LEFT_TABS,
  GAME_FRAME_BOTTOM_RIGHT_TABS,
  DESKTOP_NAV_TABS,
  SETTINGS_NAV_LINKS,
} from '../src/components/navTabs.js'

// GameIcon (src/components/GameIcon.jsx) resolves iconKey against bespokeIcons
// first, then gameIcons, and only falls all the way back to a generic 📦 emoji
// if neither has the key — which is exactly what happened when a full
// `build-bespoke-icons.cjs` regen dropped globe/backpack/paperdoll/chat_bubble
// (hand-added to bespokeIcons.json with no src/assets/icons/*.svg source, so a
// from-scratch regen silently lost them) and every core nav rail icon
// (World Map, Inventory, Equipment, Game Helper) defaulted to a plain box.
// Nav rail icons are load-bearing chrome, not incremental content, so every
// iconKey they reference must resolve to real bespoke or shared-glyph art.
const bespokeSet = new Set(Object.keys(bespokeIcons))
const gameIconSet = new Set(Object.keys(gameIcons as Record<string, unknown>))

function assertResolvable(tabs: Array<{ label: string, iconKey?: string }>) {
  for (const tab of tabs) {
    if (!tab.iconKey) continue
    const resolves = bespokeSet.has(tab.iconKey) || gameIconSet.has(tab.iconKey)
    expect(resolves, `nav tab "${tab.label}" iconKey "${tab.iconKey}" resolves to neither bespokeIcons.json nor gameIcons.json — it would render the generic 📦 fallback`).toBe(true)
  }
}

describe('nav rail icon resolution', () => {
  it('every GameFrameBar top/bottom rail iconKey resolves', () => {
    assertResolvable(GAME_FRAME_TOP_TABS)
    assertResolvable(GAME_FRAME_BOTTOM_LEFT_TABS)
    assertResolvable(GAME_FRAME_BOTTOM_RIGHT_TABS)
  })

  it('every desktop SideNav iconKey resolves', () => {
    assertResolvable(DESKTOP_NAV_TABS)
  })

  it('every Settings-screen nav link iconKey resolves', () => {
    assertResolvable(SETTINGS_NAV_LINKS)
  })

  it('the Game Helper rail icon (hardcoded in GameFrameBar.jsx, not navTabs.js) resolves', () => {
    // GameFrameBar.jsx renders this one inline (`<GameIcon iconKey="chat_bubble" .../>`)
    // rather than via navTabs.js — untestable at the JSX call site per this repo's
    // testing rule, so the key is asserted here by hand instead.
    expect(bespokeSet.has('chat_bubble') || gameIconSet.has('chat_bubble')).toBe(true)
  })
})
