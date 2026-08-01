import { describe, expect, it, beforeAll } from 'vitest'
import { iconMarkup, iconSvgString, loadItemIcons, uiIconMarkup } from '../client/src/itemIcon'
import items from '../../src/data/items.json'

const itemIds = Object.keys(items as Record<string, unknown>)

/** The tint applied to the whole icon, as opposed to colours inside the art. */
const rootFill = (svg: string): string | null =>
  /^<svg[^>]*\sfill="([^"]+)"/.exec(svg)?.[1] ?? null

describe('world item icons', () => {
  beforeAll(async () => { await loadItemIcons() })

  it('draws real art for every item in the game, never a "❔" placeholder', () => {
    const placeholders = itemIds.filter(id => iconSvgString(id, 32) === null)
    expect(
      placeholders,
      `item(s) the world cannot draw — they render "❔" where the idle game shows an icon:\n${placeholders.join('\n')}`,
    ).toEqual([])
    expect(iconMarkup('ironman_helm', 32)).not.toContain('❔')
  })

  it('never emits an unresolved CSS variable, which paints nothing out here', () => {
    // The world client loads no stylesheet, and ground-loot icons are rasterised
    // from a standalone data: SVG where var() and currentColor resolve to nothing.
    const leaking = itemIds.filter(id => (iconSvgString(id, 32) ?? '').includes('var(--'))
    expect(leaking, `item icon(s) still carrying a CSS variable:\n${leaking.join('\n')}`).toEqual([])
  })

  it('paints a glyph fallback with the same tier colour the idle game uses', () => {
    // Ironman helms have no bespoke art; --tier-iron / --tier-dragon.
    expect(iconSvgString('ironman_helm', 32)).toContain('#8c8c8c')
    expect(iconSvgString('onelife_ironman_helm', 32)).toContain('#d23b2f')
  })

  it('tells the three charm tiers apart despite their shared bespoke art', () => {
    const tints = ['green_charm', 'red_charm', 'blue_charm'].map(id => rootFill(iconSvgString(id, 32)!))
    expect(tints.every(Boolean), 'a tintable icon must be painted').toBe(true)
    expect(new Set(tints).size, 'each charm tier needs its own colour').toBe(3)
  })

  it('renders untinted bespoke art exactly as authored', () => {
    // The art carries its own colours; a root fill would flatten it.
    expect(rootFill(iconSvgString('dragon_scimitar', 32)!)).toBeNull()
  })

  it('renders HUD icon keys, and nothing for a key that does not exist', () => {
    expect(uiIconMarkup('backpack', 24)).toContain('<svg')
    expect(uiIconMarkup('definitely_not_an_icon', 24)).toBe('')
  })

  it('carries the requested pixel size onto the svg', () => {
    expect(iconSvgString('coins', 48)).toContain('width="48" height="48"')
  })
})
