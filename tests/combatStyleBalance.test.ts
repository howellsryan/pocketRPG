import { describe, it, expect } from 'vitest'
import itemsData from '../src/data/items.json' assert { type: 'json' }
import spellsData from '../src/data/spells.json' assert { type: 'json' }
import skillsData from '../src/data/skills.json' assert { type: 'json' }
import raidsData from '../src/data/raids.json' assert { type: 'json' }
import { wornMeleeMaxHit, wornRangedMaxHit, meleeMaxHit, rangedMaxHit, effectiveStrength, effectiveRanged } from '../src/engine/formulas.js'
import { poweredStaffMagicBaseDamage } from '../src/engine/combatPrimitives.js'
import { getEquipmentBonuses } from '../src/engine/equipment.js'

const items = itemsData as Record<string, any>
const spells = spellsData as Record<string, any>

// Balance intent guards for the combat-style rebalance, in the style of
// gear-balance.test.ts: they encode the design rules, not the numbers.
// The level-band parity table itself lives in `gear-benchmark.cjs --by-level`.

describe('worn percentage damage bonuses', () => {
  it('otherBonus.meleeDamage multiplies the final melee max hit', () => {
    const eff = effectiveStrength(99, 0, 1.0, 3)
    const flat = meleeMaxHit(eff, 120)
    expect(wornMeleeMaxHit(eff, { meleeStrength: 120 })).toBe(flat)
    expect(wornMeleeMaxHit(eff, { meleeStrength: 120, meleeDamage: 50 })).toBe(Math.floor(flat * 1.5))
  })

  it('otherBonus.rangedDamage multiplies the final ranged max hit', () => {
    const eff = effectiveRanged(99)
    const flat = rangedMaxHit(eff, 100)
    expect(wornRangedMaxHit(eff, { rangedStrength: 100 })).toBe(flat)
    expect(wornRangedMaxHit(eff, { rangedStrength: 100, rangedDamage: 25 })).toBe(Math.floor(flat * 1.25))
  })

  it('an absent percentage bonus leaves the max hit exactly as before', () => {
    const eff = effectiveStrength(70, 0, 1.0, 3)
    expect(wornMeleeMaxHit(eff, { meleeStrength: 80 })).toBe(meleeMaxHit(eff, 80))
    expect(wornRangedMaxHit(eff, { rangedStrength: 80 })).toBe(rangedMaxHit(eff, 80))
  })

  it('getEquipmentBonuses sums worn meleeDamage / rangedDamage across slots', () => {
    const equipment = {
      neck: { itemId: 'amulet_of_torment' },
      ring: { itemId: 'berserker_ring' },
      cape: { itemId: 'infernal_max_cape' },
    }
    const { otherBonus } = getEquipmentBonuses(equipment, items)
    const expected = ['amulet_of_torment', 'berserker_ring', 'infernal_max_cape']
      .reduce((sum, id) => sum + (items[id].otherBonus?.meleeDamage || 0), 0)
    expect(expected).toBeGreaterThan(0)
    expect(otherBonus.meleeDamage).toBe(expected)
    expect(otherBonus.rangedDamage).toBe(items.infernal_max_cape.otherBonus.rangedDamage)
  })

  it('the melee percentage budget is spread across prestige gear, not one item', () => {
    const carriers = Object.values(items).filter((it: any) => (it.otherBonus?.meleeDamage || 0) > 0)
    expect(carriers.length).toBeGreaterThanOrEqual(5)
    for (const it of carriers as any[]) expect(it.otherBonus.meleeDamage).toBeLessThanOrEqual(15)
  })
})

describe('powered staff tiering', () => {
  it('poweredStaffBaseDamage is the staff base at Magic 75', () => {
    for (const id of ['trident_of_venom', 'sanguine_staff', 'shadow_of_tumaken', 'duskmare_staff']) {
      const staff = items[id]
      expect(staff.poweredStaff, `${id} is a powered staff`).toBe(true)
      expect(poweredStaffMagicBaseDamage(75, staff)).toBe(staff.poweredStaffBaseDamage)
    }
  })

  it('a staff with no authored base keeps the original shared curve', () => {
    expect(poweredStaffMagicBaseDamage(75, null)).toBe(34)
    expect(poweredStaffMagicBaseDamage(99, null)).toBe(42)
    expect(poweredStaffMagicBaseDamage(99, {} as any)).toBe(42)
  })

  it('the powered ladder climbs with staff tier', () => {
    const base = (id: string) => poweredStaffMagicBaseDamage(99, items[id])
    expect(base('duskmare_staff')).toBeLessThan(base('trident_of_venom'))
    expect(base('trident_of_venom')).toBeLessThan(base('sanguine_staff'))
    expect(base('sanguine_staff')).toBeLessThan(base('shadow_of_tumaken'))
  })

  it('never returns less than 1 for a level-1 caster', () => {
    expect(poweredStaffMagicBaseDamage(1, items.duskmare_staff)).toBeGreaterThanOrEqual(1)
  })
})

describe('flagship weapons earn their price', () => {
  const priceOf = (id: string) => Number(items[id].shopValue) || 0

  it('Shadow of Tumaken out-classes every other powered staff', () => {
    const shadow = items.shadow_of_tumaken
    for (const id of ['trident_of_venom', 'sanguine_staff', 'duskmare_staff']) {
      expect(priceOf('shadow_of_tumaken')).toBeGreaterThan(priceOf(id))
      expect(poweredStaffMagicBaseDamage(99, shadow)).toBeGreaterThan(poweredStaffMagicBaseDamage(99, items[id]))
    }
    // It triples worn magic damage; the cap is what decides whether that beats
    // a faster staff at all, so it must clear the +100% every rival can reach.
    expect(shadow.magicDamageMultiplier).toBe(3)
    expect(shadow.magicDamageMultiplierCap).toBeGreaterThan(100)
  })

  it('the Twisted Longbow is fast enough and strong enough for its price', () => {
    const bow = items.twisted_longbow
    expect(bow.scalesWithMagic).toBe(true)
    expect(bow.attackSpeed).toBeLessThanOrEqual(4)
    // Its base ranged strength was so low that a mid-tier bow beat it outright
    // before its magic-scaling multiplier even applied.
    expect(bow.otherBonus.rangedStrength).toBeGreaterThan(items.stonegale_bow.otherBonus.rangedStrength)
  })
})

describe('ranged strength ladder', () => {
  const bowLadder = ['oak_shortbow', 'willow_shortbow', 'maple_shortbow', 'yew_shortbow', 'magic_shortbow']
  const arrowLadder = ['bronze_arrow', 'iron_arrow', 'steel_arrow', 'mithril_arrow', 'adamant_arrow', 'runeforged_arrow', 'dragon_arrow', 'shardglass_arrow', 'seraphic_arrow']

  it('every bow in the shortbow ladder carries ranged strength', () => {
    for (const id of bowLadder) {
      expect(items[id].otherBonus.rangedStrength, `${id} ranged strength`).toBeGreaterThan(0)
    }
  })

  it('the shortbow ladder climbs monotonically', () => {
    const values = bowLadder.map((id) => items[id].otherBonus.rangedStrength)
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1])
  })

  it('the arrow ladder climbs monotonically and no longer dead-ends at Dragon', () => {
    const values = arrowLadder.map((id) => items[id].otherBonus.rangedStrength)
    for (let i = 1; i < values.length; i++) {
      expect(values[i], `${arrowLadder[i]} vs ${arrowLadder[i - 1]}`).toBeGreaterThan(values[i - 1])
    }
  })

  it('an arrow requirement never exceeds the strength tier it sits in', () => {
    const reqOf = (id: string) => Number(items[id].requirements?.ranged || 0)
    expect(reqOf('shardglass_arrow')).toBeGreaterThan(reqOf('dragon_arrow'))
    expect(reqOf('seraphic_arrow')).toBeGreaterThan(reqOf('shardglass_arrow'))
  })
})

describe('new arrows are obtainable', () => {
  const smithing = (skillsData as any).smithing.actions
  const fletching = (skillsData as any).fletching.actions

  it('Shardglass Arrows have a full smith-then-fletch chain', () => {
    const tips = smithing.find((a: any) => a.product === 'shardglass_arrowtips')
    expect(tips, 'shardglass arrowtips smithing action').toBeTruthy()
    for (const mat of Object.keys(tips.materials)) expect(items[mat], `${mat} exists`).toBeTruthy()

    const arrows = fletching.find((a: any) => a.product === 'shardglass_arrow')
    expect(arrows, 'shardglass arrows fletching action').toBeTruthy()
    expect(Object.keys(arrows.materials)).toContain('shardglass_arrowtips')
    for (const mat of Object.keys(arrows.materials)) expect(items[mat], `${mat} exists`).toBeTruthy()

    // Gated above the runeforged rung it sits on top of.
    const runeTips = smithing.find((a: any) => a.product === 'runeforged_arrowtips')
    const runeArrows = fletching.find((a: any) => a.product === 'runeforged_arrow')
    expect(tips.level).toBeGreaterThan(runeTips.level)
    expect(arrows.level).toBeGreaterThan(runeArrows.level)
  })

  it('Seraphic Arrows drop in bulk from the endgame raids', () => {
    const dropping = Object.entries(raidsData as Record<string, any>)
      .filter(([, raid]) => (raid.rewards?.always || []).some((d: any) => d.itemId === 'seraphic_arrow'))
    expect(dropping.length).toBeGreaterThanOrEqual(3)
    for (const [id, raid] of dropping) {
      const drop = raid.rewards.always.find((d: any) => d.itemId === 'seraphic_arrow')
      expect(Array.isArray(drop.quantity), `${id} quantity is a range`).toBe(true)
      expect(drop.quantity[0]).toBeGreaterThan(0)
      expect(drop.quantity[1]).toBeGreaterThan(drop.quantity[0])
      expect(drop.chance).toBeGreaterThan(0)
      expect(drop.chance).toBeLessThanOrEqual(1)
    }
  })

  it('every arrow the raids and recipes reference exists', () => {
    for (const id of ['shardglass_arrow', 'shardglass_arrowtips', 'seraphic_arrow']) {
      expect(items[id], `${id} missing from items.json`).toBeTruthy()
      expect(items[id].id).toBe(id)
    }
    expect(items.shardglass_arrow.ammoKind).toBe('arrow')
    expect(items.seraphic_arrow.ammoKind).toBe('arrow')
    expect(items.shardglass_arrow.stackable).toBe(true)
    expect(items.seraphic_arrow.stackable).toBe(true)
  })
})

describe('standard spell ladder', () => {
  const tiers = ['strike', 'bolt', 'blast', 'wave', 'surge']

  it('each elemental tier is a real step over the one below it', () => {
    const best = tiers.map((tier) =>
      Math.max(...Object.values(spells).filter((s: any) => s.tier === tier).map((s: any) => s.baseDamage)))
    for (let i = 1; i < best.length; i++) {
      // A tier costs ~20 levels; a +1 step made magic flat for 35 levels.
      expect(best[i], `${tiers[i]} vs ${tiers[i - 1]}`).toBeGreaterThanOrEqual(best[i - 1] * 1.2)
    }
  })

  it('base damage rises with the level requirement across the whole ladder', () => {
    const ordered = Object.values(spells)
      .filter((s: any) => Number(s.baseDamage) > 0)
      .sort((a: any, b: any) => a.levelReq - b.levelReq) as any[]
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i].baseDamage, `${ordered[i].id} vs ${ordered[i - 1].id}`)
        .toBeGreaterThanOrEqual(ordered[i - 1].baseDamage)
    }
  })
})
