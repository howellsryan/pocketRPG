import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HIDE_PALETTES, PALETTE_NAMES } from '../src/utils/monsterFigures.js'
import { HIDE_PALETTE_HEX, hidePaletteHexFor } from '../src/utils/hidePaletteHex.js'

const HEX = /^#[0-9a-f]{6}$/i

describe('hide palette hex parity — idle game vs open world', () => {
  it('HIDE_PALETTE_HEX has every name HIDE_PALETTES has, and nothing else', () => {
    expect(Object.keys(HIDE_PALETTE_HEX).sort()).toEqual([...PALETTE_NAMES].sort())
  })

  it('every value is a literal hex colour', () => {
    for (const [name, hex] of Object.entries(HIDE_PALETTE_HEX)) {
      expect(HEX.test(hex), `${name}: ${hex}`).toBe(true)
    }
  })

  it('matches the --ink-hide-* tokens in src/index.css', () => {
    const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
    const drift: string[] = []
    for (const [name, hex] of Object.entries(HIDE_PALETTE_HEX)) {
      const m = new RegExp(`--ink-hide-${name}:\\s*(#[0-9a-f]{3,8})`, 'i').exec(css)
      if (!m) { drift.push(`--ink-hide-${name} is not defined in src/index.css`); continue }
      if (m[1].toLowerCase() !== hex.toLowerCase()) {
        drift.push(`--ink-hide-${name}: index.css has ${m[1]}, HIDE_PALETTE_HEX has ${hex}`)
      }
    }
    expect(drift, drift.join('\n')).toEqual([])
  })

  it('falls back to flesh for an unknown palette name', () => {
    expect(hidePaletteHexFor('not_a_real_palette')).toBe(HIDE_PALETTE_HEX.flesh)
  })

  it('resolves every real palette name to its own hex', () => {
    for (const name of PALETTE_NAMES) {
      expect(hidePaletteHexFor(name)).toBe(HIDE_PALETTE_HEX[name])
    }
  })
})
