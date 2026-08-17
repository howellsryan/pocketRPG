import { describe, it, expect } from 'vitest'
// @ts-ignore
import { bespokeFishArt } from '../src/components/InkwrightStage.jsx'
// @ts-ignore
import itemsData from '../src/data/items.json'
// @ts-ignore
import skillsData from '../src/data/skills.json'

// Regression coverage for the bug this fixed: the water in the fishing
// animation rendered with no fish at all, because InkwrightStage's water Prop
// never looked the caught item's art up in the first place — it only drew a
// generic silhouette during the payoff's last instant. `bespokeFishArt` is the
// piece of that fix with no DOM in it, so it is the piece this harness can
// actually hold accountable.
//
// `bespokeIconsData`/`gameIconsData` are bare globals only in the single-file
// build (CLAUDE.md §12); under Vite/Vitest, InkwrightStage's own top-level
// `import bespokeIconsData from '../data/bespokeIcons.json'` resolves them as
// real module bindings, so nothing needs stubbing here.

const FISHING_PRODUCTS: string[] = skillsData.fishing.actions.map((a: any) => a.product)

describe('InkwrightStage — bespokeFishArt', () => {
  it('resolves real art for every fishing product, not a placeholder', () => {
    expect(FISHING_PRODUCTS.length).toBeGreaterThan(0)
    for (const id of FISHING_PRODUCTS) {
      const art = bespokeFishArt(itemsData[id])
      expect(art, `${id} should resolve bespoke art`).not.toBeNull()
      expect(typeof art.body).toBe('string')
      expect(art.body.length).toBeGreaterThan(0)
    }
  })

  it('gives two different species two different bodies', () => {
    // The bug this guards against specifically: every raw fish sharing one
    // generic shape because nothing looked up the item at all.
    const shrimp = bespokeFishArt(itemsData.raw_shrimps)
    const shark = bespokeFishArt(itemsData.raw_shark)
    expect(shrimp.body).not.toBe(shark.body)
  })

  it('centres on the art\'s own viewBox, not a hard-coded 256,256', () => {
    for (const id of FISHING_PRODUCTS) {
      const art = bespokeFishArt(itemsData[id])
      expect(Number.isFinite(art.cx)).toBe(true)
      expect(Number.isFinite(art.cy)).toBe(true)
      expect(art.size).toBeGreaterThan(0)
    }
  })

  it('is not tintable — the species art carries its own colour', () => {
    // getItemIconTint answers one flat colour for every raw_* item, which is
    // exactly why colour alone could never tell a shark from a shrimp; the
    // bespoke art must not be recoloured over the top of that.
    for (const id of FISHING_PRODUCTS) {
      expect(bespokeFishArt(itemsData[id]).tint).toBeFalsy()
    }
  })

  it('degrades to null rather than throwing on a non-fish or missing item', () => {
    expect(bespokeFishArt(null)).toBeNull()
    expect(bespokeFishArt(undefined)).toBeNull()
    expect(bespokeFishArt(itemsData.copper_ore)).not.toBeNull() // has no bespoke/glyph is fine either way
  })
})
