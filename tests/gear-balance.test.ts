import { describe, it, expect } from 'vitest'
import itemsData from '../src/data/items.json'
import { getActiveSetBonusDisplays, getCombatSetMultipliers } from '../src/engine/combatSetBonuses.js'

// Balance intent guards, not value mirrors: they encode the design rules that a
// harder-to-obtain item must decisively out-class an easier one on its role.
// See docs/gear-balance-review.md.

const magicAtk = (id: string) => (itemsData as any)[id].attackBonus.magic as number
const magicDef = (id: string) => (itemsData as any)[id].defenceBonus.magic as number
const magicDmg = (id: string) => (itemsData as any)[id].otherBonus.magicDamage as number
const def = (id: string) => (itemsData as any)[id].defenceBonus

describe('Kodai magic robe tier', () => {
  it('Kodai Robe Top decisively out-classes the Shroud robe on magic attack', () => {
    expect(magicAtk('kodai_robe_top')).toBeGreaterThanOrEqual(magicAtk('shroud_robes_top') + 15)
  })

  it('the Kodai set leads all magic-attack robes it competes with', () => {
    for (const rival of ['shroud_robes_top', 'morvyn_s_robetop', 'boundless_robe_top', '2nd_age_robe_top']) {
      expect(magicAtk('kodai_robe_top')).toBeGreaterThan(magicAtk(rival))
    }
  })

  it('Kodai is best-in-class magic damage, ahead of the +10% Shardglass set', () => {
    const kodai = magicDmg('kodai_hat') + magicDmg('kodai_robe_top') + magicDmg('kodai_robe_bottom')
    const shard = magicDmg('shardglass_helmet') + magicDmg('shardglass_plate_body') + magicDmg('shardglass_platelegs')
    expect(shard).toBe(10)
    expect(kodai).toBeGreaterThan(shard)
  })

  it('full Kodai set grants a +30% magic-accuracy bonus', () => {
    const equipment = {
      head: { itemId: 'kodai_hat' },
      body: { itemId: 'kodai_robe_top' },
      legs: { itemId: 'kodai_robe_bottom' },
    }
    expect(getCombatSetMultipliers(equipment).magicAccuracy).toBeCloseTo(1.3)
    const display = getActiveSetBonusDisplays(equipment).find((d: any) => d.id === 'kodai')
    expect(display).toBeTruthy()
    expect(display.lines).toContainEqual({ label: 'Magic Accuracy', value: 30, percent: true })
  })

  it('an incomplete Kodai set grants no bonus', () => {
    const equipment = { head: { itemId: 'kodai_hat' }, body: { itemId: 'kodai_robe_top' } }
    expect(getCombatSetMultipliers(equipment).magicAccuracy).toBe(1)
  })
})

describe('Black dragonhide out-defends Red', () => {
  it('every defensive axis of Black beats Red for body and legs', () => {
    for (const [black, red] of [
      ['black_d_hide_body', 'red_d_hide_body'],
      ['black_d_hide_chaps', 'red_d_hide_chaps'],
    ]) {
      for (const axis of ['stab', 'slash', 'crush', 'magic', 'ranged']) {
        expect(def(black)[axis]).toBeGreaterThan(def(red)[axis])
      }
    }
  })
})

describe('Ancient Maul', () => {
  it('is a 5-tick weapon with the gargoyle-maul triple-hit special', () => {
    const maul = (itemsData as any).ancient_maul
    const gargoyle = (itemsData as any).gargoyle_maul
    expect(maul.attackSpeed).toBe(5)
    expect(maul.specialAttack.type).toBe(gargoyle.specialAttack.type)
    expect(maul.specialAttack.energyCost).toBe(gargoyle.specialAttack.energyCost)
  })
})
