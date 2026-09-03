import { describe, expect, it } from 'vitest'
import itemsData from '../src/data/items.json'
import skillsData from '../src/data/skills.json'
import { getItemIconKey } from '../src/utils/itemIcons.js'
import { getWeaponModel } from '../src/utils/equipModels.js'

const items = itemsData as Record<string, any>
const skills = skillsData as Record<string, any>

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

  it('uses the spear icon and existing spear model with Runeforged tint', () => {
    expect(getItemIconKey(items.runeforged_spear)).toBe('spear')

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
