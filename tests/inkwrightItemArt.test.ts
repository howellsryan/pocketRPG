import { describe, it, expect } from 'vitest'
// @ts-ignore
import { bespokeItemArt } from '../src/components/InkwrightStage.jsx'
// @ts-ignore
import itemsData from '../src/data/items.json'
// @ts-ignore
import skillsData from '../src/data/skills.json'

// Regression coverage for two bugs this one resolver fixed, in two skills.
// Fishing: the water rendered with no fish at all, because InkwrightStage's
// water Prop never looked the caught item's art up — it only drew a generic
// silhouette during the payoff's last instant. Herblore: the mortar's payoff
// drew its OWN hand-authored generic vial on top of the real bespoke potion
// icon the completion overlay already shows, so two differently-styled
// potions appeared for the one payoff. `bespokeItemArt` is the piece of both
// fixes with no DOM in it, so it is the piece this harness can hold
// accountable.
//
// `bespokeIconsData`/`gameIconsData` are bare globals only in the single-file
// build (CLAUDE.md §12); under Vite/Vitest, InkwrightStage's own top-level
// `import bespokeIconsData from '../data/bespokeIcons.json'` resolves them as
// real module bindings, so nothing needs stubbing here.

const FISHING_PRODUCTS: string[] = skillsData.fishing.actions.map((a: any) => a.product)
const HERBLORE_PRODUCTS: string[] = skillsData.herblore.actions.map((a: any) => a.product)

describe('InkwrightStage — bespokeItemArt', () => {
  it('resolves real art for every fishing product, not a placeholder', () => {
    expect(FISHING_PRODUCTS.length).toBeGreaterThan(0)
    for (const id of FISHING_PRODUCTS) {
      const art = bespokeItemArt(itemsData[id])
      expect(art, `${id} should resolve bespoke art`).not.toBeNull()
      expect(typeof art.body).toBe('string')
      expect(art.body.length).toBeGreaterThan(0)
    }
  })

  it('resolves real art for every herblore potion, not a placeholder', () => {
    expect(HERBLORE_PRODUCTS.length).toBeGreaterThan(0)
    for (const id of HERBLORE_PRODUCTS) {
      const art = bespokeItemArt(itemsData[id])
      expect(art, `${id} should resolve bespoke art`).not.toBeNull()
      expect(typeof art.body).toBe('string')
      expect(art.body.length).toBeGreaterThan(0)
    }
  })

  it('gives two different species two different bodies', () => {
    // The bug this guards against specifically: every raw fish sharing one
    // generic shape because nothing looked up the item at all.
    const shrimp = bespokeItemArt(itemsData.raw_shrimps)
    const shark = bespokeItemArt(itemsData.raw_shark)
    expect(shrimp.body).not.toBe(shark.body)
  })

  it('gives two different potions two different bodies', () => {
    // The herblore bug this guards against: the mortar's payoff drawing one
    // generic vial shape regardless of which potion was actually brewed.
    const attack = bespokeItemArt(itemsData.attack_potion)
    const prayer = bespokeItemArt(itemsData.prayer_potion)
    expect(attack.body).not.toBe(prayer.body)
  })

  it('centres on the art\'s own viewBox, not a hard-coded 256,256', () => {
    for (const id of [...FISHING_PRODUCTS, ...HERBLORE_PRODUCTS]) {
      const art = bespokeItemArt(itemsData[id])
      expect(Number.isFinite(art.cx)).toBe(true)
      expect(Number.isFinite(art.cy)).toBe(true)
      expect(art.size).toBeGreaterThan(0)
    }
  })

  it('is not tintable — the item\'s own art carries its own colour', () => {
    // getItemIconTint answers one flat colour for every raw_* item, which is
    // exactly why colour alone could never tell a shark from a shrimp (or one
    // potion from another); the bespoke art must not be recoloured over the
    // top of that.
    for (const id of [...FISHING_PRODUCTS, ...HERBLORE_PRODUCTS]) {
      expect(bespokeItemArt(itemsData[id]).tint).toBeFalsy()
    }
  })

  it('degrades to null rather than throwing on a missing item', () => {
    expect(bespokeItemArt(null)).toBeNull()
    expect(bespokeItemArt(undefined)).toBeNull()
    expect(bespokeItemArt(itemsData.copper_ore)).not.toBeNull() // has no bespoke/glyph is fine either way
  })
})
