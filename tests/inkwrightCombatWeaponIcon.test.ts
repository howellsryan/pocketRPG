import { describe, it, expect } from 'vitest'
// @ts-ignore
import { viewBoxCenter, WEAPON_ICON_ANCHOR, needsMirror } from '../src/components/InkwrightCombatStage.jsx'
import { ACTION_SPRITES } from '../src/utils/actionSprites.js'
import bespokeIcons from '../src/data/bespokeIcons.json'

// Regression coverage for CombatWeaponIcon's anchoring: it renders the
// actor's own bespoke weapon icon by mapping the icon's own centre (from its
// viewBox) onto the hand, nudged per motion. Getting the centre wrong sends
// every one of the 151 weapon icons off toward a corner instead of the hand.

describe('InkwrightCombatStage — viewBoxCenter', () => {
  it('defaults to the centre of the standard 512x512 bespoke-icon canvas', () => {
    expect(viewBoxCenter(null)).toEqual([256, 256])
    expect(viewBoxCenter(undefined)).toEqual([256, 256])
  })

  it('centres a custom viewBox instead of assuming 512x512', () => {
    expect(viewBoxCenter('0 0 100 200')).toEqual([50, 100])
  })

  it('accounts for a non-zero min-x/min-y origin', () => {
    expect(viewBoxCenter('10 20 100 200')).toEqual([60, 120])
  })

  it('falls back to the standard canvas centre for a malformed viewBox rather than NaN', () => {
    expect(viewBoxCenter('not a viewbox')).toEqual([256, 256])
    expect(viewBoxCenter('0 0 512')).toEqual([256, 256])
  })
})

describe('InkwrightCombatStage — WEAPON_ICON_ANCHOR', () => {
  it('has an anchor for every combat motion CombatWeaponIcon can be asked to draw', () => {
    for (const motion of Object.keys(ACTION_SPRITES)) {
      expect(WEAPON_ICON_ANCHOR).toHaveProperty(motion)
      expect(WEAPON_ICON_ANCHOR[motion].scale).toBeGreaterThan(0)
    }
  })
})

// Regression coverage for the bug this fixed: bespokeIcons.json mixes two
// authoring conventions — a blade drawn diagonally in absolute coordinates
// (dragon_scimitar and its tier-mates, plus zul_kaars_blade's own POSITIVE
// top-level rotate) already leans up-right and must NOT be mirrored, but the
// larger family drawn upright and then rotated a NEGATIVE angle about its
// own centre (maces, longswords, spears, staves, wands, godswords, mauls...)
// swings its business end up-LEFT instead — anchoring both the same way put
// a dragon mace's head over the wielder's own face with its pommel dangling
// out past the hand. `needsMirror` reads the icon's own rotate() to tell the
// two apart instead of guessing.
describe('InkwrightCombatStage — needsMirror', () => {
  it('mirrors the upright-then-negative-rotated family — a dragon mace led with this bug', () => {
    expect(needsMirror(bespokeIcons.dragon_mace.body)).toBe(true)
  })

  it('mirrors every other member of that family too, not just the one that got noticed', () => {
    for (const id of ['bronze_mace', 'dragon_longsword', 'bronze_spear', 'dragon_claws', 'bronze_dagger', 'staff', 'ancestral_wand']) {
      expect(needsMirror((bespokeIcons as any)[id].body)).toBe(true)
    }
  })

  it('leaves the direct-diagonal scimitar family alone — it already leans right', () => {
    expect(needsMirror(bespokeIcons.dragon_scimitar.body)).toBe(false)
  })

  it('leaves a positively-rotated icon alone — it already leans right too', () => {
    expect(needsMirror((bespokeIcons as any).zul_kaars_blade.body)).toBe(false)
  })

  it('leaves an icon with no rotate() at all alone — the bow family', () => {
    expect(needsMirror(bespokeIcons.magic_shortbow.body)).toBe(false)
    expect(needsMirror(null)).toBe(false)
    expect(needsMirror(undefined)).toBe(false)
  })
})
