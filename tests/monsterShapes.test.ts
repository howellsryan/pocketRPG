import { describe, it, expect } from 'vitest'
import {
  MONSTER_ARCHETYPES, MONSTER_GROUPS, MONSTER_ROLE_STROKE, INKED_STROKE_ROLES,
  LIMB_STROKE_MIN, monsterShapeFor, monsterBounds, monsterPartStrokeWidth,
  isStrokedPart, hasMonsterArchetype,
} from '../src/utils/monsterShapes.js'
import { MONSTER_MOTIONS, monsterShotKind } from '../src/utils/monsterFigures.js'

// The geometry contract. Everything here is a way a monster can silently look
// like it is doing nothing while the fight resolves around it — an attack
// with no drawn limb to animate, a joint on a group that isn't there, a
// creature drawn off the edge of the frame.

const KNOWN_ROLES = new Set(Object.keys(MONSTER_ROLE_STROKE))

describe('monster archetypes', () => {
  it('draws every archetype it lists', () => {
    expect(MONSTER_ARCHETYPES.length).toBeGreaterThan(0)
    for (const a of MONSTER_ARCHETYPES) expect(hasMonsterArchetype(a)).toBe(true)
  })

  it.each(MONSTER_ARCHETYPES)('%s declares a complete body', (archetype) => {
    const shape = monsterShapeFor(archetype)
    expect(typeof shape.label).toBe('string')
    expect(shape.stature).toBeGreaterThan(0)
    expect(shape.death).toBeTruthy()
    expect(Array.isArray(shape.muzzle)).toBe(true)
    expect(Array.isArray(shape.torso)).toBe(true)
    // At least the three styles a fight can ask for.
    for (const style of ['melee', 'ranged', 'magic']) {
      expect(MONSTER_MOTIONS[shape.attacks[style]]).toBeTruthy()
    }
  })

  // A reach attack answering a ranged style is a monster hitting the player
  // from across the lane with nothing crossing it — the player sees the
  // creature swipe at empty air and their own health drop.
  it.each(MONSTER_ARCHETYPES)('%s throws something when it fights at range', (archetype) => {
    const shape = monsterShapeFor(archetype)
    for (const style of ['ranged', 'magic']) {
      expect(monsterShotKind(shape.attacks[style], archetype), `${archetype}/${style}: ${shape.attacks[style]} has no projectile`).toBeTruthy()
    }
  })

  // The failure this prevents: an archetype naming a motion whose group it
  // does not draw. It compiles, it renders, and the monster stands perfectly
  // still while its damage lands on the player.
  it.each(MONSTER_ARCHETYPES)('%s draws a limb for every attack it can make', (archetype) => {
    const shape = monsterShapeFor(archetype)
    const motions = [...Object.values(shape.attacks), shape.heavy].filter(Boolean) as string[]
    for (const motion of motions) {
      const group = MONSTER_MOTIONS[motion]
      expect(group, `${archetype}: unknown motion ${motion}`).toBeTruthy()
      expect(shape.parts[group], `${archetype}: motion ${motion} animates .${group}, which it does not draw`).toBeTruthy()
    }
  })

  it.each(MONSTER_ARCHETYPES)('%s pivots only groups it draws', (archetype) => {
    const shape = monsterShapeFor(archetype)
    expect(shape.joints).toBeTruthy()
    for (const group of Object.keys(shape.joints)) {
      expect(shape.parts[group], `${archetype}: joint for .${group}, which it does not draw`).toBeTruthy()
    }
    // Every animatable group that is drawn needs a pivot, or it rotates about
    // the middle of the viewBox instead of its own shoulder.
    for (const group of ['arm', 'head', 'tail', 'wing']) {
      if (shape.parts[group]) expect(shape.joints[group], `${archetype}: .${group} drawn with no joint`).toBeTruthy()
    }
  })

  it.each(MONSTER_ARCHETYPES)('%s draws only known roles, in known groups', (archetype) => {
    const shape = monsterShapeFor(archetype)
    for (const group of Object.keys(shape.parts)) {
      expect(MONSTER_GROUPS, `${archetype}: unknown group ${group}`).toContain(group)
      for (const part of shape.parts[group]) {
        const [tag, , role] = part
        expect(['path', 'circle', 'ellipse']).toContain(tag)
        expect(KNOWN_ROLES, `${archetype}/${group}: unknown role ${role}`).toContain(role)
        // A stroked part with no width is invisible; a filled one may have 0.
        if (isStrokedPart(part)) expect(monsterPartStrokeWidth(part, 1)).toBeGreaterThan(0)
      }
    }
  })

  // `flier: true` is what selects the wingbeat, and the wingbeat selects
  // `.inkm-wing`. Declared without one it matches nothing: Vespula and the
  // imps shipped wingless, with their wings buried in the far-side group
  // where nothing could beat them.
  it('draws a wing for every archetype that flies', () => {
    for (const archetype of MONSTER_ARCHETYPES) {
      const shape = monsterShapeFor(archetype)
      if (!shape.flier) continue
      expect(shape.parts.wing, `${archetype} flies with no wing to beat`).toBeTruthy()
      expect(shape.joints.wing, `${archetype} has a wing with no joint to beat it about`).toBeTruthy()
    }
  })

  it('stands every archetype on the ground it is placed on', () => {
    // Bodies are authored with (0,0) at the feet, so a body floating well
    // above or sunk well below that line is an authoring slip the fit solve
    // cannot correct — it scales, it does not reposition.
    for (const archetype of MONSTER_ARCHETYPES) {
      const shape = monsterShapeFor(archetype)
      const b = monsterBounds(archetype)
      expect(b.minY, `${archetype} has no height`).toBeLessThan(-10)
      if (!shape.hover) expect(b.maxY, `${archetype} floats off its own ground line`).toBeGreaterThan(-8)
    }
  })

  it('divides stroke widths back out by the figure scale', () => {
    // An SVG transform scales stroke along with geometry, so a small creature
    // carrying uncompensated widths reads as a smudge next to a full-weight
    // player. Halving the scale must double the emitted width.
    const part = ['path', 'M0 0 L10 0', 'hide'] as const
    const full = monsterPartStrokeWidth(part as never, 1)
    expect(monsterPartStrokeWidth(part as never, 0.5)).toBeCloseTo(full * 2)
  })

  it('reads stroked-vs-filled off the geometry, not a flag', () => {
    expect(isStrokedPart(['path', 'M0 0 L10 0', 'hide'] as never)).toBe(true)
    expect(isStrokedPart(['path', 'M0 0 L10 0 L10 10 Z', 'hide'] as never)).toBe(false)
    expect(isStrokedPart(['path', 'M0 0 L10 0 L10 10 Z', 'hide', 2, { fill: 'none' }] as never)).toBe(true)
    expect(isStrokedPart(['circle', { cx: 0, cy: 0, r: 4 }, 'eye'] as never)).toBe(false)
  })

  it('inks only material strokes, and only at limb weight', () => {
    for (const role of INKED_STROKE_ROLES) expect(KNOWN_ROLES).toContain(role)
    expect(INKED_STROKE_ROLES.has('line')).toBe(false)
    expect(INKED_STROKE_ROLES.has('pupil')).toBe(false)
    expect(LIMB_STROKE_MIN).toBeGreaterThan(0)
  })
})
