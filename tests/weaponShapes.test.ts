import { describe, it, expect } from 'vitest'
// @ts-ignore
import { WEAPON_SHAPES, weaponShapeFor, weaponMuzzle, partStrokeWidth, weaponSwingExtent, TINTED_FILL_ROLES, TINTED_STROKE_ROLES, ROLE_STROKE, GRIP_X, GRIP_Y } from '../src/utils/weaponShapes.js'
// @ts-ignore
import { WEAPON_ICON_TYPES, weaponIconTypeFor } from '../src/utils/actionSprites.js'
import itemsData from '../src/data/items.json'

const items = itemsData as Record<string, any>
const weapons = Object.entries(items).filter(([, it]) => it && it.slot === 'weapon')

// The drawn weapons (utils/weaponShapes.js) and the classifier that picks one
// (utils/actionSprites.js) are two lists that must agree. They are deliberately
// separate — §12 forbids one module reading another's export at eval time, so
// WEAPON_ICON_TYPES cannot be derived from WEAPON_SHAPES — and this is what
// stops them drifting apart instead.
describe('weapon shapes ↔ icon types', () => {
  it('every icon type has geometry to draw', () => {
    for (const type of WEAPON_ICON_TYPES) {
      expect(WEAPON_SHAPES[type], `no shape for "${type}"`).toBeTruthy()
      expect(WEAPON_SHAPES[type].parts.length).toBeGreaterThan(0)
    }
  })

  it('has no geometry for a type nothing can classify as', () => {
    for (const type of Object.keys(WEAPON_SHAPES)) expect(WEAPON_ICON_TYPES).toContain(type)
  })

  it('draws every equippable weapon in the game as something', () => {
    for (const [id, item] of weapons) {
      const type = weaponIconTypeFor({ ...item, id })
      // A weapon with no classification falls back per motion; one with a
      // classification that has no shape would silently render as a sword.
      if (type) expect(WEAPON_SHAPES[type], `${id} -> "${type}" has no shape`).toBeTruthy()
    }
  })
})

// The point of scaled copies: a shortbow IS a small longbow and a dagger IS a
// small sword. If these ever stop sharing geometry, the reason to have them as
// copies has gone and they should be authored as their own shapes instead.
describe('scaled copies', () => {
  it('draws the shortbow from the longbow and the dagger from the sword, at half size', () => {
    expect(WEAPON_SHAPES.shortbow.parts).toBe(WEAPON_SHAPES.longbow.parts)
    expect(WEAPON_SHAPES.dagger.parts).toBe(WEAPON_SHAPES.sword.parts)
    expect(WEAPON_SHAPES.shortbow.scale).toBe(0.5)
    expect(WEAPON_SHAPES.dagger.scale).toBe(0.5)
  })

  it('keeps the base weapons at full size', () => {
    expect(WEAPON_SHAPES.longbow.scale).toBe(1)
    expect(WEAPON_SHAPES.sword.scale).toBe(1)
  })

  it('scales the shortbow muzzle with the bow rather than inheriting the longbow reach', () => {
    // The whole reason the muzzle is derived: a scaled copy fires from a
    // scaled point. Sharing the parent's origin would launch the arrow from
    // beyond the string of a bow half that size.
    expect(WEAPON_SHAPES.shortbow.shotFrom[0]).toBe(WEAPON_SHAPES.longbow.shotFrom[0] * 0.5)
  })
})

describe('weaponShapeFor', () => {
  it('falls back per motion for an actor with no weapon type — unarmed, and every enemy', () => {
    expect(weaponShapeFor(null, 'melee')).toBe(WEAPON_SHAPES.sword)
    expect(weaponShapeFor(null, 'ranged')).toBe(WEAPON_SHAPES.longbow)
    expect(weaponShapeFor(null, 'magic')).toBe(WEAPON_SHAPES.staff)
  })

  it('never falls back to a half-size shape — "small" is not derivable from a missing type', () => {
    for (const motion of ['melee', 'ranged', 'magic']) {
      expect(weaponShapeFor(null, motion).scale).toBe(1)
    }
  })

  it('draws something rather than nothing for a type it has never heard of', () => {
    expect(weaponShapeFor('trebuchet', 'melee')).toBe(WEAPON_SHAPES.sword)
  })
})

describe('weaponMuzzle', () => {
  it('gives every firing weapon its own muzzle, and melee weapons none', () => {
    const firing = ['longbow', 'shortbow', 'crossbow', 'staff', 'wand']
    const seen = new Set<string>()
    for (const type of firing) {
      const m = weaponMuzzle(type, type === 'staff' || type === 'wand' ? 'magic' : 'ranged')
      expect(m, `${type} should fire from somewhere`).toBeTruthy()
      seen.add(`${m.x.toFixed(3)},${m.y.toFixed(3)}`)
    }
    // Five weapons, five distinct muzzles — the failure this guards is two of
    // them sharing one origin, which lands the borrowed shot short.
    expect(seen.size).toBe(firing.length)
    for (const type of ['sword', 'dagger', 'scimitar', 'rapier', 'godsword', 'maul', 'mace']) {
      expect(weaponMuzzle(type, 'melee')).toBeNull()
    }
  })

  it('puts the muzzle on the weapon, not on the fist', () => {
    // A muzzle resolving to the grip means the rotation was dropped and every
    // shot would launch out of the wielder's hand regardless of what they hold.
    for (const type of ['longbow', 'crossbow', 'staff', 'wand']) {
      const m = weaponMuzzle(type, type === 'staff' || type === 'wand' ? 'magic' : 'ranged')
      expect(Math.hypot(m.x - GRIP_X, m.y - GRIP_Y)).toBeGreaterThan(1)
    }
  })
})

// Content-driven rather than a list copied out of items.json: these assert the
// RULE over whatever weapons exist today, so a bow added next year is covered
// without touching this file.
describe('classification over real content', () => {
  it('draws every shortbow as a shortbow and every other bow as a longbow', () => {
    const bows = weapons.filter(([id, it]) => /bow/.test(id) && !/crossbow/.test(id) && it.attackStyle === 'ranged')
    expect(bows.length).toBeGreaterThan(5)
    for (const [id] of bows) {
      expect(weaponIconTypeFor({ ...items[id], id })).toBe(/shortbow/.test(id) ? 'shortbow' : 'longbow')
    }
  })

  it('draws every dagger as a dagger', () => {
    const daggers = weapons.filter(([id]) => /dagger/.test(id))
    expect(daggers.length).toBeGreaterThan(3)
    for (const [id] of daggers) expect(weaponIconTypeFor({ ...items[id], id })).toBe('dagger')
  })

  it('sends no crossbow down either bow branch', () => {
    for (const [id, item] of weapons.filter(([id]) => /crossbow/.test(id))) {
      expect(weaponIconTypeFor({ ...item, id })).toBe('crossbow')
    }
  })
})

// A scaled copy rides an SVG transform, which scales STROKE as well as
// geometry. The renderer divides every width back out — but it can only do
// that for a width it knows, so a role whose width lived in the stylesheet
// instead of here would silently render at half weight on a dagger and a
// shortbow, against a figure drawn at full weight. That shipped once.
describe('stroke weight survives a scaled copy', () => {
  it('names a width for every stroked role the weapons actually use', () => {
    const used = new Set<string>()
    for (const shape of Object.values<any>(WEAPON_SHAPES)) {
      for (const [, , role, sw] of shape.parts) if (!sw) used.add(role)
    }
    for (const role of used) {
      if (role === 'shade') continue // fill only, no stroke to weigh
      expect(ROLE_STROKE[role], `role "${role}" has no default stroke width`).toBeGreaterThan(0)
    }
  })

  it('draws a dagger at the same on-screen weight as the sword it is a copy of', () => {
    // The transform multiplies the emitted width by the scale, so emitted x
    // scale is what actually reaches the screen. A dagger stroke must land on
    // the sword's, part for part — they are the same parts array.
    const dagger = WEAPON_SHAPES.dagger
    const sword = WEAPON_SHAPES.sword
    for (let i = 0; i < sword.parts.length; i++) {
      const onScreen = partStrokeWidth(dagger.parts[i], dagger.scale) * dagger.scale
      expect(onScreen, `part ${i} (${sword.parts[i][2]})`).toBeCloseTo(
        partStrokeWidth(sword.parts[i], sword.scale) * sword.scale, 10,
      )
    }
  })

  it('gives a fill-only part no stroke to compensate', () => {
    expect(partStrokeWidth(['path', 'M0 0', 'shade'], 0.5)).toBe(0)
  })

  it('doubles a half-size part\'s emitted width — the compensation itself', () => {
    expect(partStrokeWidth(['path', 'M0 0', 'blade'], 0.5)).toBeCloseTo(ROLE_STROKE.blade * 2, 10)
    expect(partStrokeWidth(['path', 'M0 0', 'blade'], 1)).toBeCloseTo(ROLE_STROKE.blade, 10)
  })

  it('prefers a part\'s own declared width over its role default', () => {
    expect(partStrokeWidth(['path', 'M0 0', 'blade', 5], 1)).toBe(5)
  })
})

// The stage's viewBox is "0 0 260 128" and .inkc-stage clips to it, so a blade
// that reaches past the top during its own wind-up has its tip visibly cut off
// mid-swing. The peak wind-up angles are the first keyframe stop of each
// family in src/index.css (inkcMeleeSwing -58, inkcSmashSwing -92, and the
// gentler ranged/magic/lunge ones), and the recovery stop on the way back.
const WINDUP: Record<string, number[]> = {
  melee: [-58, 46], smash: [-92, 58], lunge: [-9, 3], ranged: [-20, -2], magic: [-15, 12],
}
const FAMILY: Record<string, string> = {
  godsword: 'smash', maul: 'smash', rapier: 'lunge',
  longbow: 'ranged', shortbow: 'ranged', crossbow: 'ranged', staff: 'magic', wand: 'magic',
}
// What shipped before these shapes existed reached -12.9 at full wind-up, so
// that is the bar: no weapon may be worse than the set it replaced.
const WORST_BEFORE = -12.9

describe('a weapon stays on the stage through its own swing', () => {
  for (const [id, shape] of Object.entries<any>(WEAPON_SHAPES)) {
    it(`keeps the ${id} inside the stage at full wind-up`, () => {
      for (const arm of WINDUP[FAMILY[id] || 'melee']) {
        const { minY, maxX, maxY } = weaponSwingExtent(shape, arm)
        expect(minY, `${id} tip above the stage at ${arm}deg`).toBeGreaterThan(WORST_BEFORE)
        expect(maxY, `${id} below the ground line at ${arm}deg`).toBeLessThan(128)
        // 260 is the stage width; a weapon crossing it would be drawn over
        // the enemy rather than reaching toward them.
        expect(maxX, `${id} past the far edge at ${arm}deg`).toBeLessThan(260)
      }
    })
  }
})

describe('material identity', () => {
  it('gives every weapon at least one part that carries the item tint', () => {
    for (const [id, shape] of Object.entries<any>(WEAPON_SHAPES)) {
      const tintable = shape.parts.some(([, , role]: any[]) =>
        TINTED_FILL_ROLES.has(role) || TINTED_STROKE_ROLES.has(role))
      // Without one, every tier of that weapon renders identically — which is
      // the whole basis of "one shape per type, told apart by tint".
      expect(tintable, `${id} has no tintable part, so a bronze and a rune one look the same`).toBe(true)
    }
  })

  it('never tints a haft or a grip — wood and leather do not change with the head', () => {
    for (const role of ['wood', 'grip']) {
      expect(TINTED_FILL_ROLES.has(role)).toBe(false)
      expect(TINTED_STROKE_ROLES.has(role)).toBe(false)
    }
  })
})
