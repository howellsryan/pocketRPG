import { describe, it, expect } from 'vitest'
// @ts-ignore
import { shotOffset } from '../src/components/InkwrightCombatStage.jsx'
// @ts-ignore
import { weaponMuzzle } from '../src/utils/weaponShapes.js'

// Regression coverage for the bug this fixed: the arrow and the magic bolt
// are drawn from two different points on the arm (the bow's string vs the
// staff's orb), but the CSS translate that carries a shot across the lane
// used to be computed from the bolt's origin alone and reused for the arrow
// too. That sent the arrow to wherever the bolt's own offset implied instead
// of where the arrow itself starts, landing it well short of the enemy's
// torso — visually, near the floor.

describe('InkwrightCombatStage — shotOffset', () => {
  it('gives the arrow and the bolt different offsets — they start from different points', () => {
    const arrow = shotOffset('ranged')
    const bolt = shotOffset('magic')
    expect(arrow).not.toBeNull()
    expect(bolt).not.toBeNull()
    expect(arrow!.dy).not.toBe(bolt!.dy)
  })

  it('lands every shot on the torso from its OWN muzzle, not the floor', () => {
    // The enemy's torso, in the same unmirrored space, sits at
    // (260 - 76, 68) = (184, 68). Each weapon's muzzle comes from its own
    // geometry (utils/weaponShapes.js), so this is the one assertion that
    // holds however the weapons are re-drawn.
    for (const [kind, type] of [['ranged', 'longbow'], ['ranged', 'shortbow'], ['ranged', 'crossbow'], ['magic', 'staff'], ['magic', 'wand']]) {
      const muzzle = weaponMuzzle(type, kind)!
      const { dx, dy } = shotOffset(kind, type)!
      expect(muzzle.x + dx, `${type} x`).toBeCloseTo(184, 6)
      expect(muzzle.y + dy, `${type} y`).toBeCloseTo(68, 6)
    }
  })

  it('has no shot for melee, which connects in reach rather than at range', () => {
    expect(shotOffset('melee')).toBeNull()
  })

  it('gives a crossbow and a shortbow their own offsets instead of the longbow\'s', () => {
    const arrow = shotOffset('ranged', 'longbow')
    expect(shotOffset('ranged', 'crossbow')).not.toEqual(arrow)
    // A shortbow is the longbow at half size, so its string — and therefore
    // its muzzle — is nowhere near the longbow's. Sharing the parent's offset
    // is exactly the bug this file exists for, reintroduced by a scaled copy.
    expect(shotOffset('ranged', 'shortbow')).not.toEqual(arrow)
  })

  it('gives a wand its own offset instead of the staff\'s', () => {
    expect(shotOffset('magic', 'wand')).not.toEqual(shotOffset('magic', 'staff'))
  })

  it('falls back to the longbow for a ranged actor carrying no weapon type', () => {
    expect(shotOffset('ranged', undefined)).toEqual(shotOffset('ranged', 'longbow'))
  })
})
