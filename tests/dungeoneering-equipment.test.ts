import { describe, it, expect } from 'vitest'
import items from '../src/data/items.json'
import { checkEquipRequirements, createEquipment, equipItem, getEquipmentBonuses } from '../src/engine/equipment.js'
import { getXPForLevel } from '../src/engine/experience.js'
import { ALL_SKILLS } from '../src/utils/constants.js'

const itemsData = items as Record<string, any>

function statsAtLevels(levels: Record<string, number>): Record<string, { xp: number }> {
  const stats: Record<string, { xp: number }> = {}
  for (const [skill, level] of Object.entries(levels)) {
    stats[skill] = { xp: getXPForLevel(level) }
  }
  return stats
}

const NEW_ITEMS = [
  'chaotic_rapier',
  'chaotic_longsword',
  'chaotic_maul',
  'chaotic_crossbow',
  'chaotic_staff',
  'arcane_necklace',
  'eagle_eyed_kiteshield',
  'arcane_kiteshield',
] as const

describe('dungeoneering: requirement schema integrity', () => {
  it('every item requirement key is a known skill', () => {
    const knownSkills = new Set(ALL_SKILLS)
    for (const [itemId, item] of Object.entries(itemsData)) {
      const reqs = item?.requirements || {}
      for (const skill of Object.keys(reqs)) {
        expect(knownSkills.has(skill), `${itemId} has unknown requirement skill "${skill}"`).toBe(true)
      }
    }
  })

  it('all new dungeoneering reward items exist in items.json', () => {
    for (const id of NEW_ITEMS) {
      expect(itemsData[id], `${id} missing`).toBeDefined()
      expect(itemsData[id].id, `${id} id mismatch`).toBe(id)
    }
  })
})

describe('dungeoneering: equip requirement gates', () => {
  const completedQuests = new Set<string>()

  it('blocks chaotic melee below required attack/strength/dungeoneering', () => {
    const lowAtk = statsAtLevels({ attack: 89, strength: 90, dungeoneering: 80 })
    const lowStr = statsAtLevels({ attack: 90, strength: 89, dungeoneering: 80 })
    const lowDung = statsAtLevels({ attack: 90, strength: 90, dungeoneering: 79 })
    const ok = statsAtLevels({ attack: 90, strength: 90, dungeoneering: 80 })

    for (const id of ['chaotic_rapier', 'chaotic_longsword', 'chaotic_maul']) {
      expect(checkEquipRequirements(itemsData[id], lowAtk, completedQuests)?.reason).toBe('skill')
      expect(checkEquipRequirements(itemsData[id], lowStr, completedQuests)?.reason).toBe('skill')
      expect(checkEquipRequirements(itemsData[id], lowDung, completedQuests)?.reason).toBe('skill')
      expect(checkEquipRequirements(itemsData[id], ok, completedQuests)).toBeNull()
    }
  })

  it('chaotic crossbow requires Ranged 90 + Dungeoneering 80', () => {
    const lowRng = statsAtLevels({ ranged: 89, dungeoneering: 80 })
    const lowDung = statsAtLevels({ ranged: 90, dungeoneering: 79 })
    const ok = statsAtLevels({ ranged: 90, dungeoneering: 80 })
    expect(checkEquipRequirements(itemsData.chaotic_crossbow, lowRng, completedQuests)?.reason).toBe('skill')
    expect(checkEquipRequirements(itemsData.chaotic_crossbow, lowDung, completedQuests)?.reason).toBe('skill')
    expect(checkEquipRequirements(itemsData.chaotic_crossbow, ok, completedQuests)).toBeNull()
  })

  it('chaotic staff requires Magic 90 + Dungeoneering 80', () => {
    const lowMag = statsAtLevels({ magic: 89, dungeoneering: 80 })
    const lowDung = statsAtLevels({ magic: 90, dungeoneering: 79 })
    const ok = statsAtLevels({ magic: 90, dungeoneering: 80 })
    expect(checkEquipRequirements(itemsData.chaotic_staff, lowMag, completedQuests)?.reason).toBe('skill')
    expect(checkEquipRequirements(itemsData.chaotic_staff, lowDung, completedQuests)?.reason).toBe('skill')
    expect(checkEquipRequirements(itemsData.chaotic_staff, ok, completedQuests)).toBeNull()
  })

  it('arcane necklace requires Magic 90 + Dungeoneering 65', () => {
    const lowMag = statsAtLevels({ magic: 89, dungeoneering: 65 })
    const lowDung = statsAtLevels({ magic: 90, dungeoneering: 64 })
    const ok = statsAtLevels({ magic: 90, dungeoneering: 65 })
    expect(checkEquipRequirements(itemsData.arcane_necklace, lowMag, completedQuests)?.reason).toBe('skill')
    expect(checkEquipRequirements(itemsData.arcane_necklace, lowDung, completedQuests)?.reason).toBe('skill')
    expect(checkEquipRequirements(itemsData.arcane_necklace, ok, completedQuests)).toBeNull()
  })

  it('eagle eyed kiteshield requires Defence 70, Ranged 90, Dungeoneering 80', () => {
    const ok = statsAtLevels({ defence: 70, ranged: 90, dungeoneering: 80 })
    expect(checkEquipRequirements(itemsData.eagle_eyed_kiteshield, ok, completedQuests)).toBeNull()
    for (const drop of [
      { defence: 69, ranged: 90, dungeoneering: 80 },
      { defence: 70, ranged: 89, dungeoneering: 80 },
      { defence: 70, ranged: 90, dungeoneering: 79 },
    ]) {
      const stats = statsAtLevels(drop)
      expect(checkEquipRequirements(itemsData.eagle_eyed_kiteshield, stats, completedQuests)?.reason).toBe('skill')
    }
  })

  it('arcane kiteshield requires Defence 70, Magic 90, Dungeoneering 80', () => {
    const ok = statsAtLevels({ defence: 70, magic: 90, dungeoneering: 80 })
    expect(checkEquipRequirements(itemsData.arcane_kiteshield, ok, completedQuests)).toBeNull()
    for (const drop of [
      { defence: 69, magic: 90, dungeoneering: 80 },
      { defence: 70, magic: 89, dungeoneering: 80 },
      { defence: 70, magic: 90, dungeoneering: 79 },
    ]) {
      const stats = statsAtLevels(drop)
      expect(checkEquipRequirements(itemsData.arcane_kiteshield, stats, completedQuests)?.reason).toBe('skill')
    }
  })
})

describe('dungeoneering: two-handed maul behaviour', () => {
  it('chaotic_maul is two-handed, others are one-handed', () => {
    expect(itemsData.chaotic_maul.twoHanded).toBe(true)
    for (const id of ['chaotic_rapier', 'chaotic_longsword', 'chaotic_crossbow', 'chaotic_staff']) {
      expect(itemsData[id].twoHanded, `${id} should be one-handed`).toBe(false)
    }
  })

  it('equipping chaotic_maul unequips the shield slot', () => {
    const eq = createEquipment()
    equipItem(eq, itemsData.bronze_kiteshield, itemsData)
    expect(eq.shield).not.toBeNull()
    const result = equipItem(eq, itemsData.chaotic_maul, itemsData)
    expect(result.equipped).toBe(true)
    expect(eq.shield).toBeNull()
    expect(eq.weapon?.itemId).toBe('chaotic_maul')
  })

  it('equipping a shield while chaotic_maul is wielded unequips the maul', () => {
    const eq = createEquipment()
    equipItem(eq, itemsData.chaotic_maul, itemsData)
    expect(eq.weapon?.itemId).toBe('chaotic_maul')
    expect(eq.weapon?._twoHanded).toBe(true)
    const result = equipItem(eq, itemsData.bronze_kiteshield, itemsData)
    expect(result.equipped).toBe(true)
    expect(eq.weapon).toBeNull()
    expect(eq.shield?.itemId).toBe('bronze_kiteshield')
  })
})

describe('dungeoneering: combat compatibility', () => {
  it('chaotic_crossbow uses bolt ammo (not arrow)', () => {
    expect(itemsData.chaotic_crossbow.ammoType).toBe('bolt')
    expect(itemsData.chaotic_crossbow.attackStyle).toBe('ranged')
  })

  it('chaotic_staff uses magic attack style', () => {
    expect(itemsData.chaotic_staff.attackStyle).toBe('magic')
  })

  it('chaotic weapons use the correct melee styles', () => {
    expect(itemsData.chaotic_rapier.attackStyle).toBe('stab')
    expect(itemsData.chaotic_longsword.attackStyle).toBe('slash')
    expect(itemsData.chaotic_maul.attackStyle).toBe('crush')
  })

  it('arcane_necklace and arcane_kiteshield contribute magic bonuses', () => {
    const eq = createEquipment()
    equipItem(eq, itemsData.arcane_necklace, itemsData)
    equipItem(eq, itemsData.arcane_kiteshield, itemsData)
    const bonuses = getEquipmentBonuses(eq, itemsData)
    expect(bonuses.attackBonus.magic).toBe(
      itemsData.arcane_necklace.attackBonus.magic + itemsData.arcane_kiteshield.attackBonus.magic,
    )
    expect(bonuses.defenceBonus.magic).toBe(
      itemsData.arcane_kiteshield.defenceBonus.magic,
    )
    expect(bonuses.otherBonus.magicDamage).toBe(
      itemsData.arcane_necklace.otherBonus.magicDamage + itemsData.arcane_kiteshield.otherBonus.magicDamage,
    )
  })

  it('eagle_eyed_kiteshield contributes ranged bonuses', () => {
    const eq = createEquipment()
    equipItem(eq, itemsData.eagle_eyed_kiteshield, itemsData)
    const bonuses = getEquipmentBonuses(eq, itemsData)
    expect(bonuses.attackBonus.ranged).toBe(itemsData.eagle_eyed_kiteshield.attackBonus.ranged)
    expect(bonuses.defenceBonus.ranged).toBe(itemsData.eagle_eyed_kiteshield.defenceBonus.ranged)
    expect(bonuses.otherBonus.rangedStrength).toBe(itemsData.eagle_eyed_kiteshield.otherBonus.rangedStrength)
  })
})

describe('dungeoneering: best-in-slot guarantees', () => {
  // Helpers: pick competitor items by intended niche.
  // We compare against existing equippable items only — not the new chaotic items themselves.
  const allItems = Object.values(itemsData) as any[]
  const isWeapon = (it: any) => it?.slot === 'weapon'
  const isShield = (it: any) => it?.slot === 'shield'
  const isNeck = (it: any) => it?.slot === 'neck'
  const styleIs = (it: any, style: string) => it?.attackStyle === style
  const oneHanded = (it: any) => it && !it.twoHanded
  const twoHanded = (it: any) => it && !!it.twoHanded
  const isMelee = (it: any) => ['stab', 'slash', 'crush'].includes(it?.attackStyle)

  const exclude = new Set<string>(NEW_ITEMS)

  function competitors(filter: (it: any) => boolean) {
    return allItems.filter((it) => filter(it) && !exclude.has(it.id))
  }

  it('chaotic_rapier is strictly best one-handed stab weapon', () => {
    const item = itemsData.chaotic_rapier
    const stab = item.attackBonus.stab
    const str = item.otherBonus.meleeStrength
    for (const other of competitors((it) => isWeapon(it) && oneHanded(it) && styleIs(it, 'stab'))) {
      const oStab = other.attackBonus?.stab ?? 0
      const oStr = other.otherBonus?.meleeStrength ?? 0
      expect(stab, `chaotic_rapier stab vs ${other.id}`).toBeGreaterThan(oStab)
      expect(str, `chaotic_rapier melee str vs ${other.id}`).toBeGreaterThanOrEqual(oStr)
    }
  })

  it('chaotic_longsword is strictly best one-handed slash weapon', () => {
    const item = itemsData.chaotic_longsword
    const slash = item.attackBonus.slash
    const str = item.otherBonus.meleeStrength
    for (const other of competitors((it) => isWeapon(it) && oneHanded(it) && styleIs(it, 'slash'))) {
      const oSlash = other.attackBonus?.slash ?? 0
      const oStr = other.otherBonus?.meleeStrength ?? 0
      expect(slash, `chaotic_longsword slash vs ${other.id}`).toBeGreaterThan(oSlash)
      expect(str, `chaotic_longsword melee str vs ${other.id}`).toBeGreaterThanOrEqual(oStr)
    }
  })

  it('chaotic_maul is strictly best two-handed crush weapon', () => {
    const item = itemsData.chaotic_maul
    const crush = item.attackBonus.crush
    const str = item.otherBonus.meleeStrength
    for (const other of competitors((it) => isWeapon(it) && twoHanded(it) && styleIs(it, 'crush'))) {
      const oCrush = other.attackBonus?.crush ?? 0
      const oStr = other.otherBonus?.meleeStrength ?? 0
      expect(crush, `chaotic_maul crush vs ${other.id}`).toBeGreaterThan(oCrush)
      expect(str, `chaotic_maul melee str vs ${other.id}`).toBeGreaterThanOrEqual(oStr)
    }
  })

  it('chaotic_crossbow is strictly best one-handed ranged weapon', () => {
    const item = itemsData.chaotic_crossbow
    const ranged = item.attackBonus.ranged
    const rstr = item.otherBonus.rangedStrength
    for (const other of competitors((it) => isWeapon(it) && oneHanded(it) && styleIs(it, 'ranged'))) {
      const oRng = other.attackBonus?.ranged ?? 0
      const oStr = other.otherBonus?.rangedStrength ?? 0
      expect(ranged, `chaotic_crossbow ranged vs ${other.id}`).toBeGreaterThan(oRng)
      expect(rstr, `chaotic_crossbow ranged str vs ${other.id}`).toBeGreaterThanOrEqual(oStr)
    }
  })

  it('chaotic_staff is strictly best one-handed magic weapon', () => {
    const item = itemsData.chaotic_staff
    const magic = item.attackBonus.magic
    const mdmg = item.otherBonus.magicDamage
    for (const other of competitors((it) => isWeapon(it) && oneHanded(it) && styleIs(it, 'magic'))) {
      const oMag = other.attackBonus?.magic ?? 0
      const oDmg = other.otherBonus?.magicDamage ?? 0
      expect(magic, `chaotic_staff magic vs ${other.id}`).toBeGreaterThan(oMag)
      expect(mdmg, `chaotic_staff magic dmg vs ${other.id}`).toBeGreaterThanOrEqual(oDmg)
    }
  })

  it('arcane_necklace is strictly best magic neck slot', () => {
    const item = itemsData.arcane_necklace
    const magic = item.attackBonus.magic
    const mdmg = item.otherBonus.magicDamage
    for (const other of competitors((it) => isNeck(it))) {
      const oMag = other.attackBonus?.magic ?? 0
      const oDmg = other.otherBonus?.magicDamage ?? 0
      // arcane necklace is the magic-niche neck — must beat magic bonus and not lag in magic dmg
      if (oMag > 0 || oDmg > 0) {
        expect(magic, `arcane_necklace magic vs ${other.id}`).toBeGreaterThan(oMag)
        expect(mdmg, `arcane_necklace magic dmg vs ${other.id}`).toBeGreaterThanOrEqual(oDmg)
      }
    }
  })

  it('eagle_eyed_kiteshield is strictly best ranged shield slot', () => {
    const item = itemsData.eagle_eyed_kiteshield
    const rng = item.attackBonus.ranged
    const rdef = item.defenceBonus.ranged
    for (const other of competitors((it) => isShield(it))) {
      const oRng = other.attackBonus?.ranged ?? 0
      const oDef = other.defenceBonus?.ranged ?? 0
      // The defining stat for a ranged shield is ranged attack bonus.
      if (oRng > 0 || oDef >= rdef) {
        expect(rng, `eagle_eyed_kiteshield ranged atk vs ${other.id}`).toBeGreaterThan(oRng)
      }
      // Don't lag in ranged defence by an unreasonable margin: must be at least as good
      // as any other shield's ranged defence.
      expect(rdef, `eagle_eyed_kiteshield ranged def vs ${other.id}`).toBeGreaterThanOrEqual(oDef)
    }
  })

  it('arcane_kiteshield is strictly best magic shield slot', () => {
    const item = itemsData.arcane_kiteshield
    const mag = item.attackBonus.magic
    const mdef = item.defenceBonus.magic
    for (const other of competitors((it) => isShield(it))) {
      const oMag = other.attackBonus?.magic ?? 0
      const oDef = other.defenceBonus?.magic ?? 0
      if (oMag > 0 || oDef >= mdef) {
        expect(mag, `arcane_kiteshield magic atk vs ${other.id}`).toBeGreaterThan(oMag)
      }
      expect(mdef, `arcane_kiteshield magic def vs ${other.id}`).toBeGreaterThanOrEqual(oDef)
    }
  })
})
