import { describe, it, expect } from 'vitest'
import bespokeIcons from '../src/data/bespokeIcons.json'
import iconTiers from '../src/assets/icon-tiers.json'
import { buildBespokeIcons } from '../scripts/build-bespoke-icons.cjs'

// Bespoke, PocketRPG-owned full-color SVG icons (src/assets/icons/*.svg bundled
// by scripts/build-bespoke-icons.cjs). GameIcon renders these as-authored, keyed
// 1:1 by entity id, ahead of the shared game-icons glyphs.
const entries = Object.entries(bespokeIcons as Record<string, { body: string; viewBox: string | null }>)

describe('bespoke icon set', () => {
  it('is non-empty', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  it('every entry has a well-formed SVG body and viewBox', () => {
    for (const [id, entry] of entries) {
      expect(typeof entry.body, id).toBe('string')
      expect(entry.body.trim().length, id).toBeGreaterThan(0)
      expect(entry.body.trim().startsWith('<'), id).toBe(true)
      // viewBox is null (default 512 square) or a 4-number string
      if (entry.viewBox !== null) {
        expect(entry.viewBox, id).toMatch(/^[\d.]+ [\d.]+ [\d.]+ [\d.]+$/)
      }
    }
  })

  it('keys are normalized entity ids (lower snake_case)', () => {
    for (const [id] of entries) {
      expect(id, id).toMatch(/^[a-z0-9_]+$/)
    }
  })

  it('includes the pilot batch ids', () => {
    const pilot = ['coins', 'bronze_dagger', 'runeforged_scimitar', 'fire_rune', 'goblin_head', 'mining']
    for (const id of pilot) {
      expect(bespokeIcons, id).toHaveProperty(id)
    }
  })

  // Every icon body is injected into one shared DOM id namespace, so a gradient
  // id reused by two icons makes the second render with the first one's colours.
  it('never reuses a defs id across two icons', () => {
    const owner = new Map<string, string>()
    const collisions: string[] = []
    for (const [id, entry] of entries) {
      for (const match of entry.body.matchAll(/\bid="([^"]+)"/g)) {
        const defId = match[1]
        if (owner.has(defId)) collisions.push(`${defId}: ${owner.get(defId)} & ${id}`)
        else owner.set(defId, id)
      }
    }
    expect(collisions).toEqual([])
  })

  // A template that fills with url(#{{id}}_body) but defines {{id}}_face renders
  // the shape black — invisible on the dark UI and silent in the build script.
  it('resolves every url(#…) fill against a defs id in the same icon', () => {
    const dangling: string[] = []
    for (const [id, entry] of entries) {
      const defined = new Set([...entry.body.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))
      for (const match of entry.body.matchAll(/url\(#([^)]+)\)/g)) {
        if (!defined.has(match[1])) dangling.push(`${id} -> ${match[1]}`)
      }
    }
    expect(dangling).toEqual([])
  })

  // GameIcon only applies a tint to entries flagged `tintable`; an unflagged
  // currentColor body renders in the inherited colour, so every variant sharing
  // it (the three charm tiers) comes out identical.
  it('flags exactly the currentColor bodies as tintable', () => {
    for (const [id, entry] of entries as [string, { body: string; tintable?: boolean }][]) {
      expect(!!entry.tintable, id).toBe(entry.body.includes('currentColor'))
    }
  })

  // bespokeIcons.json is generated; a palette/set edit that never got a
  // `node scripts/build-bespoke-icons.cjs` run silently ships the old art.
  it('is up to date with every templated family declared in icon-tiers.json', () => {
    const tiers = iconTiers as { items: Record<string, string[]>; sets: Record<string, Record<string, string>> }
    const expected: string[] = []
    for (const [shape, tierList] of Object.entries(tiers.items)) {
      for (const tier of tierList) expected.push(`${tier}_${shape}`)
    }
    for (const idMap of Object.values(tiers.sets)) expected.push(...Object.keys(idMap))
    const missing = expected.filter((id) => !(id in bespokeIcons))
    expect(missing).toEqual([])
  })

  // The committed JSON must be exactly what the sources on disk produce. An
  // entry hand-added to it (grindman_helm was, with no src/assets/icons file)
  // vanishes the next time anyone regenerates — and the icon it belonged to
  // silently falls back to a glyph or the 📦 placeholder.
  it('matches a fresh regen from src/assets/icons and the templates', () => {
    const { icons } = buildBespokeIcons()
    const fresh = Object.keys(icons)
    const committed = Object.keys(bespokeIcons)
    expect(committed.filter((id) => !(id in icons)), 'in bespokeIcons.json with no source — a regen deletes these').toEqual([])
    expect(fresh.filter((id) => !(id in bespokeIcons)), 'has a source but is missing from bespokeIcons.json — run node scripts/build-bespoke-icons.cjs').toEqual([])
    expect(icons).toEqual(bespokeIcons)
  })
})
