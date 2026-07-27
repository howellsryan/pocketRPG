import { describe, it, expect } from 'vitest'
import minigames from '../src/data/minigames.json'
import items from '../src/data/items.json'
import spells from '../src/data/spells.json'
import collectionLog from '../src/data/collectionLog.json'
import worldActivities from '../src/data/worldActivities.json'
import bespokeIcons from '../src/data/bespokeIcons.json'
import equipmentModels from '../src/data/equipmentModels.json'
import {
  hasRequiredRunes,
  getRunesToConsume,
  countRune,
  getEquippedElementalStaff,
} from '../src/engine/runes.js'
import {
  getSpellRuneMagicDamage,
  getSpellRuneDamageTotals,
  getEquipmentBonuses,
  checkEquipRequirements,
} from '../src/engine/equipment.js'
import { spellRuneDamageLabel } from '../src/utils/bonusLabels.js'
import { magicMaxHit } from '../src/engine/formulas.js'
import { getXPForLevel } from '../src/engine/experience.js'
import { isEquippable, typeFilterOf, describeObtainment } from '../src/utils/armoury.js'
import { activityLevelRequirement } from '../src/engine/worldContent.js'

const itemsData = items as Record<string, any>
const spellsData = spells as Record<string, any>
const TOME = 'tomb_of_fire'
const tomeEquipped = { shield: { itemId: TOME } }

describe('Autumntodt minigame', () => {
  it('is a Firemaking 80 venue with a single 5-hour Tomb of Fire grind', () => {
    const mg = (minigames.minigames as any[]).find(m => m.id === 'autumntodt')!
    expect(mg.label).toBe('Autumntodt')
    expect(mg.req).toEqual({ skill: 'firemaking', level: 80 })

    const tasks = (minigames.tasks as any[]).filter(t => t.minigame === 'autumntodt')
    expect(tasks).toHaveLength(1)
    const task = tasks[0]
    expect(task.hours).toBe(5)
    expect(task.ticks).toBe(30000) // 5h at 600ms ticks
    expect(task.product).toBe(TOME)
    expect(task.oneShot).toBe(true)
    expect((minigames.itemNames as Record<string, string>)[TOME]).toBe('Tomb of Fire')
  })

  it('is offered at Catherra and logged under its own collection slot', () => {
    const catherra = (worldActivities as Record<string, any[]>).catherra
    expect(catherra.some(a => a.kind === 'minigame' && a.ref === 'autumntodt')).toBe(true)

    const minigameCat = (collectionLog as any).categories.find((c: any) => c.id === 'minigames')
    const section = minigameCat.sections.find((s: any) => s.id === 'autumntodt')
    expect(section?.items).toEqual([TOME])
  })

  it('gates the world-map row on Firemaking 80, not just the minigame screen', () => {
    expect(activityLevelRequirement('minigame', 'autumntodt')).toEqual({ skill: 'firemaking', level: 80 })
  })

  it('ships bespoke art for both the venue and the book', () => {
    expect((bespokeIcons as Record<string, any>).autumntodt?.body).toBeTruthy()
    expect((bespokeIcons as Record<string, any>)[TOME]?.body).toBeTruthy()
  })
})

describe('Tomb of Fire — item definition', () => {
  const item = itemsData[TOME]

  it('is a Magic 80 shield-slot book priced as a 5-hour minigame reward', () => {
    expect(item.name).toBe('Tomb of Fire')
    expect(item.slot).toBe('shield')
    expect(item.requirements).toEqual({ magic: 80 })
    expect(item.isUntradeable).toBe(true)
    expect(item.shopValue).toBe(250_000 * 5)
    expect(isEquippable(item)).toBe(true)
    expect(typeFilterOf(item)).toBe('magic')
  })

  it('grants +15 magic accuracy and no defence bonuses at all', () => {
    expect(item.attackBonus).toEqual({ stab: 0, slash: 0, crush: 0, magic: 15, ranged: 0 })
    expect(item.defenceBonus).toEqual({ stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 })
    const bonuses = getEquipmentBonuses(tomeEquipped, itemsData)
    expect(bonuses.attackBonus.magic).toBe(15)
    expect(Object.values(bonuses.defenceBonus).every(v => v === 0)).toBe(true)
  })

  it('carries no unconditional magic damage — the 10% is fire-only', () => {
    expect(item.otherBonus.magicDamage).toBe(0)
    expect(item.spellRuneDamage).toEqual({ fire_rune: 10 })
  })

  it('needs Magic 80 to wield', () => {
    const at79: any = { magic: { xp: getXPForLevel(80) - 1 } }
    const at80: any = { magic: { xp: getXPForLevel(80) } }
    expect(checkEquipRequirements(item, at79, new Set())).toBeTruthy()
    expect(checkEquipRequirements(item, at80, new Set())).toBeNull()
  })

  it('reports the minigame as its source in the Armoury', () => {
    expect(describeObtainment(item).some(line => line.includes('Autumntodt'))).toBe(true)
  })
})

describe('Tomb of Fire — unlimited fire runes', () => {
  const fireBolt = spellsData.fire_bolt // { fire_rune: 5, air_rune: 2, chaos_rune: 1 }

  it('supplies fire runes from the shield slot, like a staff does from the weapon slot', () => {
    expect(getEquippedElementalStaff(tomeEquipped, itemsData)?.id).toBe(TOME)
    expect(countRune('fire_rune', [], tomeEquipped, itemsData)).toBe(Infinity)
  })

  it('lets a fire spell cast with zero fire runes carried, still needing the others', () => {
    const otherRunes = [{ itemId: 'air_rune', quantity: 100 }, { itemId: 'chaos_rune', quantity: 100 }]
    expect(hasRequiredRunes(fireBolt.runeReq, otherRunes, {}, tomeEquipped, itemsData)).toBe(true)
    expect(hasRequiredRunes(fireBolt.runeReq, otherRunes, {}, {}, itemsData)).toBe(false)
    // Missing a non-fire rune is still a hard block.
    expect(hasRequiredRunes(fireBolt.runeReq, [{ itemId: 'air_rune', quantity: 100 }], {}, tomeEquipped, itemsData)).toBe(false)
  })

  it('consumes every rune except fire', () => {
    expect(getRunesToConsume(fireBolt.runeReq, tomeEquipped, itemsData)).toEqual({ air_rune: 2, chaos_rune: 1 })
    expect(getRunesToConsume(spellsData.water_bolt.runeReq, tomeEquipped, itemsData)).toEqual(spellsData.water_bolt.runeReq)
  })

  it('does not stack with a fire staff — one unlimited supply is enough', () => {
    const both = { weapon: { itemId: 'staff_of_fire' }, shield: { itemId: TOME } }
    expect(getRunesToConsume(fireBolt.runeReq, both, itemsData)).toEqual({ air_rune: 2, chaos_rune: 1 })
  })
})

describe('Tomb of Fire — 10% fire spell damage', () => {
  it('adds 10 percentage points to fire spells only', () => {
    for (const id of ['fire_strike', 'fire_bolt', 'fire_blast', 'fire_wave', 'fire_surge']) {
      expect(getSpellRuneMagicDamage(tomeEquipped, itemsData, spellsData[id])).toBe(10)
    }
    for (const id of ['wind_bolt', 'water_wave', 'earth_surge']) {
      expect(getSpellRuneMagicDamage(tomeEquipped, itemsData, spellsData[id])).toBe(0)
    }
  })

  it('is worth nothing unworn, and nothing without a spell', () => {
    expect(getSpellRuneMagicDamage({}, itemsData, spellsData.fire_surge)).toBe(0)
    expect(getSpellRuneMagicDamage(tomeEquipped, itemsData, null)).toBe(0)
  })

  it('raises the fire spell max hit by 10% and leaves other elements alone', () => {
    const fireSurge = spellsData.fire_surge
    const base = magicMaxHit(fireSurge.baseDamage, 0)
    const withTome = magicMaxHit(fireSurge.baseDamage, getSpellRuneMagicDamage(tomeEquipped, itemsData, fireSurge))
    expect(base).toBe(47)
    expect(withTome).toBe(51) // floor(47 * 1.1)

    const earthSurge = spellsData.earth_surge
    expect(magicMaxHit(earthSurge.baseDamage, getSpellRuneMagicDamage(tomeEquipped, itemsData, earthSurge)))
      .toBe(magicMaxHit(earthSurge.baseDamage, 0))
  })
})

// The bonus panels (Equipment screen totals + the item modal) have no spell in
// hand, so they read the worn totals and label them by element. Both halves are
// derived from the item field, so a future book needs no display code.
describe('conditional magic damage — bonus panel display', () => {
  it('totals the worn element bonuses for the Equipment screen', () => {
    expect(getSpellRuneDamageTotals(tomeEquipped, itemsData)).toEqual({ fire_rune: 10 })
    expect(getSpellRuneDamageTotals({}, itemsData)).toEqual({})
    expect(getSpellRuneDamageTotals({ shield: { itemId: 'arcane_grimoire' } }, itemsData)).toEqual({})
  })

  it('sums two books of the same element rather than showing the last one', () => {
    const twoBooks: any = { fire_tome_a: { spellRuneDamage: { fire_rune: 10 } }, fire_tome_b: { spellRuneDamage: { fire_rune: 5 } } }
    const worn = { shield: { itemId: 'fire_tome_a' }, cape: { itemId: 'fire_tome_b' } }
    expect(getSpellRuneDamageTotals(worn, twoBooks)).toEqual({ fire_rune: 15 })
  })

  it('names the element in the label, derived from the rune id', () => {
    expect(spellRuneDamageLabel('fire_rune')).toBe('Magic Damage (Fire spells)')
    // Future elements label themselves — no table to extend.
    expect(spellRuneDamageLabel('water_rune')).toBe('Magic Damage (Water spells)')
    expect(spellRuneDamageLabel('blood_rune')).toBe('Magic Damage (Blood spells)')
    expect(spellRuneDamageLabel('')).toBe('Magic Damage %')
  })
})

describe('magic weapon attack speeds', () => {
  it('swings the Trident of Venom every 4 ticks', () => {
    expect(itemsData.trident_of_venom.attackSpeed).toBe(4)
  })

  it('keeps the Attuned staff exactly one tick ahead of every other Duskmare staff', () => {
    expect(itemsData.attuned_duskmare_staff.attackSpeed).toBe(3)
    for (const id of ['duskmare_staff', 'umbral_duskmare_staff', 'volatile_duskmare_staff']) {
      expect(itemsData[id].attackSpeed).toBe(4)
    }
    expect(itemsData.attuned_duskmare_staff.description).toContain('one tick faster')
  })
})

describe('3D shield placement', () => {
  it('hangs both spellbooks off the arcane kiteshield placement, recoloured', () => {
    const gear = (equipmentModels as any).gear
    const shield = gear.arcane_kiteshield
    for (const id of ['tomb_of_fire', 'arcane_grimoire']) {
      const entry = gear[id]
      expect(entry.model).toBe(shield.model)
      expect(entry.slot).toBe('shield')
      expect(entry.bone).toBe(shield.bone)
      expect(entry.position).toEqual(shield.position)
      expect(entry.rotationDeg).toEqual(shield.rotationDeg)
      expect(entry.scale).toBe(shield.scale)
      expect(entry.tint).not.toBe(shield.tint) // own colour, shared rig
    }
  })
})
