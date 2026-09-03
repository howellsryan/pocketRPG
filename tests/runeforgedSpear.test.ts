import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import itemsData from '../src/data/items.json'
import skillsData from '../src/data/skills.json'
import bespokeIconsData from '../src/data/bespokeIcons.json'
import gameIconsData from '../src/data/gameIcons.json'
import iconTiersData from '../src/assets/icon-tiers.json'
import worldActivitiesData from '../src/data/worldActivities.json'
import { resolveItemIcon } from '../src/utils/itemIconResolve.js'
import { getWeaponModel } from '../src/utils/equipModels.js'

const items = itemsData as Record<string, any>
const skills = skillsData as Record<string, any>
const bespokeIcons = bespokeIconsData as Record<string, any>
const gameIcons = gameIconsData as Record<string, any>
const iconTiers = iconTiersData as any
const worldActivities = worldActivitiesData as Record<string, any[]>

const tiers = [
  { tier: 'bronze', recipe: 'smith_bronze_spear', level: 1, xp: 25, bar: 'bronze_bar', logs: 'logs', tint: '#b87333' },
  { tier: 'iron', recipe: 'smith_iron_spear', level: 15, xp: 50, bar: 'iron_bar', logs: 'oak_logs', tint: '#6e747e' },
  { tier: 'steel', recipe: 'smith_steel_spear', level: 30, xp: 75, bar: 'steel_bar', logs: 'willow_logs', tint: '#bcc6d2' },
  { tier: 'mithril', recipe: 'smith_mithril_spear', level: 50, xp: 100, bar: 'mithril_bar', logs: 'maple_logs', tint: '#3f57c4' },
  { tier: 'adamant', recipe: 'smith_adamant_spear', level: 70, xp: 125, bar: 'adamant_bar', logs: 'yew_logs', tint: '#3f8a5a' },
]

describe('metal spear family', () => {
  it('creates Iron through Adamant spears with exact scimitar stat parity', () => {
    for (const { tier } of tiers.filter((x) => x.tier !== 'bronze')) {
      const spear = items[`${tier}_spear`]
      const scimitar = items[`${tier}_scimitar`]
      expect(spear, tier).toBeTruthy()
      expect(spear.weaponClass, tier).toBe('spear')
      expect(spear.twoHanded, tier).toBe(true)
      expect(spear.attackSpeed, tier).toBe(scimitar.attackSpeed)
      expect(spear.attackStyle, tier).toBe(scimitar.attackStyle)
      expect(spear.attackBonus, tier).toEqual(scimitar.attackBonus)
      expect(spear.defenceBonus, tier).toEqual(scimitar.defenceBonus)
      expect(spear.otherBonus, tier).toEqual(scimitar.otherBonus)
      expect(spear.requirements, tier).toEqual(scimitar.requirements)
    }

    const rune = items.runeforged_spear
    const runeScimitar = items.runeforged_scimitar
    expect(rune.attackSpeed).toBe(runeScimitar.attackSpeed)
    expect(rune.attackStyle).toBe(runeScimitar.attackStyle)
    expect(rune.attackBonus).toEqual(runeScimitar.attackBonus)
    expect(rune.defenceBonus).toEqual(runeScimitar.defenceBonus)
    expect(rune.otherBonus).toEqual(runeScimitar.otherBonus)
    expect(rune.requirements).toEqual(runeScimitar.requirements)
  })

  it('adds the requested one-bar + three-log Smithing recipes at bar-smelting levels', () => {
    for (const cfg of tiers) {
      const recipe = skills.smithing.actions.find((action: any) => action.id === cfg.recipe)
      expect(recipe, cfg.tier).toEqual({
        id: cfg.recipe,
        name: `Smith ${cfg.tier} spear`,
        level: cfg.level,
        ticks: 5,
        xp: cfg.xp,
        product: `${cfg.tier}_spear`,
        materials: { [cfg.bar]: 1, [cfg.logs]: 3 },
      })
    }

    expect(skills.smithing.actions.find((a: any) => a.id === 'smith_rune_spear')).toEqual({
      id: 'smith_rune_spear',
      name: 'Smith runeforged spear',
      level: 75,
      ticks: 5,
      xp: 150,
      product: 'runeforged_spear',
      materials: { runeforged_bar: 1, magic_logs: 3 },
    })
  })

  it('exposes every spear recipe anywhere open-world Smithing is available', () => {
    const refs = [...tiers.map((x) => `smithing:${x.recipe}`), 'smithing:smith_rune_spear']
    const places = Object.entries(worldActivities).filter(([, entries]) =>
      entries.some((e) => e.kind === 'skill' && String(e.ref).startsWith('smithing:')),
    )
    expect(places.length).toBeGreaterThan(0)
    for (const [place, entries] of places) {
      const actual = new Set(entries.map((e) => e.ref))
      for (const ref of refs) expect(actual.has(ref), `${place}: ${ref}`).toBe(true)
    }
  })

  it('renders every spear variant from the one shared SVG template with tier tinting', () => {
    expect(iconTiers.items.spear).toEqual(['bronze', 'iron', 'steel', 'mithril', 'adamant', 'runeforged'])
    expect(iconTiers.sets.spear).toMatchObject({
      krylth_spear: 'krylth',
      gorath_s_warspear: 'gorath',
      dragon_hunter_lance: 'dragon',
    })
    expect(fs.existsSync('src/assets/icons/runeforged_spear.svg')).toBe(false)

    const ids = [
      ...tiers.map((x) => `${x.tier}_spear`),
      'runeforged_spear', 'krylth_spear', 'gorath_s_warspear', 'dragon_hunter_lance',
    ]
    for (const id of ids) {
      const icon = resolveItemIcon(items[id], { bespoke: bespokeIcons, glyphs: gameIcons })
      expect(icon.kind, id).toBe('bespoke')
      expect(icon.body, id).toContain(`${id}_head`)
      expect(icon.body, id).toContain(`${id}_wood`)
    }
    expect(bespokeIcons.krylth_spear.body).toContain('values=".35;1;.35"')
    expect(bespokeIcons.krylth_spear.body).toContain('opacity="1"')
    expect(bespokeIcons.bronze_spear.body).toContain('values="0;0;0"')
    expect(bespokeIcons.bronze_spear.body).toContain('opacity="0"')
  })

  it('uses the shared spear 3D model with the correct tint for every metal tier', () => {
    const bronze = getWeaponModel('bronze_spear')
    expect(bronze).toBeTruthy()
    for (const cfg of [...tiers, { tier: 'runeforged', tint: '#2fd0c0' } as any]) {
      const model = getWeaponModel(`${cfg.tier}_spear`)
      expect(model, cfg.tier).toBeTruthy()
      expect(model?.model, cfg.tier).toBe(bronze?.model)
      expect(model?.position, cfg.tier).toEqual(bronze?.position)
      expect(model?.rotationDeg, cfg.tier).toEqual(bronze?.rotationDeg)
      expect(model?.scale, cfg.tier).toBe(bronze?.scale)
      expect(model?.tint, cfg.tier).toBe(cfg.tint)
    }
  })
})
