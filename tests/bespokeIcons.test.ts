import { describe, it, expect } from 'vitest'
import bespokeIcons from '../src/data/bespokeIcons.json'

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
    const pilot = ['coins', 'bronze_dagger', 'runeforged_scimitar', 'fire_rune', 'cave_goblin', 'mining']
    for (const id of pilot) {
      expect(bespokeIcons, id).toHaveProperty(id)
    }
  })
})
