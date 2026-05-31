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

  it('derives weakness from the lowest defence bonus, melee grouped', () => {
    const m = {
      defenceBonus: { stab: 10, slash: 12, crush: 11, ranged: 40, magic: -5 },
    }
    expect(getMonsterWeakness(m as any)).toBe('magic')
    const m2 = {
      defenceBonus: { stab: -20, slash: 50, crush: 50, ranged: 60, magic: 70 },
    }
    expect(getMonsterWeakness(m2 as any)).toBe('melee')
    expect(getMonsterWeakness({} as any)).toBeNull()
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
