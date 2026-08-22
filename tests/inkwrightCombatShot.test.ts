import { describe, it, expect } from 'vitest'
// @ts-ignore
import { shotOffset } from '../src/components/InkwrightCombatStage.jsx'
// @ts-ignore
import { weaponMuzzle } from '../src/utils/weaponShapes.js'
// @ts-ignore
import { monsterFigureFor, monsterMuzzle, monsterTorso } from '../src/utils/monsterFigures.js'
import monsters from '../src/data/monsters.json'

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

  // A monster has no weapon geometry — its "muzzle" is its own jaw or its own
  // hand, resolved from its archetype — so it passes the origin in. The
  // arithmetic that carries the shot to the other side must be the SAME one:
  // two copies of "where the opponent's torso is" is how a projectile ends up
  // landing somewhere the splat isn't.
  it('lands a monster shot on the torso from the muzzle it was given', () => {
    for (const id of ['green_dragon', 'ash_wyrm', 'astral_mage', 'razorwing_harpy']) {
      const monster = (monsters as any)[id]
      const figure = monsterFigureFor(monster, 'magic')
      const muzzle = monsterMuzzle(figure)!
      const { dx, dy } = shotOffset('magic', null, muzzle)!
      expect(muzzle.x + dx, `${id} x`).toBeCloseTo(184, 6)
      expect(muzzle.y + dy, `${id} y`).toBeCloseTo(68, 6)
    }
  })

  // The enemy stopped being the player's own rig, so "the other figure's
  // torso" stopped being one constant: a chicken's torso sits ~30px lower on
  // the stage than a harpy's. A fixed landing point put the player's arrow in
  // empty air while the splat appeared on the creature.
  it("lands the player's shot on the MONSTER's own torso, not a constant", () => {
    const seen = new Set<number>()
    for (const id of ['field_chicken', 'razorwing_harpy', 'green_dragon', 'stoneback_crab']) {
      const figure = monsterFigureFor((monsters as any)[id], 'melee')
      const torso = monsterTorso(figure)
      // In the player's unmirrored space the enemy's torso is STAGE_W - its x.
      const landing = { x: 260 - torso.x, y: torso.y }
      const muzzle = weaponMuzzle('longbow', 'ranged')!
      const { dx, dy } = shotOffset('ranged', 'longbow', null, landing)!
      expect(muzzle.x + dx, `${id} x`).toBeCloseTo(landing.x, 6)
      expect(muzzle.y + dy, `${id} y`).toBeCloseTo(landing.y, 6)
      seen.add(Math.round(landing.y))
    }
    // If every monster resolved to the same landing height the assertions
    // above would pass while the bug was still there.
    expect(seen.size).toBeGreaterThan(1)
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
