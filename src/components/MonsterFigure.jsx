import { monsterShapeFor, monsterPartStrokeWidth, MONSTER_GROUPS, isStrokedPart, INKED_STROKE_ROLES, LIMB_STROKE_MIN } from '../utils/monsterShapes.js'
import { FOOT_X, GROUND_Y, MONSTER_MOTIONS } from '../utils/monsterFigures.js'
import { useAnimationFlip } from '../hooks/useActionSwings.js'

/**
 * One drawn monster, placed on InkwrightCombatStage's enemy side.
 *
 * This is the counterpart of `CombatTool` and it is only a MAPPER: every path
 * lives in utils/monsterShapes.js, every colour in index.css's `.inkm-*`
 * rules, and every decision about WHICH creature/palette/size/motion in
 * utils/monsterFigures.js. Nothing is chosen here.
 *
 * It replaces "the enemy is the player's own rig, mirrored, with an aura" —
 * the one gap docs/action-animations.md left open in the combat stage.
 *
 * FOUR NESTED WRAPPERS, and each one exists because it owns a different
 * animation. CSS `transform` is a single property: two animations that want
 * it must live on two elements.
 *
 *   .inkm-place  static placement (translate + scale). NEVER animated — a
 *                static `transform` attribute and a CSS `animation` on the
 *                same element cannot coexist; the animation silently wins and
 *                discards the placement, which here would drop every monster
 *                to origin at full size the instant it moved.
 *   .inkm-idle   the breathing loop. Runs forever, restarts never.
 *   .inkm-hit    the recoil, restarted by the blow that landed on it.
 *   .inkm-fig    the attack's motion class, and the heavy lurch.
 *   the limb     the one group `figure.motion` animates, keyed by the swing.
 *
 * NOTHING THAT WRAPS ANOTHER ANIMATED ELEMENT IS KEYED. A `key` change
 * remounts the element AND its whole subtree, and a freshly mounted element
 * whose animation class is still applied plays that animation again — so a
 * keyed recoil wrapper made the monster appear to swing every time the player
 * hit it, and vice versa. The wrappers restart by alternating their
 * animation-name instead (`useAnimationFlip`); only the innermost thing, the
 * striking limb, is keyed, which is also what keeps a swing from restarting
 * the tail sway and the wingbeat around it. The one exception is a `sting`,
 * whose striking limb IS the tail — its sway restarts, under the sting that
 * outranks it, and resumes from the top afterwards.
 *
 * Props:
 *   figure   — utils/monsterFigures.js `monsterFigureFor()` result
 *   striking — the creature's own swing token, or null. A new `id` replays.
 *   struck   — a token for a blow that LANDED on it, or null. A new `id`
 *              replays. Separate from `striking` on purpose: a monster can be
 *              hit mid-swing, and sharing one key would make each replay the
 *              other's motion.
 *   dying    — hold still and drop the weapon; the collapse itself is played
 *              by the stage's own `.inkc-fig.enemy.is-dying`, one level up,
 *              because it topples the whole side including the shadow.
 *   weapon   — a rendered weapon node for an `armed` archetype, or null.
 *              Passed in rather than imported so this component stays free of
 *              CombatTool and the twelve weapon shapes behind it.
 */
export default function MonsterFigure({ figure, striking = null, struck = null, dying = false, weapon = null }) {
  // Hooks run every render, before the early return.
  const struckFlip = useAnimationFlip(struck)
  const strikeFlip = useAnimationFlip(striking)
  if (!figure) return null
  const shape = monsterShapeFor(figure.archetype)
  const s = figure.scale
  const place = `translate(${FOOT_X} ${GROUND_Y - figure.lift}) scale(${s})`

  // The palette reaches CSS as four custom properties set ONCE on the whole
  // figure, not as a fill on each of ~40 parts. `.inkm-hide` and friends read
  // them, so a 40-part creature costs one inline style rather than forty.
  const paint = {
    '--inkm-hide': figure.palette.hide,
    '--inkm-shade': figure.palette.shade,
    '--inkm-belly': figure.palette.belly,
    '--inkm-horn': figure.palette.horn,
    // A multi-form boss's eyes take its CURRENT form's colour, so the phase
    // is readable off the creature itself rather than only off a chip in the
    // HUD. Everything else keeps the palette.
    '--inkm-eye': figure.phaseGlow || figure.palette.eye,
    // The recoil's knockback, divided back out by this figure's scale so it
    // reads the same distance on screen for a chicken as for a kraken — the
    // same compensation every stroke width below makes, and the only
    // TRANSFORM on the stage that needs it (the limb motions are rotations,
    // which a uniform scale leaves alone).
    '--inkm-recoil': `${(5 / s).toFixed(2)}px`,
  }

  const striking_ = striking && !dying
  const motionClass = ` inkm-fig--${figure.motion}`
  // The lurch is on `.inkm-fig`, which never remounts, so it restarts by
  // alternating its keyframe name like the recoil does.
  const heavy = figure.heavyMotion ? ` is-heavy${striking_ ? ` is-lurch-${strikeFlip}` : ''}` : ''
  const rigid = figure.rigid ? ' is-rigid' : ''
  const flier = figure.flier ? ' is-flier' : ''
  // Only the group this motion animates is keyed — see the header.
  const strikingGroup = striking_ ? MONSTER_MOTIONS[figure.motion] : null

  return (
    <g class="inkm-place" transform={place} style={paint}>
      <g class={`inkm-idle${rigid}${flier}${figure.lift ? ' is-hover' : ''}`}>
        <g class={`inkm-hit${struck ? ` is-struck-${struckFlip}` : ''}`}>
          <g class={`inkm-fig${motionClass}${heavy}${striking_ ? ' is-striking' : ''}`}>
            {MONSTER_GROUPS.map(group => {
              const parts = shape.parts[group]
              if (!parts) return null
              const joint = shape.joints?.[group]
              // Only a group with a joint can be animated, so only a group
              // with a joint pays for an inline transform-origin. The origin
              // is in the creature's OWN local units — `transform-box:
              // view-box` resolves a length origin in the element's local
              // space, which inside this component's `scale()` is exactly the
              // frame monsterShapes.js authors in.
              const style = joint ? { transformOrigin: `${joint[0]}px ${joint[1]}px` } : undefined
              // The striking limb is keyed by the swing so its one-shot
              // motion replays; every other group keeps a stable key so its
              // idle loop is never restarted mid-cycle.
              const key = group === strikingGroup ? `${group}${striking.id}` : group
              return (
                <g key={key} class={`inkm-${group}`} style={style}>
                  {parts.map((part, i) => (
                    <MonsterPart key={i} part={part} scale={s} />
                  ))}
                  {/* An armed archetype's weapon rides its arm, drawn at the
                      grip the same way the player's does — and, like the
                      player's, it is drawn AT REST too. Gating it on "mid
                      swing" is what made the old generic enemy's weapon
                      flicker in and out of existence between attacks. */}
                  {group === 'arm' && weapon && !dying && shape.grip && (
                    <g transform={`translate(${shape.grip[0]} ${shape.grip[1]})`}>{weapon}</g>
                  )}
                </g>
              )
            })}
          </g>
        </g>
      </g>
    </g>
  )
}

/** One drawn part. `role` picks the paint (`.inkm-*` in index.css); nothing
 * here knows a colour, exactly as in WeaponPart.
 *
 * A role paints two ways — filled for a closed shape, stroked for an open one
 * (`.inkm-<role>.is-stroke`) — because a spider's leg and a spider's abdomen
 * are the same hide in the same palette and it would be absurd to author two
 * role names for that. Which one applies is read off the geometry
 * (`isStrokedPart`), never declared.
 */
function MonsterPart({ part, scale }) {
  const [tag, geom, role, , extra] = part
  // EVERY stroked part gets an explicit width divided back out by the
  // figure's scale: an SVG transform scales stroke too, so a chicken drawn at
  // 0.37 would carry a third of the outline weight and read as a smudge next
  // to a player drawn at full weight. A width left to a stylesheet is a width
  // this compensation can never reach.
  const declared = monsterPartStrokeWidth(part, 1)
  const width = declared / scale
  const stroked = isStrokedPart(part)
  const props = {
    class: `inkm-${role}${stroked ? ' is-stroke' : ''}`,
    style: width ? { strokeWidth: width } : undefined,
    ...extra,
  }
  if (tag === 'circle') return <circle cx={geom.cx} cy={geom.cy} r={geom.r} {...props} />
  if (tag === 'ellipse') return <ellipse cx={geom.cx} cy={geom.cy} rx={geom.rx} ry={geom.ry} {...props} />
  // A limb-weight stroke is drawn TWICE — a wider ink pass under a narrower
  // colour pass — which is exactly what InkwrightFigure's `Limb` does for the
  // player. Drawn the other way round it renders a stick with a halo.
  //
  // The ink pass is only 1.6 wider in TOTAL, i.e. 0.8 either side. A wider
  // margin was tried and it swamps the limb: at a spider-leg gauge the ink
  // ends up covering more of the stroke than the hide colour does, and a
  // whole creature made of limbs turns into a cream tangle with no colour
  // left in it.
  if (stroked && declared >= LIMB_STROKE_MIN && INKED_STROKE_ROLES.has(role)) {
    return (
      <>
        <path class="inkm-ink" d={geom} style={{ strokeWidth: (declared + 1.6) / scale }} />
        <path d={geom} {...props} />
      </>
    )
  }
  return <path d={geom} {...props} />
}
