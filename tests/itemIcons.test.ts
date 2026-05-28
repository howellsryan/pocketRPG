import { describe, expect, it } from 'vitest'
import items from '../src/data/items.json'
import gameIcons from '../src/data/gameIcons.json'
import { getItemIconKey } from '../src/utils/itemIcons.js'

const itemsData = items as Record<string, any>
const gameIconsData = gameIcons as Record<string, { body: string; viewBox: string | null }>

describe('itemIcons', () => {
  it('every item resolves to a present glyph', () => {
    const missing: string[] = []
    for (const item of Object.values(itemsData)) {
      const key = getItemIconKey(item)
      if (!gameIconsData[key]) {
        missing.push(`${item.id} → "${key}" (missing in gameIcons.json)`)
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `${missing.length} item(s) resolve to missing glyphs:\n${missing.join('\n')}`
      )
    }
  })

  it('every explicit iconId on an item exists in gameIcons.json', () => {
    const bad: string[] = []
    for (const item of Object.values(itemsData)) {
      if (item.iconId && !gameIconsData[item.iconId]) {
        bad.push(`${item.id} has iconId="${item.iconId}" which is not in gameIcons.json`)
      }
    }
    if (bad.length > 0) {
      throw new Error(bad.join('\n'))
    }
  })

  it('all glyph bodies are non-empty strings starting with SVG content', () => {
    for (const [key, entry] of Object.entries(gameIconsData)) {
      expect(typeof entry.body, `${key}.body should be a string`).toBe('string')
      expect(entry.body.length, `${key}.body should be non-empty`).toBeGreaterThan(0)
      // All game-icons bodies start with a < (SVG element)
      expect(entry.body.trimStart()[0], `${key}.body should start with '<'`).toBe('<')
    }
  })

  it('getItemIconKey returns "default" for null/undefined input', () => {
    expect(getItemIconKey(null)).toBe('default')
    expect(getItemIconKey(undefined)).toBe('default')
  })

  it('coins resolve to the coins glyph', () => {
    expect(getItemIconKey(itemsData.coins)).toBe('coins')
  })

  it('bones resolve to the bones glyph', () => {
    expect(getItemIconKey(itemsData.bones)).toBe('bones')
  })

  it('iron_ore resolves to the ore glyph', () => {
    expect(getItemIconKey(itemsData.iron_ore)).toBe('ore')
  })

  it('logs resolve to the log glyph', () => {
    expect(getItemIconKey(itemsData.logs)).toBe('log')
  })

  it('stab weapons resolve to the dagger glyph', () => {
    const dagger = itemsData.bronze_dagger
    expect(getItemIconKey(dagger)).toBe('dagger')
  })

  it('slash weapons resolve to the sword glyph', () => {
    const scimitar = itemsData.bronze_scimitar
    expect(getItemIconKey(scimitar)).toBe('sword')
  })

  it('crush weapons resolve to the mace glyph', () => {
    const mace = itemsData.bronze_mace
    expect(getItemIconKey(mace)).toBe('mace')
  })

  it('ranged weapons resolve to the bow glyph', () => {
    const bow = itemsData.shortbow
    expect(getItemIconKey(bow)).toBe('bow')
  })

  it('magic weapons resolve to the staff glyph', () => {
    const staff = itemsData.staff
    expect(getItemIconKey(staff)).toBe('staff')
  })

  it('head slot armour resolves to helmet glyph', () => {
    const helm = itemsData.bronze_full_helm
    expect(getItemIconKey(helm)).toBe('helmet')
  })

  it('body slot armour resolves to body glyph', () => {
    const platebody = itemsData.bronze_platebody
    expect(getItemIconKey(platebody)).toBe('body')
  })

  it('dragon_claws resolves to claws glyph', () => {
    expect(getItemIconKey(itemsData.dragon_claws)).toBe('claws')
  })

  it('scythe_of_vythar resolves to scythe glyph', () => {
    expect(getItemIconKey(itemsData.scythe_of_vythar)).toBe('scythe')
  })

  it('fishing_rod resolves to fishing_pole glyph', () => {
    expect(getItemIconKey(itemsData.fishing_rod)).toBe('fishing_pole')
  })
})
