/**
 * The Inkwright body — boots, legs, belt, jerkin, a real head, back arm.
 * Shared by every context that draws the figure: skilling (InkwrightStage.jsx)
 * and combat (InkwrightCombatStage.jsx). One character, reused everywhere, is
 * the whole point of the name — this file exists so the geometry can only
 * ever drift from itself, never from a second copy of itself.
 *
 * Deliberately NOT the front arm or whatever it's holding: those differ by
 * context (a pickaxe vs a sword vs a bow), so the caller renders them as
 * `children` inside its own `<g class="ink-arm">` (or `.inkc-arm`) — always
 * starting from the exact same shoulder segment, `M84 58 L94 62 L100 64`,
 * hard-coded identically at both call sites. THIS FILE MUST NEVER MOVE THAT
 * JOINT: combat's weapon math (`weaponShapes.js`'s `GRIP_X`/`GRIP_Y`, every
 * `transform-origin` in the `.inkc-*`/`.ink-*` CSS) is anchored to (84,58)
 * for the shoulder and (100,64) for the grip, and neither file re-derives
 * those from this one's geometry — they're independently hard-coded
 * constants that happen to agree. A redraw of the BODY (this file) is safe
 * exactly because the joints it must line up with live outside it.
 *
 * Articulated but still an ink figure, not a painting: ONE outline weight
 * for every part (the `Limb` helper's stroke discipline) plus a SMALL fixed
 * accent palette (`--ink-skin`/`--ink-hair`/`--ink-leather`/`--ink-brass`/
 * `--ink-boot`, src/index.css `:root` — not theme-flipped, same precedent as
 * `--tier-*`/`--potion-*`) rather than the multi-stop gradients an early
 * prototype (docs/skilling-plates-review.html) used and rejected for
 * production: this stage renders at combat speed next to a mirrored enemy,
 * and a flat, deliberately narrow palette is what keeps it legible at 128px
 * tall instead of the exploratory version's much bigger single-scene canvas.
 *
 * A face, this time — the previous "no face" cowl silhouette is gone. There
 * is nothing left to keep consistent across every verb and every weapon that
 * a plain, calm expression doesn't already handle; CLAUDE.md's
 * action-animation skill records the lesson from the FIRST pass at a face
 * (the cowl drawn peaking up read as an animal ear) so this one keeps the
 * brow and hairline low and forward instead.
 */
export default function InkwrightFigure({ children }) {
  return (
    <>
      {/* BACK LEG — partly behind the front leg and torso, so it reads as
          weight braced rather than two legs pasted side by side. */}
      <g class="ink-leg">
        <Limb d="M74 84 L66 96 L58 106" w={12} back />
        <path class="ink-boot" d="M52 100 Q50 104 51 108 L64 108 Q65 103 61 99 Z" />
        <path class="ink-boot-sole" d="M51 108 L64 108" />
      </g>

      {/* FRONT LEG */}
      <g class="ink-leg">
        <Limb d="M80 84 L88 97 L94 107" w={13} />
        <path class="ink-boot" d="M87 101 Q86 105 88 108 L101 108 Q102 103 98 99 Z" />
        <path class="ink-boot-sole" d="M88 108 L101 108" />
      </g>

      {/* BACK ARM — tucked behind the torso, a counterweight rather than
          something the eye is meant to land on. Ends in a loose fist so it
          reads as a limb at rest, not a stroke that stops mid-air. */}
      <g class="ink-arm-back">
        <Limb d="M78 58 L69 68 L64 76" w={10} back />
        <circle class="ink-skin-fill" cx="64" cy="78" r="4.4" />
      </g>

      {/* TORSO — a shirt collar under a leather jerkin, belted. The jerkin's
          own shading line is what keeps a single flat leather tone from
          reading as a paper cutout. */}
      <path class="ink-cloth" d="M66 54 Q63 70 65 86 L88 86 Q90 70 87 54 Z" />
      <path class="ink-jerkin" d="M64 51 Q75 44 86 51 Q91 62 89 75 Q88 83 82 86 L70 86 Q64 83 63 75 Q61 62 64 51 Z" />
      <path class="ink-jerkin-shade" d="M75 52 L77 85" />
      <path class="ink-jerkin-collar" d="M67 53 Q76 60 84 53" />

      {/* Belt + buckle, sitting where the old tunic's single belt-height line
          used to be — now an actual worn strap instead of a suggestion of one. */}
      <path class="ink-belt" d="M62 78 Q76 84 90 78 L91 83 Q76 89 61 83 Z" />
      <rect class="ink-buckle" x="71.5" y="78.5" width="7.5" height="7.5" rx="1.3" />
      <rect class="ink-buckle-hollow" x="73.6" y="80.6" width="3.3" height="3.3" rx=".6" />

      {/* Neck + head. The hollow-hooded silhouette this replaces had no face
          at all ("nothing to keep consistent across every verb and weapon");
          this version keeps that same restraint — one brow, one eye, one
          mouth line, no attempt at per-expression detail. */}
      <path class="ink-skin" d="M74 46 L78 54" style={{ strokeWidth: 9 }} />
      <g class="ink-head">
        <path class="ink-skin" d="M65 25 Q76 16 87 24 Q91 33 88 42 Q84 50 75 50 Q66 48 64 39 Q62 31 65 25 Z" />
        <path class="ink-hair" d="M63 29 Q61 16 76 13 Q91 11 89 25 L86 25 Q85 17 75 18 Q67 19 65 28 Z" />
        <ellipse class="ink-eye" cx="80.5" cy="31" rx="1.7" ry="2" />
        <path class="ink-brow" d="M77 26 Q80.5 24.3 84 26" />
        <path class="ink-mouth" d="M74.5 41 Q78.5 43 82.5 40" />
        <path class="ink-nose" d="M87.5 34 Q89.5 36 87 38" />
      </g>

      {children}
    </>
  )
}

/** An outlined limb: one ink stroke with a narrower cloth stroke on top.
 * Drawn the other way round it renders a stick with a halo. */
export function Limb({ d, w, back = false }) {
  return (
    <g>
      <path class="ink-limb-ink" d={d} style={{ strokeWidth: w }} />
      <path class={back ? 'ink-limb-back' : 'ink-limb-fill'} d={d} style={{ strokeWidth: w - 6.2 }} />
    </g>
  )
}
