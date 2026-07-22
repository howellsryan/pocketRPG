import { describe, it, expect } from 'vitest'
import itemsData from '../src/data/items.json'

// Balance intent guards, not value mirrors: they encode the design rule that a
// harder-to-obtain boss robe must decisively out-class an easier one on its
// primary offensive stat. See docs/gear-balance-review.md — this is the
// Kodai-vs-Shroud value-inversion these guard against reappearing.

const magicAtk = (id: string) =>
  (itemsData as any)[id].attackBonus.magic as number
const magicDef = (id: string) =>
  (itemsData as any)[id].defenceBonus.magic as number

describe('Kodai magic robe tier', () => {
  it('Kodai Robe Top decisively out-classes the Shroud robe on magic attack', () => {
    expect(magicAtk('kodai_robe_top')).toBeGreaterThanOrEqual(
      magicAtk('shroud_robes_top') + 15,
    )
  })

  it('Kodai Robe Top magic defence is not worse than the cheaper Boundless robe', () => {
    expect(magicDef('kodai_robe_top')).toBeGreaterThanOrEqual(
      magicDef('boundless_robe_top'),
    )
  })

  it('the Kodai set leads all magic-attack robes it competes with', () => {
    const rivals = ['shroud_robes_top', 'morvyn_s_robetop', 'boundless_robe_top', '2nd_age_robe_top']
    for (const rival of rivals) {
      expect(magicAtk('kodai_robe_top')).toBeGreaterThan(magicAtk(rival))
    }
  })

  it('Kodai pieces keep the +2% magic damage signature (raise via a deliberate ladder pass, not here)', () => {
    for (const id of ['kodai_hat', 'kodai_robe_top', 'kodai_robe_bottom']) {
      expect((itemsData as any)[id].otherBonus.magicDamage).toBe(2)
    }
  })
})
