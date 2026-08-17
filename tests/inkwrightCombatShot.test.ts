import { describe, it, expect } from 'vitest'
// @ts-ignore
import { shotOffset } from '../src/components/InkwrightCombatStage.jsx'

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

  it('lands the arrow on the torso from its OWN drawn origin, not the floor', () => {
    // Arrowhead tip is drawn at local (124, 64); the enemy's torso (in the
    // same unmirrored space) sits at (260 - 76, 68) = (184, 68).
    const { dx, dy } = shotOffset('ranged')!
    expect(124 + dx).toBe(184)
    expect(64 + dy).toBe(68)
  })

  it('lands the bolt on the torso from its own origin too', () => {
    // Orb is drawn at local (106, 34).
    const { dx, dy } = shotOffset('magic')!
    expect(106 + dx).toBe(184)
    expect(34 + dy).toBe(68)
  })

  it('has no shot for melee, which connects in reach rather than at range', () => {
    expect(shotOffset('melee')).toBeNull()
  })

  it('gives a crossbow its own shorter bolt offset instead of the arrow\'s', () => {
    const arrow = shotOffset('ranged')
    const bolt = shotOffset('ranged', 'crossbow')
    expect(bolt).not.toBeNull()
    expect(bolt).not.toEqual(arrow)
  })

  it('lands the crossbow bolt on the torso from its own drawn origin', () => {
    // Bolt tip is drawn at local (116, 64); the enemy's torso sits at (184, 68).
    const { dx, dy } = shotOffset('ranged', 'crossbow')!
    expect(116 + dx).toBe(184)
    expect(64 + dy).toBe(68)
  })

  it('every other ranged weapon still fires an arrow, not a bolt', () => {
    expect(shotOffset('ranged', 'bow')).toEqual(shotOffset('ranged'))
    expect(shotOffset('ranged', undefined)).toEqual(shotOffset('ranged'))
  })
})
