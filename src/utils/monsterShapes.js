// ──────────────────────────────────────────────────────────────────────────
// The drawn monsters — one body per ARCHETYPE, rendered by
// components/MonsterFigure.jsx inside InkwrightCombatStage's enemy side.
//
// This replaces "the enemy is the player's own rig, mirrored, with a coloured
// aura" (docs/action-animations.md called that out as the one deferred gap in
// the combat stage). The economics are deliberately the SAME ones
// utils/weaponShapes.js already proved for 151 weapons: a small fixed set of
// drawings, each told apart within its family by a PALETTE, not one drawing
// per monster. Every dragon in the game is this file's one dragon in a
// different colour, which is both what makes 119 monsters affordable and what
// they actually look like.
//
// EVERY ARCHETYPE IS AUTHORED IN ITS OWN LOCAL FRAME: origin (0,0) at the
// ground directly under the creature, +X the direction it faces, -Y up. The
// stage places it with a single `translate(FOOT_X, GROUND_Y) scale(s)`, so
// nothing in here needs to know where the stage's floor is, how big the
// creature renders, or that the whole enemy side is mirrored. Author facing
// +X and the mirror turns it to face the player for free — the same trick
// every weapon and every shot in the combat stage already relies on.
//
// A body is split into GROUPS, and the split is functional rather than
// anatomical: a group exists when something animates it on its own.
//   back  far-side limbs, drawn first so the body overlaps them
//   tail  idle sway
//   body  torso + weight-bearing legs; carries the whole-body lurch
//   arm   the striking limb — claw/slam/swing motions rotate this
//   head  head + neck — bite/breath/spit motions rotate this
//   wing  near wing — idle beat for fliers, drawn OVER the body
//   fore  anything that must sit in front of everything else
// A group left out simply isn't drawn; a monster with no `arm` cannot play a
// claw, which is why the ATTACKS map below names a motion per style rather
// than letting the renderer guess one.
//
// Pure data — no UI imports, no DOM, no JSX, no colours. A part is
// [tag, geometry, role, strokeWidth?, extraProps?] exactly as in
// weaponShapes.js, and `role` names a paint in the stage's own CSS
// (`.inkm-*`), so a palette change lands in index.css and never here.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Default stroke weight per role, in the archetype's OWN local units.
 *
 * In JS rather than CSS for the same reason weaponShapes.js keeps its widths
 * in JS: the figure is placed with an SVG `scale`, which scales stroke along
 * with geometry. A chicken drawn at 0.6 would carry a 0.6-weight outline and
 * read as a wisp beside a player drawn at full weight — one outline weight
 * for the whole stage is the defining constraint of this style. The renderer
 * divides each width back out by the scale, and it can only do that for a
 * width it knows, so a width left in a stylesheet is a width that silently
 * never gets compensated.
 */
export const MONSTER_ROLE_STROKE = {
  hide: 2.2, belly: 1.9, horn: 1.8, membrane: 1.9, metal: 2, cloth: 2.1,
  far: 2, maw: 1.8, eye: 1.2, pupil: 0, shade: 0, line: 1.2, glow: 0,
  foliage: 2.2, foliagevein: 2,
}

/**
 * A part is STROKED rather than filled when it is an open path — a spider's
 * leg, a tentacle, a rib, a claw. Detected rather than declared, because the
 * geometry already says it: every filled shape in this file is a circle, an
 * ellipse, or a path that closes with Z, and every open path is a line that
 * wants a stroke. A second `stroked: true` flag next to the role would be a
 * fact the drawing already states, free to contradict it, and one nobody
 * would notice was wrong until a leg rendered as a filled blob.
 */
export function isStrokedPart(part) {
  const [tag, geom, , , extra] = part
  if (extra && extra.fill === 'none') return true
  return tag === 'path' && !/[Zz]\s*$/.test(String(geom))
}

/** Stroked parts thick enough to be a LIMB get the ink under-stroke every
 * other figure on this stage has (the `Limb` helper in InkwrightFigure.jsx
 * does the same thing for the player) — one outline weight across the whole
 * stage is the defining constraint of this style. Below this the stroke is a
 * detail line (a claw, a rib, a whisker) and an outline around it would be
 * thicker than the thing itself. */
export const LIMB_STROKE_MIN = 3

/** Which stroked roles are body MATERIAL, and so take that ink outline. The
 * rest — detail lines, mouth lines, pupils, glows — are already ink or light
 * and would only be muddied by one. */
export const INKED_STROKE_ROLES = new Set(['hide', 'belly', 'far', 'membrane', 'cloth', 'metal', 'horn'])

/** Roles painted from the monster's palette rather than a fixed token. The
 * renderer sets the palette as inline custom properties on the figure once,
 * so a role here is a `var(--inkm-*)` lookup in CSS and NOT a per-part style
 * — which is what keeps a 40-part creature from emitting 40 inline styles. */
export const PALETTE_ROLES = new Set(['hide', 'belly', 'shade', 'far', 'horn', 'eye', 'membrane', 'glow'])

// ── The archetypes ────────────────────────────────────────────────────────
//
// `attacks` maps a combat style to a motion class (`.inkm-fig--<motion>` in
// index.css). `heavy` is the melee motion a big monster upgrades to — see
// utils/monsterFigures.js's weight classes; a creature with no heavier way to
// hit (a chicken) simply omits it and keeps its own light motion at every
// size. `death` names the collapse. `muzzle` is where a projectile or a
// breath leaves the creature, in local units — derived from the drawing, not
// guessed, or a dragon's fire starts somewhere behind its jaw.
//
// `joints` is the PIVOT each animated group rotates about, in the same local
// units — a shoulder, a neck, a tail root. It is authored here rather than
// derived from the group's bounding box because a limb rotates about the end
// that is attached to the body, and a bounding box only knows the middle.
// Every group named in `joints` must exist in `parts`, and every motion the
// archetype names must have its group drawn: tests/monsterShapes.test.ts
// checks both, because an attack with nothing to animate looks exactly like a
// monster standing still while the player takes damage.
//
// `stature` is how tall the creature stands RELATIVE TO A PERSON — a chicken
// is 0.3 of the player, a giant 1.25. It is the only size number authored by
// hand; the actual render scale is solved from it against the archetype's own
// measured bounds (utils/monsterFigures.js `monsterFitScale`), so a body can
// be redrawn at any convenient size without anyone having to re-tune a magic
// scale factor to match. That solve is also what keeps every creature inside
// the 260x128 stage — a monster that overflows the frame is invisible at
// exactly the moment it is attacking.

const ARCHETYPES = {

  // ── Reptiles ────────────────────────────────────────────────────────────

  /** The one dragon. Every dragon, drake, wyvern and wyrmling in the game is
   * this body in a different palette at a different size — which is both the
   * affordable answer and the true one. Four legs, a long neck, membranous
   * wings, a whipping tail; the head is a separate group because a dragon
   * bites and breathes with it, and the wing beats on its own clock. */
  dragon: {
    label: 'Dragon',
    attacks: { melee: 'bite', ranged: 'spit', magic: 'breath' },
    heavy: 'maul', death: 'fall', flier: true,
    stature: 0.8,
    muzzle: [44, -62], torso: [-2, -38],
    joints: { arm: [16, -44], head: [8, -52], tail: [-16, -34], wing: [2, -52] },
    parts: {
      back: [
        // Far hind + fore leg, tucked behind the body so the silhouette reads
        // as depth rather than two legs pasted side by side.
        ['path', 'M-19 -32 Q-27 -18 -23 -3 L-14 -3 Q-17 -18 -11 -30 Z', 'far'],
        ['path', 'M14 -30 Q8 -17 12 -3 L21 -3 Q17 -17 22 -29 Z', 'far'],
        // Far wing: a low, half-folded membrane behind the shoulder.
        ['path', 'M-6 -54 Q-30 -74 -46 -62 Q-30 -60 -20 -48 Q-14 -44 -6 -46 Z', 'membrane'],
      ],
      tail: [
        ['path', 'M-18 -34 Q-40 -30 -50 -14 Q-44 -18 -34 -20 Q-24 -22 -16 -28 Z', 'hide'],
        ['path', 'M-34 -20 L-38 -25 M-27 -22 L-30 -28', 'line'],
      ],
      body: [
        // Barrel chest low and forward, haunch high and back — a lizard's
        // weight, not a dog's.
        ['path', 'M-22 -36 Q-24 -52 -6 -56 Q14 -60 24 -48 Q30 -38 24 -26 Q12 -14 -4 -16 Q-20 -20 -22 -36 Z', 'hide'],
        ['path', 'M-8 -20 Q6 -16 20 -26 Q22 -34 18 -40 Q6 -30 -8 -28 Z', 'belly'],
        // Near hind leg + foot with three claws.
        ['path', 'M-14 -34 Q-22 -18 -16 -3 L-4 -3 Q-8 -18 -2 -32 Z', 'hide'],
        ['path', 'M-17 -3 L-19 1 M-11 -3 L-11 1 M-5 -3 L-3 1', 'horn'],
      ],
      arm: [
        // Near foreleg — the limb a claw/maul motion swings. Pivot is the
        // shoulder at (18,-44), which every `.inkm-arm` keyframe rotates.
        ['path', 'M12 -44 Q22 -30 20 -6 L30 -6 Q30 -28 24 -44 Z', 'hide'],
        ['path', 'M20 -6 L17 -1 M25 -6 L25 -1 M30 -6 L33 -1', 'horn'],
      ],
      head: [
        // Neck sweeping up and forward out of the shoulder, then a wedge
        // skull: brow ridge, long snout, hinged lower jaw, swept horns.
        ['path', 'M6 -50 Q10 -66 24 -70 L34 -62 Q20 -58 16 -46 Z', 'hide'],
        ['path', 'M20 -74 Q34 -80 44 -70 L48 -62 L28 -58 Q19 -62 20 -74 Z', 'hide'],
        ['path', 'M30 -62 L48 -62 L44 -57 L30 -58 Z', 'belly'],
        ['path', 'M46 -63 L41 -58 M42 -63 L38 -58', 'horn', 1.4],
        ['path', 'M22 -74 Q16 -84 6 -84 Q16 -78 20 -70 Z', 'horn'],
        ['path', 'M27 -75 Q23 -84 13 -86 Q23 -78 25 -71 Z', 'horn'],
        ['ellipse', { cx: 33, cy: -68, rx: 3.4, ry: 2.4 }, 'eye'],
        ['path', 'M33 -70.4 L33 -65.6', 'pupil', 1.4],
      ],
      wing: [
        // Near wing: three membrane panels off a clawed leading edge — the
        // shape that says "dragon" in silhouette before any colour lands.
        ['path', 'M2 -52 Q-14 -80 -34 -86 Q-20 -72 -18 -58 Q-16 -70 -6 -74 Q-8 -62 -2 -50 Z', 'membrane'],
        ['path', 'M2 -52 Q-14 -80 -34 -86', 'hide', 2.4, { fill: 'none' }],
        ['path', 'M-34 -86 Q-38 -88 -40 -84', 'horn', 1.6],
      ],
    },
  },

  /** Legless: a raised, coiled serpent. Its whole body is the strike, so the
   * `head` group carries most of the drawing and the coil below barely moves
   * — which is exactly how a snake reads. */
  serpent: {
    label: 'Serpent',
    attacks: { melee: 'bite', ranged: 'spit', magic: 'breath' },
    heavy: 'maul', death: 'sink',
    stature: 0.58,
    muzzle: [34, -56], torso: [0, -34],
    joints: { head: [8, -44], tail: [-30, -10] },
    parts: {
      tail: [
        ['path', 'M-30 -8 Q-46 -6 -44 -14 Q-40 -20 -30 -18', 'hide', 4, { fill: 'none' }],
      ],
      body: [
        // Two stacked coils on the ground, then the body rising out of them.
        ['path', 'M-34 -10 Q-34 -24 -12 -24 Q12 -24 16 -12 Q18 -2 -4 -2 Q-32 -2 -34 -10 Z', 'hide'],
        ['path', 'M-26 -12 Q-14 -6 4 -10 Q10 -14 6 -18 Q-10 -12 -26 -16 Z', 'belly'],
        ['path', 'M-2 -22 Q-16 -34 -6 -44 Q6 -52 18 -46', 'hide', 15, { fill: 'none', 'stroke-linecap': 'round' }],
        ['path', 'M-2 -26 Q-12 -34 -4 -42 Q6 -47 15 -44', 'belly', 6, { fill: 'none', 'stroke-linecap': 'round' }],
      ],
      head: [
        // Hooded skull, wedge snout, twin fangs — the hood is what tells a
        // serpent from a worm at 30px tall.
        ['path', 'M8 -46 Q4 -60 16 -64 Q28 -68 32 -58 Q34 -50 24 -46 Q14 -42 8 -46 Z', 'hide'],
        ['path', 'M22 -62 Q34 -62 36 -56 L34 -52 L22 -52 Z', 'hide'],
        ['path', 'M24 -53 L36 -55 L34 -51 L24 -50 Z', 'belly'],
        ['path', 'M28 -52 L27 -46 M33 -53 L33 -47', 'horn', 1.5],
        ['path', 'M34 -52 Q42 -49 46 -52 M40 -50.5 L44 -47', 'line', 1.3],
        ['ellipse', { cx: 26, cy: -59, rx: 3, ry: 2.2 }, 'eye'],
        ['path', 'M26 -61.2 L26 -56.8', 'pupil', 1.3],
        ['path', 'M10 -56 Q2 -62 -2 -54 Q4 -52 8 -48 Z', 'membrane'],
      ],
    },
  },

  /** Bipedal reptile: crested head, forward-carried tail, clawed hands. Also
   * where the Nagadoth kings land — they are drawn once and recoloured per
   * king, exactly as their bespoke inventory icons already are. */
  lizardman: {
    label: 'Reptilian',
    attacks: { melee: 'claw', ranged: 'hurl', magic: 'cast' },
    heavy: 'slam', death: 'topple',
    stature: 0.8,
    muzzle: [30, -56], torso: [0, -50],
    joints: { arm: [6, -64], head: [0, -72], tail: [-8, -34] },
    parts: {
      back: [
        ['path', 'M-10 -46 Q-18 -28 -14 -4 L-4 -4 Q-8 -26 -2 -44 Z', 'far'],
        ['path', 'M-8 -54 Q-20 -44 -22 -30 Q-14 -40 -6 -46 Z', 'far'],
      ],
      tail: [
        ['path', 'M-8 -34 Q-30 -28 -42 -12 Q-30 -18 -18 -22 Q-10 -26 -6 -30 Z', 'hide'],
        ['path', 'M-20 -22 L-23 -27 M-30 -18 L-32 -23', 'line'],
      ],
      body: [
        ['path', 'M-12 -68 Q-2 -76 10 -70 Q18 -60 16 -44 Q14 -32 2 -32 Q-10 -32 -12 -46 Z', 'hide'],
        ['path', 'M-2 -66 Q6 -60 6 -46 Q6 -38 0 -34 Q-6 -40 -6 -50 Z', 'belly'],
        // Digitigrade near leg — knee forward, hock back, three-toed foot.
        ['path', 'M0 -44 Q10 -32 4 -20 Q0 -12 6 -4 L16 -4 Q10 -14 14 -24 Q20 -36 12 -46 Z', 'hide'],
        ['path', 'M6 -4 L3 0 M11 -4 L11 0 M16 -4 L19 0', 'horn'],
      ],
      arm: [
        ['path', 'M8 -64 Q20 -58 22 -44 L14 -40 Q12 -52 2 -58 Z', 'hide'],
        ['path', 'M22 -44 L26 -39 M18 -42 L20 -37 M14 -40 L14 -35', 'horn', 1.5],
      ],
      head: [
        ['path', 'M-2 -78 Q6 -88 18 -82 Q26 -76 24 -68 Q20 -62 8 -63 Q-2 -66 -2 -78 Z', 'hide'],
        ['path', 'M18 -74 Q30 -72 30 -64 L18 -62 Z', 'hide'],
        ['path', 'M20 -64 L30 -64 L28 -61 L20 -61 Z', 'belly'],
        ['path', 'M23 -62 L22 -58 M28 -63 L28 -59', 'horn', 1.4],
        // Crest — three swept spines, the reptile's own signature.
        ['path', 'M2 -80 L-4 -90 L4 -84 Z', 'horn'],
        ['path', 'M9 -83 L6 -94 L14 -86 Z', 'horn'],
        ['path', 'M16 -82 L16 -92 L22 -80 Z', 'horn'],
        ['ellipse', { cx: 20, cy: -73, rx: 3, ry: 2.2 }, 'eye'],
        ['path', 'M20 -75.2 L20 -70.8', 'pupil', 1.3],
      ],
    },
  },

  // ── Beasts ──────────────────────────────────────────────────────────────

  /** Quadruped predator: wolves, hounds, big cats, rats at a smaller size.
   * Deep chest, high shoulder, low head carriage — a hunting posture, so it
   * reads as dangerous standing still. */
  beast: {
    label: 'Beast',
    attacks: { melee: 'bite', ranged: 'spit', magic: 'breath' },
    heavy: 'maul', death: 'sprawl',
    stature: 0.46,
    muzzle: [40, -44], torso: [0, -34],
    joints: { arm: [20, -42], head: [20, -48], tail: [-22, -36] },
    parts: {
      back: [
        ['path', 'M-20 -30 Q-28 -18 -24 -2 L-16 -2 Q-19 -18 -13 -29 Z', 'far'],
        ['path', 'M14 -32 Q8 -18 12 -2 L20 -2 Q16 -18 21 -31 Z', 'far'],
      ],
      tail: [
        ['path', 'M-22 -36 Q-40 -38 -46 -22 Q-38 -30 -28 -30 Q-22 -30 -19 -33 Z', 'hide'],
      ],
      body: [
        ['path', 'M-26 -36 Q-24 -52 -4 -54 Q18 -56 26 -44 Q30 -34 22 -24 Q6 -16 -10 -20 Q-26 -24 -26 -36 Z', 'hide'],
        ['path', 'M-8 -22 Q6 -20 20 -30 Q22 -38 18 -42 Q4 -30 -8 -28 Z', 'belly'],
        // Near hind (hocked) and near fore (straight) legs — a hunting animal
        // carries real muscle at the top of each, so they are drawn as shapes
        // rather than struts.
        ['path', 'M-18 -38 Q-28 -22 -20 -14 Q-15 -8 -19 -2 L-7 -2 Q-4 -12 -10 -20 Q-8 -32 -4 -38 Z', 'hide'],
        ['path', 'M-20 -2 L-23 1 M-13 -2 L-13 1', 'horn', 1.4],
      ],
      arm: [
        ['path', 'M17 -44 Q25 -28 22 -2 L32 -2 Q32 -26 27 -44 Z', 'hide'],
        ['path', 'M22 -2 L20 2 M27 -2 L27 2 M32 -2 L35 2', 'horn', 1.4],
      ],
      head: [
        ['path', 'M18 -50 Q26 -58 36 -54 Q42 -50 40 -44 Q34 -38 24 -40 Q18 -44 18 -50 Z', 'hide'],
        ['path', 'M34 -50 Q46 -49 46 -43 L34 -41 Z', 'hide'],
        ['path', 'M36 -43 L46 -43.5 L44 -40 L36 -39.5 Z', 'belly'],
        ['path', 'M38 -41 L37 -37 M43 -42 L43 -38', 'horn', 1.4],
        // Ears — two swept triangles, the fastest read of "predator".
        ['path', 'M20 -52 L18 -62 L27 -54 Z', 'horn'],
        ['path', 'M29 -54 L31 -63 L36 -53 Z', 'horn'],
        ['ellipse', { cx: 32, cy: -49, rx: 2.8, ry: 2.2 }, 'eye'],
        ['path', 'M32 -51 L32 -47', 'pupil', 1.3],
      ],
    },
  },

  /** Cattle: boxy, heavy, hooved, horned — and unarmed, which is the point.
   * A bull's attack is its head, so the whole body drives the charge. */
  bovine: {
    label: 'Cattle',
    // Ranged/magic are a spit rather than another gore: no cattle in the game
    // fights at range today, but the name rules hand this body to anything
    // called a bull, and a reach attack answering a ranged style would have
    // the creature goring empty air while the player takes damage from across
    // the lane. Every archetype owes a projectile to every style it can be
    // asked for (tests/monsterShapes.test.ts).
    attacks: { melee: 'gore', ranged: 'spit', magic: 'spit' },
    heavy: 'maul', death: 'sprawl',
    stature: 0.5,
    muzzle: [40, -40], torso: [-2, -38],
    joints: { head: [20, -46], tail: [-24, -44] },
    parts: {
      back: [
        ['path', 'M-20 -34 L-22 -2 L-15 -2 L-14 -34 Z', 'far'],
        ['path', 'M12 -34 L11 -2 L18 -2 L18 -34 Z', 'far'],
      ],
      tail: [
        ['path', 'M-24 -44 Q-34 -34 -32 -16', 'hide', 3.4, { fill: 'none' }],
        ['path', 'M-32 -18 Q-36 -12 -30 -6 Q-28 -14 -30 -18 Z', 'horn'],
      ],
      body: [
        ['path', 'M-26 -44 Q-26 -52 -6 -52 Q18 -52 24 -44 Q26 -34 20 -26 Q0 -20 -16 -24 Q-26 -30 -26 -44 Z', 'hide'],
        ['path', 'M-14 -26 Q2 -22 18 -28 Q20 -34 16 -38 Q0 -30 -14 -32 Z', 'belly'],
        ['path', 'M-18 -32 L-20 -2 L-12 -2 L-11 -32 Z', 'hide'],
        ['path', 'M-21 -4 L-11 -4 L-11 0 L-21 0 Z', 'horn'],
        ['path', 'M12 -34 L11 -2 L19 -2 L20 -34 Z', 'hide'],
        ['path', 'M10 -4 L20 -4 L20 0 L10 0 Z', 'horn'],
      ],
      head: [
        ['path', 'M20 -50 Q32 -52 38 -44 Q42 -38 36 -34 Q26 -30 20 -36 Q16 -44 20 -50 Z', 'hide'],
        ['path', 'M32 -40 Q42 -40 42 -35 Q38 -31 32 -33 Z', 'belly'],
        ['ellipse', { cx: 37, cy: -37, rx: 1.5, ry: 1.1 }, 'pupil'],
        ['ellipse', { cx: 40, cy: -37.4, rx: 1.5, ry: 1.1 }, 'pupil'],
        // Horns — the same broad hook silhouette as the original bull horns,
        // mirrored to sweep up and BACK instead of forward over the muzzle.
        // A point levelled at the player reads as "about to gore"; cattle at
        // rest (cows included) carry their horns up and out, not forward.
        ['path', 'M22 -50 Q14 -60 16 -64 Q18 -57 26 -51 Z', 'horn'],
        ['path', 'M36 -50 Q34 -60 25 -60 Q32 -56 32 -48 Z', 'horn'],
        ['ellipse', { cx: 27, cy: -45, rx: 2.6, ry: 2 }, 'eye'],
        ['path', 'M27 -47 L27 -43', 'pupil', 1.2],
        ['path', 'M20 -52 Q26 -56 33 -52', 'line'],
      ],
    },
  },

  /** Fowl. Small, round, two thin legs, a comb and a beak — no weapon, no
   * claws worth drawing, and its "attack" is a peck. The whole point of it
   * being in the game is that it is harmless, so it must LOOK harmless. */
  fowl: {
    label: 'Fowl',
    attacks: { melee: 'peck', ranged: 'spit', magic: 'spit' },
    death: 'sprawl',
    stature: 0.3,
    muzzle: [26, -40], torso: [0, -28],
    joints: { head: [9, -43], tail: [-14, -30] },
    parts: {
      tail: [
        ['path', 'M-14 -34 Q-28 -44 -30 -32 Q-24 -32 -18 -26 Z', 'belly'],
        ['path', 'M-14 -30 Q-26 -36 -28 -26 Q-22 -27 -16 -22 Z', 'hide'],
      ],
      body: [
        ['path', 'M-16 -30 Q-16 -42 -4 -44 Q10 -46 14 -36 Q16 -26 6 -20 Q-8 -16 -14 -22 Z', 'hide'],
        ['path', 'M-8 -22 Q2 -19 10 -25 Q12 -30 8 -33 Q-2 -26 -8 -27 Z', 'belly'],
        ['path', 'M-2 -20 L-4 -6 M6 -21 L7 -6', 'horn', 2],
        ['path', 'M-8 -4 L-4 -6 L0 -4 M-4 -6 L-4 -1', 'horn', 1.6],
        ['path', 'M3 -4 L7 -6 L11 -4 M7 -6 L7 -1', 'horn', 1.6],
      ],
      head: [
        ['path', 'M8 -44 Q10 -54 18 -54 Q26 -54 26 -46 Q26 -38 18 -37 Q10 -37 8 -44 Z', 'hide'],
        // Comb + wattle — the two marks that make a bird a chicken.
        ['path', 'M12 -54 Q13 -60 17 -56 Q19 -61 22 -56 Q25 -60 25 -53 Z', 'membrane'],
        ['path', 'M22 -38 Q24 -32 20 -32 Q19 -35 20 -38 Z', 'membrane'],
        ['path', 'M26 -47 L34 -44 L26 -41 Z', 'horn'],
        ['ellipse', { cx: 21, cy: -47, rx: 2, ry: 2 }, 'eye'],
        ['circle', { cx: 21, cy: -47, r: 0.9 }, 'pupil'],
      ],
    },
  },

  /** Winged flier: harpies, raptors, bats. Wings spread rather than folded —
   * it is never on the ground, so the legs are talons hanging under a body
   * held by the wingbeat. */
  bird: {
    label: 'Winged',
    attacks: { melee: 'claw', ranged: 'hurl', magic: 'cast' },
    heavy: 'slam', death: 'fall', flier: true, hover: true,
    stature: 0.68,
    muzzle: [30, -62], torso: [0, -54],
    joints: { arm: [10, -44], head: [8, -72], wing: [0, -66] },
    parts: {
      back: [
        ['path', 'M-6 -62 Q-26 -84 -48 -80 Q-30 -70 -20 -56 Q-14 -58 -6 -56 Z', 'membrane'],
        ['path', 'M2 -44 Q-2 -32 -6 -22 L0 -22 Q4 -34 8 -44 Z', 'far'],
      ],
      body: [
        ['path', 'M-14 -60 Q-10 -74 4 -74 Q18 -72 20 -58 Q20 -46 8 -42 Q-6 -40 -12 -48 Z', 'hide'],
        ['path', 'M0 -70 Q10 -64 10 -54 Q10 -46 4 -43 Q-2 -50 -2 -60 Z', 'belly'],
        ['path', 'M2 -44 Q4 -32 2 -22', 'horn', 2.6, { fill: 'none' }],
        ['path', 'M-4 -20 L2 -22 L8 -20 M2 -22 L2 -16', 'horn', 1.8],
      ],
      arm: [
        // The near talon — a raptor strikes with its feet, so this is the
        // limb the claw/slam motions drive, not a (non-existent) arm.
        ['path', 'M10 -44 Q16 -32 14 -20', 'horn', 2.8, { fill: 'none' }],
        ['path', 'M8 -18 L14 -20 L20 -18 M14 -20 L14 -13', 'horn', 2],
      ],
      head: [
        ['path', 'M6 -76 Q10 -86 20 -84 Q28 -82 27 -73 Q24 -66 14 -67 Q6 -69 6 -76 Z', 'hide'],
        ['path', 'M27 -76 L38 -72 L27 -68 Q24 -72 27 -76 Z', 'horn'],
        ['ellipse', { cx: 21, cy: -76, rx: 2.8, ry: 2.4 }, 'eye'],
        ['circle', { cx: 21, cy: -76, r: 1.2 }, 'pupil'],
        ['path', 'M8 -84 L2 -92 L14 -87 Z', 'horn'],
      ],
      wing: [
        ['path', 'M0 -66 Q-18 -92 -44 -92 Q-24 -80 -16 -62 Q-10 -66 -2 -62 Z', 'membrane'],
        ['path', 'M0 -66 Q-18 -92 -44 -92', 'hide', 2.4, { fill: 'none' }],
        ['path', 'M-30 -86 Q-24 -76 -20 -68 M-16 -78 Q-14 -70 -12 -64', 'line'],
      ],
    },
  },

  /** Eight legs, a bulbous abdomen and a low body — spiders and the two
   * scorpion-adjacent raid bosses. The legs are drawn as arcs off the
   * cephalothorax so the front pair can rear on their own. */
  arachnid: {
    label: 'Arachnid',
    attacks: { melee: 'claw', ranged: 'spit', magic: 'cast' },
    heavy: 'slam', death: 'sprawl',
    stature: 0.4,
    muzzle: [30, -22], torso: [-4, -26],
    joints: { arm: [18, -32], head: [18, -28] },
    parts: {
      back: [
        // Far legs. Each one arcs well ABOVE the body before it comes down —
        // a spider carries its knees over its back, and legs drawn as low
        // struts read as a beetle.
        ['path', 'M-8 -32 Q-26 -60 -44 -38 Q-50 -20 -46 -2', 'far', 3.4, { fill: 'none' }],
        ['path', 'M-4 -32 Q-16 -56 -30 -36 Q-36 -18 -32 -2', 'far', 3.4, { fill: 'none' }],
        ['path', 'M6 -32 Q16 -56 34 -38 Q40 -20 38 -2', 'far', 3.4, { fill: 'none' }],
      ],
      body: [
        // Abdomen behind, cephalothorax in front, joined at a waist.
        ['path', 'M-40 -30 Q-40 -52 -19 -52 Q0 -52 0 -30 Q0 -8 -19 -8 Q-40 -8 -40 -30 Z', 'hide'],
        ['path', 'M-30 -36 Q-20 -44 -10 -34 Q-18 -26 -30 -26 Z', 'shade', 0, { stroke: 'none' }],
        ['path', 'M-2 -30 Q0 -42 13 -42 Q27 -42 27 -28 Q27 -14 13 -14 Q0 -14 -2 -30 Z', 'hide'],
        ['path', 'M-2 -34 Q-18 -62 -36 -40 Q-42 -22 -38 -2', 'hide', 4.2, { fill: 'none' }],
        ['path', 'M2 -34 Q8 -60 28 -44 Q34 -26 34 -2', 'hide', 4.2, { fill: 'none' }],
      ],
      arm: [
        // The rearing front pair — held up and forward, which is the pose a
        // spider strikes from.
        ['path', 'M18 -36 Q34 -52 46 -38 Q50 -26 44 -14', 'hide', 4.2, { fill: 'none' }],
        ['path', 'M20 -30 Q34 -40 42 -28', 'hide', 4, { fill: 'none' }],
      ],
      head: [
        // Chelicerae — drawn in the HEAD group rather than with the rearing
        // legs above, so a spit/venom attack has a jaw to drive it.
        ['path', 'M22 -20 Q26 -10 24 -6 M28 -21 L32 -8', 'horn', 2.2],
        ['path', 'M18 -22 Q25 -15 32 -18', 'maw', 2.2, { fill: 'none' }],
        ['ellipse', { cx: 16, cy: -35, rx: 2.8, ry: 2.4 }, 'eye'],
        ['ellipse', { cx: 23, cy: -34, rx: 2.2, ry: 1.9 }, 'eye'],
        ['ellipse', { cx: 14, cy: -29, rx: 1.8, ry: 1.5 }, 'eye'],
        ['ellipse', { cx: 21, cy: -28, rx: 1.6, ry: 1.3 }, 'eye'],
      ],
    },
  },

  /** Segmented, winged, stinger-tailed — wasps and scarabs. Its wings buzz
   * on their own clock and its tail is the weapon, so the tail group carries
   * the strike rather than the (absent) arm. */
  insect: {
    label: 'Insect',
    attacks: { melee: 'sting', ranged: 'spit', magic: 'spit' },
    heavy: 'sting', death: 'sprawl', flier: true, hover: true,
    stature: 0.48,
    muzzle: [30, -44], torso: [0, -40],
    joints: { head: [12, -52], tail: [-6, -42], wing: [2, -54] },
    parts: {
      back: [
        // Far wing, swept back and low so the near pair below reads over it.
        ['path', 'M0 -54 Q-20 -70 -34 -62 Q-18 -58 -8 -48 Z', 'membrane'],
        ['path', 'M-6 -36 Q-14 -24 -14 -14', 'far', 2.2, { fill: 'none' }],
        ['path', 'M6 -36 Q4 -22 6 -12', 'far', 2.2, { fill: 'none' }],
      ],
      tail: [
        // Banded abdomen tapering into a sting.
        ['path', 'M-8 -44 Q-30 -44 -34 -30 Q-32 -18 -16 -20 Q-4 -24 -4 -36 Z', 'hide'],
        ['path', 'M-14 -43 Q-16 -30 -12 -20 M-24 -41 Q-28 -30 -22 -21', 'shade', 3, { fill: 'none' }],
        ['path', 'M-32 -22 Q-40 -14 -44 -4', 'horn', 2.6, { fill: 'none' }],
      ],
      body: [
        ['path', 'M-8 -50 Q-6 -60 8 -60 Q20 -58 20 -46 Q20 -36 8 -34 Q-6 -34 -8 -44 Z', 'hide'],
        ['path', 'M-2 -42 Q8 -38 16 -44', 'shade', 3.4, { fill: 'none' }],
        ['path', 'M-2 -36 Q-8 -24 -6 -12', 'hide', 2.4, { fill: 'none' }],
        ['path', 'M10 -35 Q12 -22 16 -12', 'hide', 2.4, { fill: 'none' }],
      ],
      head: [
        ['path', 'M14 -58 Q26 -58 28 -48 Q28 -40 18 -38 Q10 -40 10 -50 Q10 -56 14 -58 Z', 'hide'],
        ['path', 'M20 -60 Q26 -70 36 -70 M16 -60 Q16 -70 8 -74', 'horn', 1.8],
        ['ellipse', { cx: 22, cy: -52, rx: 4.4, ry: 5 }, 'eye'],
        ['path', 'M22 -56 Q26 -52 22 -48', 'pupil', 1.4],
        ['path', 'M22 -40 L20 -34 M26 -42 L27 -36', 'horn', 1.5],
      ],
      wing: [
        // The near pair, held higher and further forward, so the beat reads
        // against the far wing rather than on top of it.
        ['path', 'M4 -56 Q-14 -78 -30 -72 Q-14 -66 -2 -52 Z', 'membrane'],
        ['path', 'M4 -56 Q-14 -78 -30 -72', 'hide', 2, { fill: 'none' }],
        ['path', 'M-22 -70 Q-14 -64 -6 -56', 'line', 1.4],
      ],
    },
  },

  /** Wide carapace, two oversized claws, stalked eyes. Low to the ground and
   * broad, so it scales sideways where a biped scales up. */
  crab: {
    label: 'Crustacean',
    attacks: { melee: 'pinch', ranged: 'spit', magic: 'cast' },
    heavy: 'slam', death: 'sprawl',
    stature: 0.34,
    muzzle: [30, -24], torso: [0, -22],
    joints: { arm: [18, -30], head: [0, -36] },
    parts: {
      back: [
        ['path', 'M-16 -22 Q-30 -22 -36 -8 Q-32 -14 -22 -14', 'far', 3.6, { fill: 'none' }],
        ['path', 'M-8 -22 Q-20 -26 -26 -6', 'far', 3.6, { fill: 'none' }],
        ['path', 'M8 -22 Q18 -26 24 -8', 'far', 3.6, { fill: 'none' }],
      ],
      body: [
        ['path', 'M-28 -22 Q-26 -38 0 -38 Q26 -38 28 -22 Q28 -12 0 -12 Q-28 -12 -28 -22 Z', 'hide'],
        ['path', 'M-18 -30 Q0 -24 18 -30', 'shade', 3, { fill: 'none' }],
        ['path', 'M-20 -14 Q-30 -12 -34 -2', 'hide', 4.2, { fill: 'none' }],
        ['path', 'M-10 -13 Q-18 -8 -22 0', 'hide', 4.2, { fill: 'none' }],
        ['path', 'M10 -13 Q16 -8 20 0', 'hide', 4.2, { fill: 'none' }],
        ['path', 'M20 -14 Q28 -10 32 -2', 'hide', 4.2, { fill: 'none' }],
      ],
      arm: [
        // The big claw: an arm, a fixed jaw, a hinged one. Drawn open, so the
        // pinch keyframe has somewhere to close to.
        ['path', 'M16 -30 Q28 -36 34 -30', 'hide', 7, { fill: 'none' }],
        // Drawn OPEN, so the pinch keyframe has somewhere to close to, and
        // drawn big — a crab whose claw is not obviously the biggest thing
        // about it is just a wide beetle.
        ['path', 'M32 -34 Q52 -40 54 -26 Q46 -22 33 -26 Z', 'hide'],
        ['path', 'M33 -26 Q50 -22 50 -12 Q38 -12 31 -20 Z', 'hide'],
        ['path', 'M36 -30 Q46 -32 50 -28', 'line', 1.6],
        ['path', 'M37 -22 Q45 -19 47 -15', 'line', 1.6],
      ],
      head: [
        ['path', 'M-8 -36 L-9 -46 M8 -36 L9 -46', 'hide', 2.2],
        ['ellipse', { cx: -9, cy: -47, rx: 2.6, ry: 2.8 }, 'eye'],
        ['ellipse', { cx: 9, cy: -47, rx: 2.6, ry: 2.8 }, 'eye'],
        ['circle', { cx: -9, cy: -47, r: 1.1 }, 'pupil'],
        ['circle', { cx: 9, cy: -47, r: 1.1 }, 'pupil'],
      ],
    },
  },

  /** A mantle over a nest of tentacles — krakens, the Olm's arm, the
   * Corporeal Horror. It has no legs and no arms: the tentacles ARE both, so
   * the `arm` group is the striking tentacle and the rest idle-writhe. */
  kraken: {
    label: 'Abyssal',
    attacks: { melee: 'lash', ranged: 'spit', magic: 'cast' },
    heavy: 'slam', death: 'sink',
    stature: 0.66,
    muzzle: [22, -50], torso: [0, -42],
    joints: { arm: [16, -50], head: [0, -56], tail: [-2, -30] },
    parts: {
      back: [
        ['path', 'M-14 -30 Q-32 -26 -40 -6 Q-30 -18 -18 -18', 'far', 4, { fill: 'none' }],
        ['path', 'M-6 -28 Q-16 -12 -30 -4', 'far', 4, { fill: 'none' }],
        ['path', 'M10 -28 Q22 -14 34 -8', 'far', 4, { fill: 'none' }],
      ],
      tail: [
        ['path', 'M-10 -30 Q-24 -20 -22 -2 Q-16 -14 -6 -20 Z', 'hide'],
        ['path', 'M-2 -30 Q-6 -14 2 -2 Q2 -16 6 -24 Z', 'hide'],
        ['path', 'M8 -30 Q16 -18 28 -12 Q18 -20 14 -28 Z', 'hide'],
      ],
      body: [
        ['path', 'M-22 -46 Q-22 -74 0 -76 Q22 -74 22 -46 Q22 -30 0 -28 Q-22 -30 -22 -46 Z', 'hide'],
        ['path', 'M-12 -66 Q0 -60 12 -66 Q14 -50 8 -40 Q0 -36 -8 -40 Q-14 -50 -12 -66 Z', 'belly'],
        ['path', 'M-16 -36 Q-8 -30 0 -32 Q8 -30 16 -36', 'line'],
      ],
      arm: [
        ['path', 'M16 -50 Q34 -54 44 -40 Q48 -30 44 -20', 'hide', 5.5, { fill: 'none' }],
        ['path', 'M30 -50 L32 -45 M38 -44 L40 -39 M43 -34 L47 -32', 'belly', 2.4],
      ],
      head: [
        ['ellipse', { cx: -8, cy: -56, rx: 5, ry: 4 }, 'eye'],
        ['ellipse', { cx: 8, cy: -56, rx: 5, ry: 4 }, 'eye'],
        ['path', 'M-8 -60 L-8 -52 M8 -60 L8 -52', 'pupil', 2.2],
      ],
    },
  },

  /** A single floating eye or core: no body at all, just the orb, its iris
   * and a ring of drifting shards. Hovers, so it never touches the ground. */
  orb: {
    label: 'Watcher',
    attacks: { melee: 'lash', ranged: 'spit', magic: 'cast' },
    heavy: 'slam', death: 'dissipate', hover: true,
    stature: 0.54,
    muzzle: [24, -56], torso: [0, -56],
    joints: { arm: [14, -50], head: [6, -56], tail: [0, -34] },
    parts: {
      back: [
        ['path', 'M-24 -78 L-32 -86 L-22 -84 Z', 'membrane'],
        ['path', 'M24 -34 L34 -28 L24 -26 Z', 'membrane'],
        ['path', 'M-26 -40 L-38 -38 L-28 -32 Z', 'membrane'],
      ],
      tail: [
        ['path', 'M-8 -34 Q-12 -22 -18 -12', 'membrane', 2.6, { fill: 'none' }],
        ['path', 'M6 -34 Q10 -20 8 -8', 'membrane', 2.6, { fill: 'none' }],
        ['path', 'M-1 -34 Q-2 -18 2 -6', 'membrane', 2.6, { fill: 'none' }],
      ],
      body: [
        ['circle', { cx: 0, cy: -56, r: 22 }, 'hide'],
        ['path', 'M-16 -68 Q-6 -74 6 -70 Q-4 -64 -14 -62 Z', 'belly'],
      ],
      arm: [
        // The one tendril it strikes with — the rest (in `tail`) only drift.
        ['path', 'M14 -50 Q30 -48 38 -36 Q42 -28 40 -20', 'membrane', 3.6, { fill: 'none' }],
        ['path', 'M30 -44 L33 -40 M37 -34 L41 -32', 'glow', 2],
      ],
      head: [
        ['circle', { cx: 6, cy: -56, r: 12 }, 'eye'],
        ['circle', { cx: 8, cy: -56, r: 5.6 }, 'pupil'],
        ['circle', { cx: 4, cy: -60, r: 2 }, 'glow'],
      ],
      fore: [
        ['path', 'M-18 -70 Q0 -80 18 -70', 'line', 1.6],
        ['path', 'M-18 -42 Q0 -32 18 -42', 'line', 1.6],
      ],
    },
  },

  /** A squat amphibian: wide mouth, bulging eyes, splayed limbs. Its attack
   * is a lunging bite off a coiled crouch. */
  toad: {
    label: 'Amphibian',
    attacks: { melee: 'bite', ranged: 'spit', magic: 'spit' },
    heavy: 'maul', death: 'sprawl',
    stature: 0.28,
    muzzle: [32, -20], torso: [0, -22],
    joints: { arm: [16, -18], head: [6, -28] },
    parts: {
      back: [
        ['path', 'M-18 -24 Q-32 -22 -32 -6 Q-26 -14 -16 -14 Z', 'far'],
        ['path', 'M14 -22 Q26 -18 26 -4 Q22 -12 12 -14 Z', 'far'],
      ],
      body: [
        ['path', 'M-26 -18 Q-26 -36 0 -38 Q26 -36 28 -18 Q28 -4 0 -4 Q-26 -4 -26 -18 Z', 'hide'],
        ['path', 'M-16 -12 Q0 -6 16 -12 Q18 -20 12 -26 Q0 -18 -12 -22 Z', 'belly'],
        ['ellipse', { cx: -14, cy: -26, rx: 3.4, ry: 2.6 }, 'shade'],
        ['ellipse', { cx: -4, cy: -31, rx: 3, ry: 2.2 }, 'shade'],
        ['path', 'M-22 -12 Q-32 -8 -34 0 L-24 0 Q-22 -6 -18 -8 Z', 'hide'],
        ['path', 'M-34 0 L-38 2 M-30 0 L-32 3', 'horn', 1.4],
      ],
      arm: [
        ['path', 'M20 -18 Q30 -12 32 -2 L22 -2 Q20 -8 14 -12 Z', 'hide'],
        ['path', 'M32 -2 L36 1 M27 -2 L28 2', 'horn', 1.4],
      ],
      head: [
        ['path', 'M6 -34 Q22 -36 30 -26 Q34 -18 26 -14 Q12 -12 4 -18 Q0 -26 6 -34 Z', 'hide'],
        ['path', 'M8 -18 Q20 -14 32 -20', 'maw', 2.4, { fill: 'none' }],
        ['ellipse', { cx: 10, cy: -34, rx: 5, ry: 5.2 }, 'eye'],
        ['ellipse', { cx: 22, cy: -32, rx: 4.4, ry: 4.6 }, 'eye'],
        ['circle', { cx: 10, cy: -34, r: 2 }, 'pupil'],
        ['circle', { cx: 22, cy: -32, r: 1.8 }, 'pupil'],
      ],
    },
  },

  // ── Upright ─────────────────────────────────────────────────────────────

  /** The armed enemy: goblins, marauders, cultists, warriors. Deliberately
   * NOT the player's rig — hunched, long-armed, heavy-browed and snouted, so
   * "something is fighting you" reads before the palette even lands. This is
   * the only archetype that carries a WEAPON, and the weapon is drawn by the
   * stage's own CombatTool from the same twelve shapes the player uses. */
  humanoid: {
    label: 'Humanoid',
    attacks: { melee: 'swing', ranged: 'shoot', magic: 'cast' },
    heavy: 'slam', death: 'topple', armed: true,
    stature: 0.8,
    grip: [30, -54], muzzle: [34, -56], torso: [0, -52],
    joints: { arm: [6, -64], head: [0, -70] },
    parts: {
      back: [
        ['path', 'M-10 -46 Q-18 -26 -14 -3 L-4 -3 Q-8 -26 -2 -44 Z', 'far'],
        ['path', 'M-8 -62 Q-20 -52 -20 -38 L-13 -36 Q-12 -50 -3 -56 Z', 'far'],
      ],
      body: [
        ['path', 'M-12 -66 Q-2 -74 10 -68 Q18 -58 16 -44 Q12 -34 0 -34 Q-10 -36 -12 -48 Z', 'hide'],
        ['path', 'M-10 -60 Q0 -66 10 -60 Q14 -50 12 -40 Q0 -36 -8 -42 Q-12 -52 -10 -60 Z', 'cloth'],
        ['path', 'M-9 -44 Q2 -38 13 -44 L14 -39 Q2 -33 -10 -39 Z', 'metal'],
        ['path', 'M2 -40 Q10 -28 4 -18 Q0 -10 6 -3 L16 -3 Q10 -12 14 -22 Q20 -34 12 -42 Z', 'hide'],
        ['path', 'M4 -6 L18 -6 L18 0 L3 0 Z', 'cloth'],
      ],
      arm: [
        // Ends at the grip (30,-54) — the archetype's `grip`, which is where
        // MonsterFigure places a weapon when `armed`.
        ['path', 'M6 -64 Q20 -62 30 -54', 'hide', 9, { fill: 'none', 'stroke-linecap': 'round' }],
        ['circle', { cx: 31, cy: -53, r: 4.2 }, 'hide'],
      ],
      head: [
        ['path', 'M-2 -74 Q6 -86 18 -82 Q26 -78 24 -68 Q20 -62 8 -63 Q-2 -64 -2 -74 Z', 'hide'],
        ['path', 'M18 -74 Q28 -73 27 -66 L18 -65 Z', 'hide'],
        ['path', 'M20 -66 L27 -66 L25 -63 L20 -63 Z', 'horn'],
        // Long swept ears + heavy brow: the two marks that stop this reading
        // as the player's own head mirrored back at them.
        ['path', 'M0 -76 L-14 -83 L1 -69 Z', 'hide'],
        ['path', 'M2 -80 L-9 -91 L7 -78 Z', 'hide'],
        ['path', 'M6 -79 Q14 -84 22 -77', 'line', 2],
        ['ellipse', { cx: 17, cy: -73, rx: 2.6, ry: 2.2 }, 'eye'],
        ['circle', { cx: 17, cy: -73, r: 1.1 }, 'pupil'],
      ],
    },
  },

  /** Bones only: ribcage, skull, thin limbs — and armed, like the humanoid it
   * used to be. The gap between the ribs is drawn as real negative space
   * rather than a shade band, because that gap is the whole silhouette. */
  skeleton: {
    label: 'Undead',
    attacks: { melee: 'swing', ranged: 'shoot', magic: 'cast' },
    heavy: 'slam', death: 'crumble', armed: true,
    stature: 0.8,
    grip: [30, -54], muzzle: [34, -56], torso: [0, -52],
    joints: { arm: [4, -66], head: [4, -70] },
    parts: {
      back: [
        ['path', 'M-6 -46 Q-14 -26 -12 -3 L-6 -3 Q-8 -26 -2 -44 Z', 'far'],
        ['path', 'M-6 -62 Q-16 -52 -17 -38 L-12 -37 Q-11 -50 -2 -56 Z', 'far'],
      ],
      body: [
        ['path', 'M-8 -68 Q0 -72 8 -68 Q14 -62 12 -56 L-6 -56 Q-10 -62 -8 -68 Z', 'hide'],
        // The gap BETWEEN the ribs is the whole silhouette, so the cage is
        // drawn as a dark void with pale ribs over it rather than as pale
        // strokes on nothing — on a bone palette a pale stroke sits a shade
        // away from the ink outline and simply disappears.
        ['path', 'M-7 -57 Q2 -53 12 -57 L11 -35 Q2 -31 -6 -35 Z', 'maw'],
        ['path', 'M-6 -55 Q2 -51 11 -55 M-6 -49 Q2 -45 11 -49 M-5 -43 Q2 -39 10 -43 M-5 -37 Q2 -34 10 -37', 'hide', 3.4],
        ['path', 'M2 -57 L2 -35', 'hide', 3.4],
        ['path', 'M-6 -36 Q2 -31 10 -36 Q12 -31 8 -29 L-4 -29 Q-8 -32 -6 -36 Z', 'hide'],
        ['path', 'M-2 -30 Q-8 -18 -4 -3 L2 -3 Q0 -18 4 -30 Z', 'hide'],
        ['path', 'M6 -30 Q12 -18 8 -3 L14 -3 Q16 -18 12 -30 Z', 'hide'],
        ['path', 'M-8 -3 L4 -3 L4 0 L-9 0 Z', 'hide'],
        ['path', 'M6 -3 L18 -3 L18 0 L5 0 Z', 'hide'],
      ],
      arm: [
        ['path', 'M4 -66 Q18 -64 30 -54', 'hide', 5, { fill: 'none', 'stroke-linecap': 'round' }],
        ['circle', { cx: 31, cy: -53, r: 3.6 }, 'hide'],
      ],
      head: [
        ['path', 'M0 -78 Q4 -92 17 -90 Q28 -86 27 -73 Q26 -66 17 -65 L4 -65 Q-1 -69 0 -78 Z', 'hide'],
        // The jaw is drawn as a dark gap with pale teeth across it — a pale
        // zigzag on a pale skull is invisible, which is what the first pass
        // shipped.
        ['path', 'M4 -68 Q15 -63 26 -68 L25 -64 Q15 -60 5 -64 Z', 'maw'],
        ['path', 'M7 -66 L7 -62 M12 -65 L12 -61 M17 -65 L17 -61 M22 -66 L22 -62', 'hide', 2],
        ['ellipse', { cx: 10, cy: -78, rx: 4.6, ry: 4.8 }, 'maw'],
        ['ellipse', { cx: 21, cy: -77, rx: 4.2, ry: 4.4 }, 'maw'],
        ['circle', { cx: 10.6, cy: -77.4, r: 1.8 }, 'glow'],
        ['circle', { cx: 21.4, cy: -76.6, r: 1.7 }, 'glow'],
        ['path', 'M16 -71 L13.5 -69 L18.5 -69 Z', 'maw'],
      ],
    },
  },

  /** The shambler: rotted, hunched, arms hanging past the knees, rags. It
   * hits with what's left of its hands, so it is unarmed and its melee is a
   * clawing swipe rather than a weapon swing. */
  husk: {
    label: 'Risen',
    attacks: { melee: 'claw', ranged: 'hurl', magic: 'cast' },
    heavy: 'slam', death: 'crumble',
    stature: 0.78,
    muzzle: [30, -56], torso: [0, -50],
    joints: { arm: [4, -60], head: [2, -66] },
    parts: {
      back: [
        ['path', 'M-12 -44 Q-20 -26 -16 -3 L-6 -3 Q-10 -26 -4 -42 Z', 'far'],
        ['path', 'M-8 -60 Q-22 -48 -24 -30 L-17 -28 Q-14 -46 -3 -54 Z', 'far'],
      ],
      body: [
        // Hunched: shoulders forward of the hips, head hanging low.
        ['path', 'M-14 -58 Q-8 -70 6 -68 Q18 -64 18 -50 Q16 -36 2 -34 Q-10 -34 -14 -44 Z', 'hide'],
        ['path', 'M-6 -62 Q6 -60 12 -50 Q12 -40 4 -36 Q-4 -40 -6 -50 Z', 'cloth'],
        ['path', 'M-4 -46 L-2 -38 M4 -48 L6 -38', 'maw', 2],
        ['path', 'M0 -40 Q8 -28 2 -18 Q-2 -10 4 -3 L14 -3 Q8 -12 12 -22 Q18 -32 10 -42 Z', 'hide'],
        ['path', 'M-8 -36 Q-14 -24 -10 -3 L-2 -3 Q-6 -24 -1 -34 Z', 'hide'],
        ['path', 'M-14 -8 Q-2 -2 12 -6 L16 -1 Q0 4 -16 -2 Z', 'cloth'],
      ],
      arm: [
        ['path', 'M4 -60 Q20 -52 26 -34', 'hide', 8, { fill: 'none', 'stroke-linecap': 'round' }],
        ['path', 'M26 -32 L24 -24 M29 -33 L30 -25 M31 -36 L35 -30', 'horn', 1.8],
      ],
      head: [
        ['path', 'M2 -70 Q8 -80 20 -77 Q28 -73 26 -64 Q22 -58 12 -59 Q3 -61 2 -70 Z', 'hide'],
        ['path', 'M12 -62 Q19 -58 26 -62', 'maw', 2.4, { fill: 'none' }],
        ['ellipse', { cx: 13, cy: -70, rx: 3, ry: 3.2 }, 'maw'],
        ['ellipse', { cx: 22, cy: -69, rx: 2.6, ry: 2.8 }, 'maw'],
        ['circle', { cx: 13, cy: -70, r: 1.2 }, 'glow'],
        ['circle', { cx: 22, cy: -69, r: 1.1 }, 'glow'],
      ],
    },
  },

  /** The big horned biped: fiends, devils, the fire bosses. Digitigrade legs,
   * spread wings, a whip tail and hands that end in claws — no weapon, its
   * arms are the weapon, and at weight it stops swiping and starts slamming. */
  demon: {
    label: 'Fiend',
    attacks: { melee: 'claw', ranged: 'hurl', magic: 'cast' },
    heavy: 'slam', death: 'topple', flier: true,
    stature: 0.8,
    muzzle: [32, -66], torso: [0, -56],
    joints: { arm: [8, -74], head: [0, -82], tail: [-12, -44], wing: [0, -78] },
    parts: {
      back: [
        ['path', 'M-8 -50 Q-18 -30 -14 -3 L-4 -3 Q-8 -30 0 -48 Z', 'far'],
        ['path', 'M-8 -70 Q-24 -60 -26 -44 L-18 -42 Q-16 -58 -2 -64 Z', 'far'],
        ['path', 'M-6 -74 Q-30 -94 -48 -86 Q-30 -80 -18 -66 Z', 'membrane'],
      ],
      tail: [
        ['path', 'M-12 -44 Q-32 -38 -38 -18', 'hide', 4, { fill: 'none' }],
        ['path', 'M-38 -20 L-46 -12 L-36 -12 Z', 'horn'],
      ],
      body: [
        ['path', 'M-20 -80 Q-2 -90 18 -80 Q28 -66 24 -48 Q18 -36 2 -36 Q-14 -38 -20 -58 Z', 'hide'],
        ['path', 'M0 -76 Q10 -68 11 -54 Q11 -42 3 -38 Q-3 -46 -4 -60 Z', 'belly'],
        ['path', 'M-16 -64 Q2 -56 20 -64', 'line', 2.2],
        // Digitigrade near leg: knee forward, hock high and back, hoof-claw.
        ['path', 'M2 -50 Q14 -38 6 -26 Q0 -16 8 -3 L20 -3 Q12 -16 18 -28 Q26 -42 14 -52 Z', 'hide'],
        ['path', 'M8 -3 L5 2 M14 -3 L14 2 M20 -3 L23 2', 'horn'],
      ],
      arm: [
        ['path', 'M10 -76 Q30 -70 36 -50', 'hide', 11, { fill: 'none', 'stroke-linecap': 'round' }],
        ['path', 'M36 -50 L33 -38 M40 -52 L42 -40 M41 -56 L48 -49', 'horn', 2.2],
      ],
      head: [
        ['path', 'M-2 -86 Q6 -98 20 -94 Q30 -89 28 -78 Q24 -70 12 -71 Q0 -74 -2 -86 Z', 'hide'],
        ['path', 'M12 -74 Q20 -68 30 -73', 'maw', 2.4, { fill: 'none' }],
        ['path', 'M14 -73 L16 -69 M20 -72 L21 -68 M25 -73 L26 -69', 'horn', 1.5],
        // Great swept horns — the fiend's signature, drawn big enough to
        // survive the smallest scale this archetype is ever asked for.
        ['path', 'M0 -90 Q-12 -100 -8 -112 Q-2 -102 6 -96 Z', 'horn'],
        ['path', 'M18 -94 Q22 -108 34 -112 Q26 -100 26 -90 Z', 'horn'],
        ['ellipse', { cx: 12, cy: -85, rx: 3.4, ry: 2.8 }, 'eye'],
        ['ellipse', { cx: 22, cy: -84, rx: 3, ry: 2.4 }, 'eye'],
        ['path', 'M12 -87.4 L12 -82.6 M22 -86.2 L22 -81.8', 'pupil', 1.4],
      ],
      wing: [
        ['path', 'M0 -78 Q-16 -104 -40 -104 Q-22 -94 -14 -74 Q-8 -78 -2 -74 Z', 'membrane'],
        ['path', 'M0 -78 Q-16 -104 -40 -104', 'hide', 2.4, { fill: 'none' }],
        ['path', 'M-26 -98 Q-20 -88 -16 -80', 'line'],
      ],
    },
  },

  /** The small fiend: sprites, imps, minions. Same family as `demon` but
   * top-heavy and stubby — a big head on a small body is what makes something
   * read as a lesser version rather than a shrunk copy. */
  imp: {
    label: 'Imp',
    attacks: { melee: 'claw', ranged: 'hurl', magic: 'cast' },
    death: 'topple', flier: true,
    stature: 0.42,
    muzzle: [26, -40], torso: [0, -34],
    joints: { arm: [6, -42], head: [-2, -50], tail: [-8, -28], wing: [-2, -44] },
    parts: {
      back: [
        ['path', 'M-6 -30 Q-12 -18 -10 -2 L-3 -2 Q-6 -18 -1 -28 Z', 'far'],
        ['path', 'M-4 -42 Q-18 -50 -25 -43 Q-14 -41 -7 -35 Z', 'membrane'],
      ],
      tail: [
        ['path', 'M-8 -28 Q-22 -24 -24 -10', 'hide', 2.6, { fill: 'none' }],
        ['path', 'M-24 -12 L-30 -6 L-22 -5 Z', 'horn'],
      ],
      body: [
        ['path', 'M-10 -44 Q0 -50 10 -44 Q14 -36 12 -26 Q6 -20 -2 -20 Q-10 -24 -10 -34 Z', 'hide'],
        ['path', 'M0 -44 Q7 -38 7 -30 Q7 -23 2 -21 Q-2 -27 -2 -36 Z', 'belly'],
        ['path', 'M0 -24 Q8 -16 4 -2 L14 -2 Q14 -14 10 -24 Z', 'hide'],
        ['path', 'M4 -2 L1 2 M9 -2 L9 2 M14 -2 L17 2', 'horn', 1.3],
      ],
      arm: [
        ['path', 'M6 -42 Q18 -38 24 -28', 'hide', 6, { fill: 'none', 'stroke-linecap': 'round' }],
        ['path', 'M24 -27 L22 -21 M27 -29 L29 -23', 'horn', 1.5],
      ],
      head: [
        ['path', 'M-4 -54 Q2 -64 14 -61 Q24 -57 22 -47 Q18 -41 8 -42 Q-4 -45 -4 -54 Z', 'hide'],
        ['path', 'M8 -45 Q15 -41 22 -45', 'maw', 2, { fill: 'none' }],
        ['path', 'M-2 -58 Q-8 -68 -2 -70 Q0 -63 4 -60 Z', 'horn'],
        ['path', 'M14 -60 Q18 -70 24 -70 Q19 -63 20 -57 Z', 'horn'],
        ['ellipse', { cx: 8, cy: -53, rx: 2.8, ry: 2.4 }, 'eye'],
        ['ellipse', { cx: 17, cy: -52, rx: 2.4, ry: 2 }, 'eye'],
        ['circle', { cx: 8, cy: -53, r: 1.1 }, 'pupil'],
        ['circle', { cx: 17, cy: -52, r: 1 }, 'pupil'],
      ],
      wing: [
        // A bat wing barely bigger than its own head — an imp is a lesser
        // demon, and the wing is what says so at a glance.
        ['path', 'M-2 -46 Q-16 -60 -28 -56 Q-16 -50 -6 -40 Z', 'membrane'],
        ['path', 'M-2 -46 Q-16 -60 -28 -56', 'hide', 1.8, { fill: 'none' }],
        ['path', 'M-20 -55 Q-14 -50 -8 -44', 'line', 1.2],
      ],
    },
  },

  /** The mountain of muscle: giants, ogres, apes, colossi. Enormous
   * shoulders, tiny head, arms that reach the ground — and the knuckles rest
   * ON the ground, which is what stops it reading as a tall man. */
  giant: {
    label: 'Giant',
    attacks: { melee: 'slam', ranged: 'hurl', magic: 'cast' },
    heavy: 'slam', death: 'topple',
    stature: 0.82,
    muzzle: [30, -66], torso: [0, -56],
    joints: { arm: [10, -72], head: [2, -80] },
    parts: {
      back: [
        ['path', 'M-14 -50 Q-26 -28 -22 -3 L-12 -3 Q-16 -28 -4 -48 Z', 'far'],
        ['path', 'M-24 -3 L-10 -3 L-10 1 L-25 1 Z', 'far'],
        ['path', 'M-10 -74 Q-30 -62 -32 -38', 'far', 11, { fill: 'none', 'stroke-linecap': 'round' }],
        ['circle', { cx: -33, cy: -34, r: 8 }, 'far'],
      ],
      body: [
        // Trapezoid mass: shoulders nearly twice the width of the waist, and
        // no neck at all — the head is set BETWEEN the shoulders, which is
        // what separates a giant from a tall man.
        ['path', 'M-28 -78 Q-4 -92 22 -78 Q34 -62 28 -44 Q16 -34 -4 -34 Q-22 -36 -28 -56 Z', 'hide'],
        ['path', 'M2 -74 Q10 -64 10 -50 Q8 -40 2 -36 Q-2 -46 -2 -60 Z', 'belly'],
        ['path', 'M-24 -62 Q0 -52 22 -62', 'line', 2.6],
        ['path', 'M2 -46 Q18 -34 10 -20 Q4 -12 14 -3 L28 -3 Q18 -14 24 -26 Q32 -40 18 -50 Z', 'hide'],
        ['path', 'M12 -3 L30 -3 L30 1 L12 1 Z', 'horn'],
      ],
      arm: [
        // A pillar of an arm ending in a fist the size of the head, hanging
        // low enough that the knuckles are nearly at the knee.
        ['path', 'M14 -72 Q36 -62 42 -34', 'hide', 13, { fill: 'none', 'stroke-linecap': 'round' }],
        ['circle', { cx: 43, cy: -29, r: 10 }, 'hide'],
        ['path', 'M36 -31 Q43 -25 50 -30', 'line', 2],
        ['path', 'M37 -24 Q43 -20 49 -24', 'line', 1.6],
      ],
      head: [
        ['path', 'M-2 -86 Q4 -100 20 -97 Q32 -93 30 -80 Q26 -72 10 -74 Q-2 -77 -2 -86 Z', 'hide'],
        ['path', 'M9 -76 Q19 -71 28 -77', 'maw', 2.6, { fill: 'none' }],
        ['path', 'M12 -75 L13 -70 M19 -75 L20 -70 M25 -76 L26 -71', 'horn', 1.8],
        ['path', 'M0 -89 Q14 -96 26 -87', 'line', 3],
        ['ellipse', { cx: 10, cy: -85, rx: 3.2, ry: 2.6 }, 'eye'],
        ['ellipse', { cx: 21, cy: -84, rx: 3, ry: 2.4 }, 'eye'],
        ['circle', { cx: 10, cy: -85, r: 1.3 }, 'pupil'],
        ['circle', { cx: 21, cy: -84, r: 1.2 }, 'pupil'],
      ],
    },
  },

  /** No legs, no feet: a hood over nothing, a torn robe that frays into air.
   * Hovers, and its death is a dissipation rather than a fall — a thing with
   * no body cannot topple onto a floor. */
  wraith: {
    label: 'Wraith',
    attacks: { melee: 'lash', ranged: 'hurl', magic: 'cast' },
    heavy: 'slam', death: 'dissipate', hover: true,
    stature: 0.8,
    muzzle: [30, -66], torso: [0, -54],
    joints: { arm: [6, -70], head: [0, -76], tail: [0, -34] },
    parts: {
      back: [
        ['path', 'M-16 -68 Q-32 -56 -30 -34 L-22 -34 Q-24 -54 -8 -62 Z', 'far'],
      ],
      tail: [
        // The frayed hem. Three tapering wisps where legs would be, each
        // curling AWAY from the body — a straight taper reads as a leg, and
        // a thing with legs is not a wraith.
        ['path', 'M-16 -38 Q-30 -26 -28 -8 Q-26 -20 -16 -26 Q-14 -32 -12 -35 Z', 'cloth'],
        ['path', 'M-3 -36 Q-10 -18 -2 -2 Q-1 -14 5 -24 Q6 -31 5 -35 Z', 'cloth'],
        ['path', 'M13 -38 Q26 -26 25 -6 Q22 -20 16 -26 Q14 -31 14 -35 Z', 'cloth'],
      ],
      body: [
        // The robe flares WIDER as it falls, so the figure reads as hanging
        // rather than standing.
        ['path', 'M-16 -76 Q-2 -86 16 -76 Q26 -58 22 -38 Q2 -28 -16 -38 Q-24 -58 -16 -76 Z', 'cloth'],
        ['path', 'M-5 -74 Q8 -68 13 -52 Q12 -40 3 -33 Q-5 -44 -6 -60 Z', 'shade', 0, { stroke: 'none' }],
        ['path', 'M-12 -50 Q2 -44 18 -50', 'line', 1.8],
      ],
      arm: [
        ['path', 'M4 -74 Q22 -70 33 -55', 'cloth', 10, { fill: 'none', 'stroke-linecap': 'round' }],
        ['path', 'M33 -53 L31 -44 M36 -55 L39 -46 M37 -59 L44 -54', 'horn', 1.8],
      ],
      head: [
        // A tall pointed cowl with a void inside it — two lights and nothing
        // else. The one archetype that keeps the original "no face"
        // restraint, because here the absence IS the character.
        ['path', 'M-4 -80 Q-2 -100 14 -101 Q30 -99 30 -78 Q28 -66 13 -66 Q-2 -68 -4 -80 Z', 'cloth'],
        ['path', 'M2 -82 Q4 -94 15 -95 Q25 -93 25 -78 Q23 -70 13 -70 Q3 -72 2 -82 Z', 'maw'],
        ['circle', { cx: 10, cy: -83, r: 2.8 }, 'glow'],
        ['circle', { cx: 20, cy: -81, r: 2.5 }, 'glow'],
        ['path', 'M-3 -74 Q-10 -66 -12 -56', 'cloth', 4, { fill: 'none' }],
      ],
    },
  },

  /** A construct of stacked slabs with a lit core. Nothing about it is
   * organic, so it neither breathes nor topples — it grinds, and it crumbles.
   * The gaps between the slabs are the silhouette. */
  golem: {
    label: 'Construct',
    attacks: { melee: 'slam', ranged: 'hurl', magic: 'cast' },
    heavy: 'slam', death: 'crumble', rigid: true,
    stature: 0.8,
    muzzle: [28, -60], torso: [0, -54],
    joints: { arm: [12, -72], head: [4, -78] },
    parts: {
      back: [
        ['path', 'M-16 -44 L-22 -20 L-22 -3 L-8 -3 L-8 -20 L-6 -42 Z', 'far'],
        ['path', 'M-12 -70 L-26 -60 L-28 -42 L-19 -40 L-18 -56 L-6 -62 Z', 'far'],
      ],
      body: [
        ['path', 'M-22 -74 L16 -80 L24 -60 L18 -44 L-14 -40 L-24 -56 Z', 'hide'],
        ['path', 'M-10 -72 L10 -74 L14 -60 L8 -48 L-6 -46 L-12 -58 Z', 'shade', 0, { stroke: 'none' }],
        ['circle', { cx: 2, cy: -60, r: 6.5 }, 'glow'],
        ['circle', { cx: 2, cy: -60, r: 3 }, 'belly'],
        ['path', 'M0 -44 L18 -46 L20 -22 L16 -3 L2 -3 L2 -24 Z', 'hide'],
        ['path', 'M0 -3 L20 -3 L22 2 L-1 2 Z', 'hide'],
      ],
      arm: [
        ['path', 'M10 -74 L28 -66 L30 -46 L18 -44 L14 -60 Z', 'hide'],
        ['path', 'M18 -46 L36 -48 L40 -30 L22 -28 Z', 'hide'],
        ['path', 'M24 -44 L34 -45 M24 -38 L36 -39', 'line', 1.6],
      ],
      head: [
        ['path', 'M0 -88 L20 -86 L22 -74 L4 -72 Z', 'hide'],
        ['path', 'M6 -82 L12 -82 L12 -78 L6 -78 Z', 'glow'],
        ['path', 'M15 -82 L20 -81 L20 -77 L15 -77 Z', 'glow'],
      ],
    },
  },

  /** A tree that walks: trunk body, root feet, branch arms, a canopy, and a
   * face read out of a knot. Its swing is a whole branch, so it is heavy at
   * every size. */
  treant: {
    label: 'Treant',
    attacks: { melee: 'slam', ranged: 'hurl', magic: 'cast' },
    heavy: 'slam', death: 'topple', rigid: true,
    stature: 0.82,
    muzzle: [30, -62], torso: [0, -56],
    joints: { arm: [8, -74], head: [0, -80] },
    parts: {
      back: [
        ['path', 'M-16 -52 Q-28 -28 -26 -3 L-14 -3 Q-18 -28 -6 -50 Z', 'far'],
        ['path', 'M-12 -76 Q-32 -70 -40 -52', 'far', 8, { fill: 'none', 'stroke-linecap': 'round' }],
        ['path', 'M-40 -52 L-50 -46 M-40 -52 L-46 -60 M-40 -52 L-40 -40', 'far', 4],
      ],
      body: [
        // A trunk, not a torso: wider at the base than the shoulders, with
        // the bark grain running the whole height of it.
        ['path', 'M-16 -80 Q0 -86 16 -80 Q22 -58 20 -34 Q22 -14 26 -2 L-24 -2 Q-20 -14 -18 -34 Q-22 -58 -16 -80 Z', 'hide'],
        ['path', 'M-10 -76 Q-8 -44 -12 -4 M0 -80 Q2 -44 0 -4 M10 -76 Q8 -44 12 -4', 'line', 2],
        ['path', 'M-4 -60 Q4 -56 10 -60 Q6 -50 -2 -50 Z', 'shade'],
        // Roots, splayed onto the ground where feet would be.
        ['path', 'M-24 -2 Q-34 -2 -40 2 L-16 2 Z', 'hide'],
        ['path', 'M26 -2 Q36 -2 42 2 L18 2 Z', 'hide'],
      ],
      arm: [
        // A branch: it forks, and each fork forks again. A limb that just
        // tapers reads as an arm with a glove on.
        ['path', 'M6 -76 Q26 -72 36 -56', 'hide', 9, { fill: 'none', 'stroke-linecap': 'round' }],
        ['path', 'M36 -56 Q44 -50 48 -40', 'hide', 5, { fill: 'none', 'stroke-linecap': 'round' }],
        ['path', 'M36 -56 Q46 -58 52 -64', 'hide', 5, { fill: 'none', 'stroke-linecap': 'round' }],
        ['path', 'M48 -40 L52 -34 M48 -40 L54 -42 M52 -64 L58 -68 M52 -64 L54 -58', 'hide', 3],
      ],
      head: [
        // The canopy rides the HEAD group, so a slam swings the whole crown.
        // Its outline is scalloped rather than a stack of ellipses — a
        // stacked-ellipse canopy reads as broccoli (docs/action-animations.md
        // records the same lesson from the woodcutting tree).
        ['path', 'M-30 -86 Q-38 -100 -22 -104 Q-20 -116 -4 -114 Q6 -122 18 -114 Q34 -116 34 -102 Q44 -94 32 -84 Q16 -76 -2 -78 Q-20 -78 -30 -86 Z', 'foliage'],
        ['path', 'M-18 -96 Q-8 -104 4 -100 Q14 -106 24 -98', 'foliagevein', 2.2],
        ['path', 'M-22 -88 Q-6 -82 12 -86', 'foliagevein', 2],
        ['ellipse', { cx: -2, cy: -76, rx: 3.8, ry: 3.2 }, 'maw'],
        ['ellipse', { cx: 11, cy: -76, rx: 3.4, ry: 2.8 }, 'maw'],
        ['circle', { cx: -1.4, cy: -76, r: 1.5 }, 'glow'],
        ['circle', { cx: 11.6, cy: -76, r: 1.4 }, 'glow'],
        ['path', 'M-2 -68 Q5 -63 13 -68', 'maw', 2.4, { fill: 'none' }],
        ['path', 'M0 -67 L1 -63 M6 -66 L7 -62 M11 -67 L12 -63', 'horn', 1.5],
      ],
    },
  },
}

// Every archetype key, for the classifier's structural test and the preview
// script. Order is display order in the preview plate only.
export const MONSTER_ARCHETYPES = Object.keys(ARCHETYPES)

/** The groups a body can declare, in DRAW ORDER. A group not declared is not
 * drawn — and the order is fixed here rather than by object-key order in each
 * archetype, so a body cannot accidentally paint its near wing under its own
 * torso by listing the keys in the wrong sequence. */
export const MONSTER_GROUPS = ['back', 'tail', 'body', 'arm', 'head', 'wing', 'fore']

export function monsterShapeFor(archetype) {
  return ARCHETYPES[archetype] || ARCHETYPES.humanoid
}

export function hasMonsterArchetype(archetype) {
  return Object.prototype.hasOwnProperty.call(ARCHETYPES, archetype)
}

/**
 * Stroke width for one part, divided back out by the figure's scale.
 * Identical in purpose to weaponShapes.js's `partStrokeWidth`, and separate
 * from it because the role tables are different — sharing one would mean a
 * monster role and a weapon role could never have the same name.
 */
export function monsterPartStrokeWidth(part, scale) {
  const [, , role, sw] = part
  const declared = sw != null ? sw : (MONSTER_ROLE_STROKE[role] || 0)
  return declared / (scale || 1)
}

/** Every drawn point of an archetype, in its own local frame. Used by the
 * bounds test — a creature that overflows the 260x128 stage is invisible at
 * exactly the moment it matters. */
export function monsterPartPoints(part) {
  const [tag, geom] = part
  if (tag === 'circle') return [[geom.cx - geom.r, geom.cy - geom.r], [geom.cx + geom.r, geom.cy + geom.r]]
  if (tag === 'ellipse') return [[geom.cx - geom.rx, geom.cy - geom.ry], [geom.cx + geom.rx, geom.cy + geom.ry]]
  const out = []
  const nums = String(geom).match(/-?\d+(?:\.\d+)?/g) || []
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([Number(nums[i]), Number(nums[i + 1])])
  return out
}

// Bounds are measured by parsing every path in a body, which is fine once and
// wasteful every render — and the render DOES ask, because the fit solve runs
// per frame in monsterFigures.js. The set of archetypes is fixed and their
// geometry is immutable module data, so one cache entry per archetype is the
// whole story.
const BOUNDS_CACHE = new Map()

/** Local-frame bounding box of a whole archetype. */
export function monsterBounds(archetype) {
  const cached = BOUNDS_CACHE.get(archetype)
  if (cached) return cached
  const shape = monsterShapeFor(archetype)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const group of MONSTER_GROUPS) {
    for (const part of shape.parts[group] || []) {
      for (const [x, y] of monsterPartPoints(part)) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  const box = { minX, minY, maxX, maxY }
  BOUNDS_CACHE.set(archetype, box)
  return box
}
