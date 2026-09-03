import { describe, expect, it } from 'vitest'
import itemsData from '../src/data/items.json'
import skillsData from '../src/data/skills.json'
import bespokeIconsData from '../src/data/bespokeIcons.json'
import gameIconsData from '../src/data/gameIcons.json'
import { getItemIconKey } from '../src/utils/itemIcons.js'
import { resolveItemIcon } from '../src/utils/itemIconResolve.js'
import { getWeaponModel } from '../src/utils/equipModels.js'

const items = itemsData as Record<string, any>
const skills = skillsData as Record<string, any>
const bespokeIcons = bespokeIconsData as Record<string, any>
const gameIcons = gameIconsData as Record<string, any>

describe('Runeforged Spear', () => {
  it('matches the Runeforged Scimitar combat stats and speed while remaining a spear', () => {
    const spear = items.runeforged_spear
    const scimitar = items.runeforged_scimitar

    expect(spear).toBeTruthy()
    expect(spear.name).toBe('Runeforged Spear')
    expect(spear.legacy_item_id).toBe('rune_spear')
    expect(spear.weaponClass).toBe('spear')
    expect(spear.twoHanded).toBe(true)
    expect(spear.attackSpeed).toBe(scimitar.attackSpeed)
    expect(spear.attackStyle).toBe(scimitar.attackStyle)
    expect(spear.attackBonus).toEqual(scimitar.attackBonus)
    expect(spear.defenceBonus).toEqual(scimitar.defenceBonus)
    expect(spear.otherBonus).toEqual(scimitar.otherBonus)
    expect(spear.requirements).toEqual(scimitar.requirements)
  })

  it('is forged at Smithing 75 from one Runeforged Bar and one Magic Log for 150 XP', () => {
    const recipe = skills.smithing.actions.find((action: any) => action.id === 'smith_rune_spear')

    expect(recipe).toEqual({
      id: 'smith_rune_spear',
      name: 'Smith runeforged spear',
      level: 75,
      ticks: 5,
      xp: 150,
      product: 'runeforged_spear',
      materials: {
        runeforged_bar: 1,
        magic_logs: 1,
      },
    })
  })

  it('renders the bespoke Runeforged Spear SVG instead of the generic spear glyph', () => {
    expect(getItemIconKey(items.runeforged_spear)).toBe('spear')
    expect(bespokeIcons.runeforged_spear).toBeTruthy()

    const icon = resolveItemIcon(items.runeforged_spear, { bespoke: bespokeIcons, glyphs: gameIcons })
    expect(icon.kind).toBe('bespoke')
    expect(icon.body).toContain('runeforged_spear_head')
    expect(icon.body).toContain('#2fd0c0')
    expect(icon.body).toContain('#c6fff8')
  })

  it('uses the existing spear model with Runeforged tint', () => {
    const bronzeModel = getWeaponModel('bronze_spear')
    const runeModel = getWeaponModel('runeforged_spear')
    expect(runeModel).toBeTruthy()
    expect(runeModel?.model).toBe(bronzeModel?.model)
    expect(runeModel?.position).toEqual(bronzeModel?.position)
    expect(runeModel?.rotationDeg).toEqual(bronzeModel?.rotationDeg)
    expect(runeModel?.scale).toBe(bronzeModel?.scale)
    expect(runeModel?.tint).toBe('#2fd0c0')
  })
})
