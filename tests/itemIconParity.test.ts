import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import items from '../src/data/items.json'
import gameIcons from '../src/data/gameIcons.json'
import bespokeIcons from '../src/data/bespokeIcons.json'
import { resolveItemIcon, BESPOKE_ALIAS } from '../src/utils/itemIconResolve.js'
import { getItemIconTint } from '../src/utils/itemIcons.js'
import { ICON_TINT_HEX, resolveIconTint } from '../src/utils/iconTints.js'

const itemsData = items as Record<string, any>
const glyphs = gameIcons as Record<string, { body: string; viewBox: string | null }>
const bespoke = bespokeIcons as Record<string, { body: string; viewBox: string | null; tintable?: boolean }>

const HEX = /^#[0-9a-f]{3,8}$/i

// The idle game and the open world pass the same two maps into the same
// resolver — the world just loads them lazily. Anything that resolves for one
// resolves identically for the other, which is what these tests hold to.
const resolve = (item: any) => resolveItemIcon(item, { bespoke, glyphs })

describe('item icon parity — idle game vs open world', () => {
  it('every item resolves to renderable art, so no item can fall through to a placeholder', () => {
    const unrendered = Object.values(itemsData)
      .filter(item => resolve(item).kind === 'none')
      .map(item => item.id)
    expect(
      unrendered,
      `item(s) with neither bespoke art nor a glyph — they render "❔" in the world:\n${unrendered.join('\n')}`,
    ).toEqual([])
  })

  it('every item resolves to a body that is real SVG content', () => {
    for (const item of Object.values(itemsData)) {
      const icon = resolve(item)
      expect(typeof icon.body, `${item.id} body`).toBe('string')
      expect(icon.body!.trimStart()[0], `${item.id} body should start with '<'`).toBe('<')
      expect(icon.viewBox, `${item.id} viewBox`).toMatch(/^[-\d. ]+$/)
    }
  })

  it('every item tint resolves to a literal colour the world can paint with', () => {
    const unresolved: string[] = []
    for (const item of Object.values(itemsData)) {
      const icon = resolve(item)
      if (!icon.tint) continue
      const hex = resolveIconTint(icon.tint)
      if (!HEX.test(hex)) unresolved.push(`${item.id} → ${icon.tint} → ${hex}`)
    }
    expect(unresolved, `tint(s) with no hex in ICON_TINT_HEX:\n${unresolved.join('\n')}`).toEqual([])
  })

  it('ICON_TINT_HEX matches the :root values in src/index.css', () => {
    const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
    // The first :root block holds the base palette; later blocks are theme
    // overrides, so stop at the first closing brace.
    const root = css.slice(css.indexOf('--color-parchment:'))
    const drift: string[] = []
    for (const [token, hex] of Object.entries(ICON_TINT_HEX)) {
      const m = new RegExp(`${token}:\\s*([^;]+);`).exec(root)
      if (!m) { drift.push(`${token} is not defined in src/index.css`); continue }
      if (m[1].trim().toLowerCase() !== hex.toLowerCase()) {
        drift.push(`${token}: index.css has ${m[1].trim()}, ICON_TINT_HEX has ${hex}`)
      }
    }
    expect(drift, drift.join('\n')).toEqual([])
  })

  it('every token any item tint can produce is present in ICON_TINT_HEX', () => {
    const missing = new Set<string>()
    for (const item of Object.values(itemsData)) {
      const tint = getItemIconTint(item)
      const m = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(String(tint).trim())
      if (m && !(m[1] in ICON_TINT_HEX)) missing.add(`${m[1]} (e.g. ${item.id})`)
    }
    expect([...missing]).toEqual([])
  })

  it('aliased items share one bespoke body and are told apart by tint', () => {
    for (const [id, aliasKey] of Object.entries(BESPOKE_ALIAS as Record<string, string>)) {
      const icon = resolve(itemsData[id])
      expect(icon.kind, `${id} should render the shared "${aliasKey}" art`).toBe('bespoke')
      expect(icon.body).toBe(bespoke[aliasKey].body)
      expect(HEX.test(resolveIconTint(icon.tint!)), `${id} needs a resolvable tint`).toBe(true)
    }
    const tints = Object.keys(BESPOKE_ALIAS).map(id => resolveIconTint(resolve(itemsData[id]).tint!))
    expect(new Set(tints).size, 'aliased variants must not all render the same colour').toBe(tints.length)
  })

  it('bespoke art that carries its own colours is never tinted', () => {
    const icon = resolve(itemsData.dragon_scimitar)
    expect(icon.kind).toBe('bespoke')
    expect(icon.tint).toBeNull()
  })

  it('an item without bespoke art falls back to its tinted, glowing glyph', () => {
    // Account-identity helms have no bespoke art; the world used to render "❔"
    // for them while the idle game drew the tinted crested-helmet glyph.
    const icon = resolve(itemsData.ironman_helm)
    expect(icon.kind).toBe('glyph')
    expect(icon.body).toBe(glyphs.horned_full_helm.body)
    expect(resolveIconTint(icon.tint!)).toBe(ICON_TINT_HEX['--tier-iron'])
    expect(resolveIconTint(resolve(itemsData.onelife_ironman_helm).tint!))
      .toBe(ICON_TINT_HEX['--tier-dragon'])
  })

  // Bespoke art carries its own colours and takes no glow, so force the glyph
  // branch to prove the rim/glow ladder still applies to anything falling to it.
  const asGlyph = (id: string) => resolveItemIcon(itemsData[id], { bespoke: {}, glyphs })

  it('a glyph fallback keeps the rim outline the idle game gives it', () => {
    const icon = asGlyph('abyssal_tentacle')
    expect(icon.kind).toBe('glyph')
    expect(icon.glow).toContain('drop-shadow')
  })

  it('every rung of the glow ladder survives the move out of GameIcon', () => {
    expect(asGlyph('infernal_cape').glow, 'prestige glow').toContain('0 0 3px #f0c040')
    expect(asGlyph('2nd_age_platebody').glow, 'platinum glow').toBe('drop-shadow(0 0 3px #e5e4e2)')
    expect(asGlyph('torvek_s_helm').glow, 'cryptbound white rim').toContain('0 0 1px #ffffff')
    expect(asGlyph('black_d_hide_body').glow, 'black hide white rim').toContain('0 0 1px #ffffff')
    expect(asGlyph('shark').glow, 'food glow').toContain('#a0622a')
    expect(asGlyph('bronze_dagger').glow, 'an ordinary item takes none').toBeNull()
  })

  it('leaves a tint that is already a literal colour alone', () => {
    expect(resolveIconTint('#123456')).toBe('#123456')
    expect(resolveIconTint('currentColor')).toBe('currentColor')
    expect(resolveIconTint('var(--not-a-real-token)')).toBe(ICON_TINT_HEX['--color-parchment'])
    expect(resolveIconTint(null)).toBe(ICON_TINT_HEX['--color-parchment'])
  })

  it('resolves nothing when the icon maps have not loaded yet', () => {
    // The world lazy-loads both maps on world entry; a render before they land
    // must degrade to the placeholder rather than throw.
    expect(resolveItemIcon(itemsData.coins, { bespoke: null, glyphs: null }).kind).toBe('none')
    expect(resolveItemIcon(null, { bespoke, glyphs, iconKey: 'not_a_real_icon' }).kind).toBe('none')
  })

  it('resolves a HUD icon key with no item behind it', () => {
    const icon = resolveItemIcon(null, { bespoke, glyphs, iconKey: 'door', color: '#ffffff' })
    expect(icon.kind).not.toBe('none')
    expect(icon.glow, 'HUD icons take no item glow').toBeNull()
  })
})
