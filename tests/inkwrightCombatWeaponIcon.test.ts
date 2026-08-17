import { describe, it, expect } from 'vitest'
// @ts-ignore
import { viewBoxCenter, WEAPON_ICON_ANCHOR } from '../src/components/InkwrightCombatStage.jsx'
import { ACTION_SPRITES } from '../src/utils/actionSprites.js'

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
