// ──────────────────────────────────────────────────────────────────────────
// The drawn weapons — one profile per WEAPON_ICON_TYPES entry
// (utils/actionSprites.js), rendered by InkwrightCombatStage's CombatTool.
//
// EVERY WEAPON IS AUTHORED IN ITS OWN LOCAL FRAME: origin at the hand, +X
// toward the tip, +Y the edge side (which, at the drawn `angle`, is the
// leading face of a downward swing — so the sharp side leads). The stage
// places it with translate(grip) rotate(angle).
//
// That frame is the whole reason these read as weapons. The previous shapes
// were authored directly in stage coordinates, so every curve had to be
// pre-rotated ~40deg by hand — which meant nobody could draw a profile, and
// what shipped was stroked lines and flat wedges. In a local frame a blade is
// just a taper to a point, and "sharp" is three things you can actually
// place: edges near-parallel until the last fifth, both boundaries meeting at
// one tip, and a bevel (a shade band down the off-side, a glint down the
// edge).
//
// Pure data — no UI imports, no DOM, no JSX. It lives out here rather than
// inside the component so the geometry is testable in logic-only Vitest and
// rendered into the review page by scripts/gen-weapon-preview.mjs. The component
// is a thin mapper over `parts`.
//
// A part is [tag, geometry, role, strokeWidth?, extraProps?]. `role` names a
// paint in the stage's own CSS (.inkc-w-*); nothing here knows a colour, so a
// theme change can never require an edit in this file.
// ──────────────────────────────────────────────────────────────────────────

// Where the hand is, in the stage's coordinate space (InkwrightFigure's arm
// ends here). Exported because the shot origins below are resolved against it.
export const GRIP_X = 100
export const GRIP_Y = 64

/**
 * Default stroke weight per role, for the parts that don't name their own.
 *
 * THIS IS THE ONLY PLACE STROKE WIDTHS LIVE, and it is in JS rather than CSS
 * for one reason: a scaled copy has to divide them back out. An SVG transform
 * scales stroke along with geometry, so a half-size weapon carrying CSS
 * widths renders at half the outline weight and reads as a wisp beside a
 * figure drawn at full weight — one outline weight for the whole figure is
 * the defining constraint of this style. The renderer can only compensate for
 * a width it knows, so a width left in a stylesheet is a width that silently
 * doesn't get compensated. `shade` has no stroke at all.
 */
/**
 * Which roles carry the ITEM's own colour (`getItemIconTint`). A blade takes
 * it as fill; a bow's limbs, a crossbow's prod and a wand's bands take it as
 * stroke. Without the stroke set, five of the twelve weapons — every ranged
 * and magic one — had no tintable part at all, so a bronze crossbow and a
 * rune crossbow rendered identically and "told apart only by tint" was false
 * for them. Hafts and grips stay untinted: wood and leather are the same
 * whatever the head is made of.
 */
export const TINTED_FILL_ROLES = new Set(['blade'])
export const TINTED_STROKE_ROLES = new Set(['limb', 'band'])

export const ROLE_STROKE = {
  blade: 1.9, guard: 1.8, guardline: 2.2, wood: 1.8, grip: 1.8,
  limb: 3.6, limbink: 5.6, glint: 1.2, line: 1.1, bowstring: 1.6, orb: 1.8, band: 1.8,
}

/**
 * A weapon that is another weapon at a different size. A shortbow IS a small
 * longbow and a dagger IS a small sword, so they are declared as scaled
 * copies rather than a second set of paths that can drift from the first.
 *
 * `scale` is applied as an SVG transform, which scales STROKE WIDTH too — at
 * 0.5 the ink outline halves and the weapon reads as a wisp beside a figure
 * drawn at full weight (one outline weight for the whole figure is the
 * defining constraint of this style, src/index.css). So the renderer divides
 * every stroke width by the scale to cancel that out, and `shotFrom` is
 * scaled the other way, into the parent frame.
 */
const SCALED = {
  shortbow: { from: 'longbow', scale: 0.5, label: 'Shortbow' },
  dagger: { from: 'sword', scale: 0.5, label: 'Dagger' },
}

const BASE = {
  sword: {
    label: 'Sword', angle: -39,
    // A knightly arming sword: lenticular blade, quillons swept very slightly
    // forward, a wheel pommel. Blade-to-hilt is ~3:1 — nearer 2:1 and it
    // silhouettes as a dagger, which is a different weapon in this very file.
    parts: [
      ['path', 'M-19 -4.2 L-7 -4.2 L-7 4.2 L-19 4.2 Z', 'grip'],
      ['circle', { cx: -21.5, cy: 0, r: 4.2 }, 'guard'],
      ['path', 'M-16 -4.2 L-16 4.2 M-12.5 -4.2 L-12.5 4.2 M-9 -4.2 L-9 4.2', 'line', 1.1],
      ['path', 'M-8 -10.5 Q-3 -8.4 -3 0 Q-3 8.4 -8 10.5 Q-6.2 5.4 -6.2 0 Q-6.2 -5.4 -8 -10.5 Z', 'guard'],
      ['path', 'M-3 -4.4 L39 -3.6 L52 0 L39 3.6 L-3 4.4 Z', 'blade'],
      ['path', 'M-3 4.4 L39 3.6 L52 0 L39 1.3 L-3 1.7 Z', 'shade'],
      ['path', 'M4 0 L39 0', 'line', 1.3],
      ['path', 'M1 -3.1 L38 -2.5 L49 -0.6', 'glint', 1.4],
    ],
  },

  scimitar: {
    label: 'Scimitar', angle: -34,
    // Curved, single-edged, belly two-thirds out, converging to a point where
    // BOTH boundaries meet — a tip ending in a flat chisel is the thing that
    // reads blunt. The EDGE is the convex boundary, so the sharp side leads.
    parts: [
      ['path', 'M-19 -4 L-6 -4.2 L-6 4.2 L-19 4 Z', 'grip'],
      ['path', 'M-24 -3.4 Q-27.5 0 -22 4.8 L-19 4 L-19 -4 Z', 'guard'],
      ['path', 'M-6 -11 Q-1 -9 -1 0 Q-1 9 -6 11 Q-4 5.5 -4 0 Q-4 -5.5 -6 -11 Z', 'guard'],
      ['path', 'M-1 -4 C15 -9.5 31 -16 53 -23 C39 -8 19 2 -1 5 Z', 'blade'],
      ['path', 'M-1 5 C19 2 39 -8 53 -23 C40 -5 20 4.6 -1 7.2 Z', 'shade'],
      ['path', 'M1.5 -2.2 C16 -7.6 30 -13.4 48 -20', 'glint', 1.4],
      ['path', 'M0.5 3.4 C18 0.4 36 -8 49 -20.5', 'glint', 1],
    ],
  },

  rapier: {
    label: 'Rapier', angle: -37,
    // Long, needle-thin, straight, diamond section. The swept hilt is what
    // says "rapier" at a glance, but it has to stay SMALL against a very long
    // blade or the weapon reads as a cup on a stick. The knuckle bow lands on
    // the pommel and the rear quillon leaves the cup — drawn floating clear
    // of both, they read as debris beside the hilt rather than part of it.
    parts: [
      ['path', 'M-19 -2.8 L-8 -3 L-8 3 L-19 2.8 Z', 'grip'],
      ['circle', { cx: -21.5, cy: 0, r: 3.4 }, 'guard'],
      ['path', 'M-5 8.4 C-15 10.5 -22 6 -21.5 0', 'guardline', 2.2],
      ['path', 'M-5.5 -7.5 L-15 -11.5', 'guardline', 2.2],
      ['path', 'M-2.5 -12 L0 -12 L0 12 L-2.5 12 Z', 'guard'],
      ['ellipse', { cx: -5, cy: 0, rx: 3.8, ry: 8.2 }, 'guard'],
      ['path', 'M-5 -6.8 C-0.5 -3.8 -0.5 3.8 -5 6.8', 'line', 1.1],
      ['path', 'M-1.5 -2 L46 -1.2 L72 0 L46 1.2 L-1.5 2 Z', 'blade'],
      ['path', 'M-1.5 2 L46 1.2 L72 0 L46 0.4 L-1.5 0.7 Z', 'shade'],
      ['path', 'M2 -1.2 L48 -0.7 L68 0', 'glint', 0.9],
    ],
  },

  godsword: {
    label: 'Godsword', angle: -41,
    // A two-handed greatsword. It has to read BIG next to the sword, and big
    // is WIDTH plus a long two-hand hilt, not just a longer stripe: twin
    // fullers, three bindings, a disc pommel — and wings SWEPT FORWARD along
    // the blade rather than a symmetrical bar, which is what separates the
    // two silhouettes at a glance more than any amount of extra length did.
    parts: [
      ['path', 'M-34 -5.4 L-9 -5.8 L-9 5.8 L-34 5.4 Z', 'grip'],
      ['path', 'M-38 -7 Q-44 0 -38 7 L-34 5.4 L-34 -5.4 Z', 'guard'],
      ['path', 'M-28 -5.5 L-28 5.5 M-21 -5.7 L-21 5.7 M-14 -5.8 L-14 5.8', 'line', 1.3],
      ['path', 'M-13 -14 L4 -22 L8 -16 L-3 -9 Q-3 0 -3 9 L8 16 L4 22 L-13 14 Q-7 7 -7 0 Q-7 -7 -13 -14 Z', 'guard'],
      ['circle', { cx: -5, cy: 0, r: 4.6 }, 'guard'],
      ['path', 'M-3 -10.5 L44 -9 L65 0 L44 9 L-3 10.5 Z', 'blade'],
      ['path', 'M-3 10.5 L44 9 L65 0 L44 3.6 L-3 4.2 Z', 'shade'],
      ['path', 'M8 -4.2 L46 -3.4 M8 4.2 L46 3.4', 'line', 1.4],
      ['path', 'M2 -8 L42 -6.8 L60 -1.2', 'glint', 1.8],
    ],
  },

  maul: {
    label: 'Maul', angle: -43,
    // A two-handed sledge: banded haft, a heavy head with a FLAT STRIKING
    // FACE at the far end and a shadowed body behind it. A head with no
    // visible face has no mass — it reads as a plate stuck on a line.
    parts: [
      ['path', 'M-34 -3.6 L28 -4.2 L28 4.2 L-34 3.6 Z', 'wood'],
      ['path', 'M-37 -4.6 L-31 -4.8 L-31 4.8 L-37 4.6 Z', 'guard'],
      ['path', 'M-25 -4.4 L-25 4.4 M-16 -4.5 L-16 4.5', 'line', 1.2],
      ['path', 'M22 -6 L27 -6.2 L27 6.2 L22 6 Z', 'guard'],
      ['path', 'M27 -12 L34 -16.5 L46 -16.5 L53 -10.5 L53 10.5 L46 16.5 L34 16.5 L27 12 Z', 'blade'],
      ['path', 'M27 12 L34 16.5 L46 16.5 L53 10.5 L53 1.5 L46 5 L34 4 L27 3.4 Z', 'shade'],
      ['path', 'M46 -16.5 L53 -10.5 L53 10.5 L46 16.5 Z', 'blade', 1.7],
      ['path', 'M47.5 -12.5 L51 -9.5 L51 9.5 L47.5 12.5', 'glint', 1.4],
      ['path', 'M34 -16.5 L34 16.5', 'line', 1.2],
      ['circle', { cx: 39.5, cy: -9, r: 2.1 }, 'line', 1.2],
      ['circle', { cx: 39.5, cy: 9, r: 2.1 }, 'line', 1.2],
    ],
  },

  mace: {
    label: 'Mace', angle: -38,
    // A one-handed flanged mace. The flanges are SEPARATE outlined petals
    // laid over the head's barrel, not notches cut into one outline —
    // overlapping strokes are what make them read as individual blades
    // instead of a single pentagon blob. A sphere would be a morning star.
    parts: [
      ['path', 'M-19 -3.6 L-6 -3.8 L-6 3.8 L-19 3.6 Z', 'grip'],
      ['circle', { cx: -21.5, cy: 0, r: 3.6 }, 'guard'],
      ['path', 'M-6 -3.6 L21 -3 L21 3 L-6 3.6 Z', 'guard'],
      ['path', 'M19 -5.6 L24 -5.8 L24 5.8 L19 5.6 Z', 'guard'],
      ['path', 'M24 -5.6 L42 -4.6 L48 0 L42 4.6 L24 5.6 Z', 'blade'],
      ['path', 'M25 -5 L29 -16 L38.5 -13 L40.5 -3.8 Z', 'blade'],
      ['path', 'M25 5 L29 16 L38.5 13 L40.5 3.8 Z', 'blade'],
      ['path', 'M25 5 L29 16 L38.5 13 L40.5 3.8 Z', 'shade'],
      ['path', 'M24 5.6 L42 4.6 L48 0 L42 1.3 L24 1.7 Z', 'shade'],
      ['path', 'M27 -6 L30.5 -13.6 L36.6 -11.4', 'glint', 1.3],
      ['path', 'M43 -2.8 L47 0 L43 2.8', 'glint', 1.1],
    ],
  },

  longbow: {
    // `shotFrom` is the ARROWHEAD at release — just past the riser — not the
    // nock. The nock sits within a unit of the fist, so an arrow launched
    // from there is drawn entirely behind the bow that fired it.
    label: 'Longbow', angle: 0, shot: 'arrow', shotFrom: [24, 0],
    // Held across the body, limbs vertical, +X toward the target. A recurve:
    // limbs bending away from the archer, tips flicking back toward it, a
    // riser thick enough to hold and an arrow shelf on it.
    //
    // Sized and offset FORWARD of the fist rather than centred on it: a bow
    // tall enough to read is tall enough to cross the hood, and a limb tip
    // drawn through the figure's own head is the one flaw nobody stops
    // seeing. That is also where a riser sits on a real bow — the hand is
    // behind the belly, not on the centreline.
    //
    // The string keeps `.inkc-bowstring`: index.css animates that class on a
    // ranged swing (inkcStringDraw), so a rename silently kills the draw.
    parts: [
      ['path', 'M-2 -44 C4 -43 8.5 -39 10.5 -34 C13.5 -23 12 -10 9 0 C12 10 13.5 23 10.5 34 C8.5 39 4 43 -2 44', 'limbink', 6.6],
      ['path', 'M-2 -44 C4 -43 8.5 -39 10.5 -34 C13.5 -23 12 -10 9 0 C12 10 13.5 23 10.5 34 C8.5 39 4 43 -2 44', 'limb', 3.9],
      ['path', 'M5.5 -15 L17 -13.5 L17 13.5 L5.5 15 Z', 'grip'],
      ['path', 'M9.5 -11.5 L9.5 11.5 M13.5 -12.5 L13.5 12.5', 'line', 1.2],
      ['path', 'M15 -3.2 L23 -3.2 L18.5 0 L15 2.4 Z', 'wood', 1.4],
      ['path', 'M-2 -44 L-1 0 L-2 44', 'bowstring', 1.8],
    ],
  },

  crossbow: {
    label: 'Crossbow', angle: -6, shot: 'bolt', shotFrom: [30, -7],
    // A crossbow is a MACHINE, and the read is stock + trigger + short STIFF
    // limbs, not a small bow. The butt stops just behind the fist: a tiller
    // drawn to its true length runs back through the figure's own torso,
    // which reads as the crossbow being impaled in the archer.
    parts: [
      ['path', 'M-19 -4.4 L-13 -6.6 L16 -6.2 L31 -4.4 L31 1.6 L14 3.6 L-8 6.4 L-19 4.4 Z', 'wood'],
      ['path', 'M-13 -6.6 L-13 5.8 M8 -6.2 L8 4.4', 'line', 1.2],
      ['path', 'M-19 -4.4 L-13 -6.6 L-13 5.8 L-19 4.4 Z', 'grip'],
      ['path', 'M-1 5.4 L0 11 L-4.5 11.2 L-6 6 Z', 'guard'],
      ['path', 'M22 -7.4 L31 -7.4 L31 2.4 L22 2.4 Z', 'guard'],
      ['path', 'M25 -26 C33 -17 34.5 -7 30.5 -0.5 C34.5 6 33 16 25 25', 'limbink', 6],
      ['path', 'M25 -26 C33 -17 34.5 -7 30.5 -0.5 C34.5 6 33 16 25 25', 'limb', 3.4],
      ['path', 'M25 -26 L5 -0.5 L25 25', 'bowstring', 1.6],
    ],
  },

  staff: {
    label: 'Staff', angle: -58, shot: 'orb', shotFrom: [52, 0],
    // A quarterstaff with a three-pronged claw CRADLING the orb — the claws
    // are drawn before the orb so their tips pass behind it and the head
    // reads as held rather than balanced on top.
    //
    // The orb keeps `.inkc-orb`: index.css animates that class through the
    // charge (inkcOrbCharge), so it is a hook, not just a paint.
    parts: [
      ['path', 'M-34 -3.2 L36 -3.8 L36 3.8 L-34 3.2 Z', 'wood'],
      ['path', 'M-37 -4.2 L-31 -4.4 L-31 4.4 L-37 4.2 Z', 'guard'],
      ['path', 'M-4 -3.8 L-4 3.8 M8 -3.7 L8 3.7', 'line', 1.2],
      ['path', 'M-26 -4.6 L-13 -4.8 L-13 4.8 L-26 4.6 Z', 'grip'],
      ['path', 'M30 -5.6 L36 -5.8 L36 5.8 L30 5.6 Z', 'guard'],
      ['path', 'M36 -3 C44 -12 53 -15 60 -10', 'limbink', 5.8],
      ['path', 'M36 3 C44 12 53 15 60 10', 'limbink', 5.8],
      ['path', 'M38 0 C46 -1 54 -3 59 -7', 'limbink', 5],
      ['path', 'M36 -3 C44 -12 53 -15 60 -10', 'limb', 3.2],
      ['path', 'M36 3 C44 12 53 15 60 10', 'limb', 3.2],
      ['path', 'M38 0 C46 -1 54 -3 59 -7', 'limb', 2.6],
      ['circle', { cx: 52, cy: 0, r: 8.4 }, 'orb'],
    ],
  },

  wand: {
    label: 'Wand', angle: -42, shot: 'orb', shotFrom: [27, 0],
    // Short, tapered, banded, a CUT gem at the tip rather than a bead — the
    // facet lines are what make it read as a focus and not a twig. The gem
    // carries `.inkc-orb` for the same reason the staff's orb does.
    parts: [
      ['path', 'M-17 -3.4 L-4 -3.2 L-4 3.2 L-17 3.4 Z', 'grip'],
      ['circle', { cx: -19.5, cy: 0, r: 3.2 }, 'guard'],
      ['path', 'M-14 -3.4 L-14 3.4 M-9 -3.3 L-9 3.3', 'line', 1],
      ['path', 'M-4 -3.2 L20 -1.9 L20 1.9 L-4 3.2 Z', 'wood'],
      ['path', 'M6 -2.7 L6 2.7 M14 -2.2 L14 2.2', 'band', 1.8],
      ['path', 'M20 0 L26.5 -7 L34 0 L26.5 7 Z', 'orb'],
      ['path', 'M20 0 L34 0 M26.5 -7 L26.5 7', 'line', 1],
      ['path', 'M22.5 -1.8 L26.5 -5.2', 'glint', 1.3],
    ],
  },
}

/**
 * Every drawable weapon, scaled copies resolved. A scaled entry carries the
 * base's parts unchanged plus its own `scale`; the renderer applies the
 * transform and restores stroke weight, so nothing downstream re-derives it.
 */
export const WEAPON_SHAPES = (() => {
  const out = {}
  for (const [id, spec] of Object.entries(BASE)) out[id] = { ...spec, scale: 1 }
  for (const [id, spec] of Object.entries(SCALED)) {
    const base = BASE[spec.from]
    out[id] = {
      ...base,
      label: spec.label,
      scale: spec.scale,
      scaledFrom: spec.from,
      // In the PARENT frame, which is where the stage resolves a muzzle.
      shotFrom: base.shotFrom ? [base.shotFrom[0] * spec.scale, base.shotFrom[1] * spec.scale] : undefined,
    }
  }
  return out
})()

/** The shape a motion falls back to when the actor carries no weapon type at
 * all — an unarmed player, and the enemy, which is always the generic rig. */
export const DEFAULT_WEAPON_TYPE = { melee: 'sword', ranged: 'longbow', magic: 'staff' }

/**
 * The stroke width a part is drawn at, already compensated for its weapon's
 * scale. Lives here rather than in the renderer because it is the one piece
 * of arithmetic in this system that has been wrong in a shipped build: a
 * scaled copy rides an SVG transform, which scales stroke along with
 * geometry, so a half-size weapon renders at half the outline weight unless
 * the width is divided back out first. Returns 0 for a fill-only part.
 */
export function weaponPartPoints(part) {
  const [tag, geom] = part
  if (tag === 'path') {
    const n = String(geom).match(/-?\d+(?:\.\d+)?/g) || []
    const out = []
    for (let i = 0; i + 1 < n.length; i += 2) out.push([Number(n[i]), Number(n[i + 1])])
    return out
  }
  const rx = tag === 'circle' ? geom.r : geom.rx
  const ry = tag === 'circle' ? geom.r : geom.ry
  return [[geom.cx - rx, geom.cy - ry], [geom.cx + rx, geom.cy + ry]]
}

/**
 * Where a weapon reaches, in stage coordinates, at a given arm rotation —
 * the weapon's own placement (grip + angle + scale) then the arm's rotation
 * about the shoulder, which is what the swing keyframes do.
 *
 * Approximate on purpose: it reads a path's coordinate pairs as points, so a
 * curve's true extent can exceed its control points slightly. That is fine
 * for the thing it guards — a blade long enough to leave the stage during
 * its own wind-up, which misses by tens of units, not by a bezier's bulge.
 */
export function weaponSwingExtent(shape, armDegrees, { gripX = GRIP_X, gripY = GRIP_Y, shoulderX = 84, shoulderY = 58 } = {}) {
  const scale = shape.scale || 1
  const w = (shape.angle * Math.PI) / 180
  const a = (armDegrees * Math.PI) / 180
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const part of shape.parts) {
    for (const [px, py] of weaponPartPoints(part)) {
      const lx = px * scale, ly = py * scale
      const sx = gripX + lx * Math.cos(w) - ly * Math.sin(w)
      const sy = gripY + lx * Math.sin(w) + ly * Math.cos(w)
      const dx = sx - shoulderX, dy = sy - shoulderY
      const x = shoulderX + dx * Math.cos(a) - dy * Math.sin(a)
      const y = shoulderY + dx * Math.sin(a) + dy * Math.cos(a)
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  return { minX, minY, maxX, maxY }
}

export function partStrokeWidth(part, scale) {
  const [, , role, sw] = part
  const declared = sw || ROLE_STROKE[role] || 0
  return declared / (scale || 1)
}

export function weaponShapeFor(weaponIconType, motion) {
  return WEAPON_SHAPES[weaponIconType] || WEAPON_SHAPES[DEFAULT_WEAPON_TYPE[motion]] || WEAPON_SHAPES.sword
}

/**
 * Where a weapon's shot leaves it, in the stage's own unmirrored coordinates:
 * its `shotFrom` (local) rotated by its own `angle` and offset to the grip.
 *
 * Derived, never hard-coded. Three constants used to stand in for this — one
 * per shot KIND — and the bug they caused is instructive: each kind is drawn
 * from a different point on the arm, so reusing one kind's offset for another
 * sent the second shot to wherever the first's origin implied and it landed
 * short of the torso. With a shortbow (a scaled copy, so a different muzzle
 * again) and a wand (whose gem sits nowhere near the staff's orb) both in the
 * set, per-kind constants cannot be right for more than one member of a kind.
 */
export function weaponMuzzle(weaponIconType, motion) {
  const drawn = weaponShapeFor(weaponIconType, motion)
  // A weapon that FIRES must fire from somewhere, even when the shape it is
  // drawn as has no muzzle — a name rule could legitimately draw a thrown
  // knife as a dagger, and returning null there deletes the projectile
  // instead of misplacing it. Nothing shipped hits this today; it is here so
  // the failure mode is "an odd origin" rather than "no visible attack".
  const firing = motion === 'ranged' || motion === 'magic'
  const shape = drawn.shotFrom || !firing ? drawn : WEAPON_SHAPES[DEFAULT_WEAPON_TYPE[motion]]
  if (!shape.shotFrom) return null
  const rad = (shape.angle * Math.PI) / 180
  const [x, y] = shape.shotFrom
  return {
    x: GRIP_X + x * Math.cos(rad) - y * Math.sin(rad),
    y: GRIP_Y + x * Math.sin(rad) + y * Math.cos(rad),
  }
}
