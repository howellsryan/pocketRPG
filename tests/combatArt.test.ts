import { describe, expect, it } from 'vitest'
import monsters from '../src/data/monsters.json'
import raids from '../src/data/raids.json'
import gameIcons from '../src/data/gameIcons.json'
import {
  CATEGORY_ART,
  RAID_ART,
  MONSTER_ART,
  STYLE_ART,
  getMonsterArt,
  getRaidArt,
  getStyleArt,
  getMonsterWeakness,
  getMonsterMaxHit,
} from '../src/utils/combatArt.js'

const monstersData = monsters as Record<string, any>
const raidsData = raids as Record<string, any>
const gameIconsData = gameIcons as Record<string, { body: string; viewBox: string | null }>

function allArtIcons(): string[] {
  const icons: string[] = []
  for (const v of Object.values(CATEGORY_ART)) icons.push((v as any).icon)
  for (const v of Object.values(RAID_ART)) icons.push((v as any).icon)
  for (const v of Object.values(MONSTER_ART)) icons.push((v as any).icon)
  for (const v of Object.values(STYLE_ART)) icons.push((v as any).icon)
  return icons
}

describe('combatArt', () => {
  it('every art glyph key is vendored in gameIcons.json', () => {
    const missing = allArtIcons().filter((k) => !gameIconsData[k])
    if (missing.length > 0) {
      throw new Error(`missing glyphs: ${[...new Set(missing)].join(', ')}`)
    }
  })

  it('every monster in monsters.json has an emblem (direct or category fallback)', () => {
    const missing: string[] = []
    for (const monster of Object.values(monstersData)) {
      const art = getMonsterArt(monster, undefined)
      if (!art || !gameIconsData[art.icon]) missing.push(monster.id)
    }
    // Every monster must resolve to a real glyph — MONSTER_ART covers them all,
    // and the default fallback is always a present glyph.
    expect(missing).toEqual([])
  })

  it('every raid resolves to a present glyph + accent', () => {
    for (const raid of Object.values(raidsData)) {
      const art = getRaidArt(raid.id)
      expect(gameIconsData[art.icon]).toBeTruthy()
      expect(art.accent).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('derives a single-style weakness from the lowest defence bonus, melee grouped', () => {
    const magicWeak = getMonsterWeakness({ defenceBonus: { stab: 10, slash: 12, crush: 11, ranged: 40, magic: -5 } } as any)
    expect(magicWeak.styles).toEqual(['magic'])
    expect(magicWeak.label).toBe('Magic')
    expect(magicWeak.tier).toBe('single')

    const meleeWeak = getMonsterWeakness({ defenceBonus: { stab: -20, slash: 50, crush: 50, ranged: 60, magic: 70 } } as any)
    expect(meleeWeak.styles).toEqual(['melee'])
    expect(meleeWeak.label).toBe('Melee')

    expect(getMonsterWeakness({} as any)).toBeNull()
  })

  it('reports "All" in gold when every style shares the same defence bonus', () => {
    const w = getMonsterWeakness({ defenceBonus: { stab: -42, slash: -42, crush: -42, magic: -42, ranged: -42 } } as any)
    expect(w.tier).toBe('all')
    expect(w.label).toBe('All')
    expect(w.color).toBe('#f0c040')
    expect(w.styles).toEqual(['melee', 'ranged', 'magic'])
  })

  it('reports a two-style tie in silver (e.g. Melee & Ranged)', () => {
    // melee group min and ranged tie below magic
    const w = getMonsterWeakness({ defenceBonus: { stab: -5, slash: 0, crush: 0, ranged: -5, magic: 8 } } as any)
    expect(w.tier).toBe('multi')
    expect(w.styles).toEqual(['melee', 'ranged'])
    expect(w.label).toBe('Melee & Ranged')
    expect(w.color).toBe('#cdd6e0')
  })

  it('derives a positive integer max hit for each attack style', () => {
    const melee = getMonsterMaxHit({ attackStyle: 'crush', stats: { strength: 90 }, strengthBonus: 20 } as any)
    const ranged = getMonsterMaxHit({ attackStyle: 'ranged', stats: { ranged: 80 }, strengthBonus: 10 } as any)
    const magic = getMonsterMaxHit({ attackStyle: 'magic', stats: { magic: 60 } } as any)
    for (const v of [melee, ranged, magic]) {
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThan(0)
    }
  })

  it('getStyleArt collapses melee sub-styles to a Melee chip', () => {
    expect(getStyleArt('stab').label).toBe('Melee')
    expect(getStyleArt('slash').label).toBe('Melee')
    expect(getStyleArt('crush').label).toBe('Melee')
    expect(getStyleArt('ranged').label).toBe('Ranged')
    expect(getStyleArt('magic').label).toBe('Magic')
    expect(getStyleArt(undefined as any).label).toBe('Melee')
  })
})
