import GameIcon from './GameIcon.jsx'
import { getItemIconTint } from '../utils/itemIcons.js'

/**
 * Inkwright: the skilling figure at work. One inked-vector character strikes a
 * resource in time with the action, and the resource gives way when the action
 * completes.
 *
 * Pure presentation. Every duration arrives already solved by
 * utils/inkwright.js — this component must not derive one, or the "animation
 * speed IS the action's cadence" law stops holding the moment someone edits the
 * CSS. The two it receives:
 *   --ink-strike  one strike, looping forever at the action's own tempo
 *   --ink-payoff  the one-shot beat when the resource gives way
 *
 * The strike fills its whole period, and the period IS the tempo — the wind-up
 * and recovery stretch to fill a longer one. That is correct here and wrong for
 * combat: a combat cycle is one swing, so its motion is a shrinking fraction of
 * the cycle (swingDurationMs). A skilling period is already near-constant by
 * construction, so a second scaling on top of it would do nothing but drift.
 *
 * THE STRIKE LOOP IS RE-KEYED ON EVERY COMPLETED ACTION, which is what keeps it
 * phase-locked. `plan.strikes` strikes divide the action exactly, so a loop
 * restarted at each yield lands its final impact on the next yield, forever. A
 * free-running loop drifts within a few actions and the pick starts passing
 * through a rock that breaks on its own.
 *
 * The payoff is a SIBLING of the prop, never a wrapper: a CSS animation replays
 * when its element mounts, so a wrapper remounting on each yield would drag the
 * strike loop inside it along and restart the figure mid-swing.
 *
 * Progress is deliberately NOT a prop. getActionProgress is tick-quantised — a
 * 4-tick action only ever reports 0, .25, .5, .75 — so driving motion from it
 * gives four poses and a jump. The bar reads progress; the figure reads a clock.
 *
 * Props:
 *   plan       — from inkwrightPlan(): motion, prop, strikePeriodMs, payoffMs
 *   product    — the item being produced, for the icon and its tint
 *   yieldToken — completed-action count; a change replays the payoff
 *   paused     — true when the action is stalled (inventory full), freezing the figure
 *   label      — accessible description
 */
export default function InkwrightStage({ plan, product = null, yieldToken = 0, paused = false, label = null }) {
  if (!plan) return null

  const { motion, prop, strikePeriodMs, payoffMs } = plan
  const swinging = !paused
  // The resource takes its colour from the item it yields, through the same
  // resolver the inventory uses — so copper reads copper and mithril blue
  // without this component knowing a single ore exists.
  const tint = (product && getItemIconTint(product)) || 'var(--text-soft)'
  // Nothing has given way until an action has actually completed. Rendering
  // the payoff at mount shattered the rock the instant the screen opened, and
  // popped a reward for an action nobody had finished.
  const broke = yieldToken > 0

  return (
    <div
      class="ink-stage"
      role="img"
      aria-label={label || `${plan.label} in progress`}
      style={{
        '--ink-strike': `${strikePeriodMs}ms`,
        '--ink-payoff': `${payoffMs}ms`,
        '--ink-tint': tint,
      }}
    >
      <svg class="ink-svg" viewBox="0 0 200 128" aria-hidden="true">
        {/* Ground the two sides stand on. Without it the figure and the rock
            read as two unrelated drawings floating in a box. */}
        <path class="ink-ground" d="M12 108 H188" />
        <ellipse class="ink-shadow" cx="76" cy="108" rx="23" ry="3.4" />

        {/* Prop, and its payoff as a SIBLING layer keyed on the yield. The
            intact resource hides for exactly the payoff's length and returns as
            the next one — left up, the broken pieces fly over a rock that is
            still standing there whole. */}
        <g key={`pr${yieldToken}`} class={`ink-prop${broke ? ' is-breaking' : ''}`}>
          <Prop kind={prop} />
        </g>
        {broke && (
          <g key={`p${yieldToken}`} class={`ink-payoff ink-payoff--${motion}`}>
            <Prop kind={prop} broken />
          </g>
        )}

        {/* The figure. Only the arm swings; the body carries the recoil. */}
        <g class={`ink-fig ink-fig--${motion}${swinging ? ' is-working' : ''}`} key={`f${yieldToken}`}>
          <g class="ink-legs">
            <Limb d="M72 84 L63 96 L55 103" w={12} back />
            <Limb d="M78 84 L86 97 L95 104" w={13} />
          </g>
          <Limb d="M78 60 L68 70 L66 78" w={10} back />

          {/* Tunic */}
          <path class="ink-cloth" d="M67 54 Q64 72 66 86 L86 86 Q88 72 86 54 Z" />
          <path class="ink-line" d="M66.5 73 L86.5 73" />

          {/* Hood, draping FORWARD over the brow. An upward peak reads as an
              animal ear, which is what the first pass drew. */}
          <path class="ink-cloth" d="M65 57 Q57 45 62 32 Q69 21 81 23 Q94 26 94 41 Q94 51 89 57 Z" />
          <path class="ink-hollow" d="M85 33 Q93 36 92 45 Q90 52 84 53 Q80 43 85 33 Z" />
          <path class="ink-cloth2" d="M64 53 Q76 63 90 53 Q92 60 86 65 L68 65 Q62 60 64 53 Z" />

          {/* Arm and tool rotate together about the shoulder, so the tool
              cannot drift out of the hand. */}
          <g class="ink-arm">
            <Limb d="M84 58 L94 62 L100 64" w={11} />
            <Tool kind={motion} />
          </g>
        </g>

      </svg>

      {/* What the action produced, popped on the yield. An HTML sibling rather
          than a foreignObject: GameIcon renders its own <svg>, and nesting one
          inside this one through foreignObject buys nothing but quirks. */}
      {product && broke && (
        <div key={`y${yieldToken}`} class="ink-yield" aria-hidden="true">
          <GameIcon item={product} size={30} />
        </div>
      )}
    </div>
  )
}

/** An outlined limb: one ink stroke with a narrower cloth stroke on top.
 * Drawn the other way round it renders a stick with a halo. */
function Limb({ d, w, back = false }) {
  return (
    <g>
      <path class="ink-limb-ink" d={d} style={{ strokeWidth: w }} />
      <path class={back ? 'ink-limb-back' : 'ink-limb-fill'} d={d} style={{ strokeWidth: w - 6.2 }} />
    </g>
  )
}

/** Each shaft passes THROUGH the hand at (100,64) and shows a grip, so the
 * tool reads as held rather than floating alongside the arm. */
function Tool({ kind }) {
  if (kind === 'chop') {
    return (
      <g>
        <path class="ink-shaft" d="M92 70 L124 52" />
        <path class="ink-blade" d="M117 45 L128 47 Q135 54 128 61 L117 60 Z" />
        <path class="ink-edge" d="M128 47 Q135 54 128 61" />
        <path class="ink-grip" d="M96 68 L104 64" />
      </g>
    )
  }
  if (kind === 'fish') {
    return (
      <g>
        <path class="ink-shaft ink-shaft--thin" d="M92 72 L138 36" />
        <circle class="ink-blade" cx="103" cy="63" r="3.2" />
        <path class="ink-lineout" d="M138 36 Q150 62 156 95" />
        <circle class="ink-float" cx="156" cy="96" r="2.6" />
      </g>
    )
  }
  return (
    <g>
      <path class="ink-shaft" d="M92 70 L128 50" />
      {/* Double-pointed head straddling the haft's end. Drawn as a stroked
          arc it bowed away from the shaft and read as a hook. */}
      <path class="ink-blade" d="M120 37 L131 48 L135 61 L125 52 Z" />
      <path class="ink-grip" d="M96 68 L104 64" />
    </g>
  )
}

/** The resource. `broken` is the payoff layer — the same silhouette split into
 * pieces that fly, so the whole and the broken form can never drift apart. */
function Prop({ kind, broken = false }) {
  if (kind === 'tree') {
    // The trunk below the cut is a stump and never moves; everything above it
    // hinges at the notch, so the tree lets go where the axe has been landing
    // rather than snapping off at the roots.
    return (
      <g>
        <path class="ink-res" d="M132 108 Q131.4 92 133.2 79 L148.8 79 Q150.4 92 150 108 Z" />
        {!broken && (
          <g class="ink-faller">
            <path class="ink-res ink-res--soft" d="M130 62 Q112 56 116 38 Q120 20 140 18 Q162 16 166 34 Q170 54 152 62 Z" />
            <path class="ink-res" d="M133.2 79 Q134 68 135 58 L147 58 Q148 68 148.8 79 Z" />
          </g>
        )}
        {broken && (
          <g class="ink-fall">
            <path class="ink-res ink-res--soft" d="M130 62 Q112 56 116 38 Q120 20 140 18 Q162 16 166 34 Q170 54 152 62 Z" />
            <path class="ink-res" d="M133.2 79 Q134 68 135 58 L147 58 Q148 68 148.8 79 Z" />
          </g>
        )}
      </g>
    )
  }

  if (kind === 'water') {
    return (
      <g>
        <path class="ink-water" d="M104 128 L118 96 H196 V128 Z" />
        <path class="ink-line" d="M118 96 Q130 92 142 96 T168 96 T196 96" />
        {broken && <path class="ink-catch" d="M149 104 Q156 99 164 104 Q156 109 149 104 Z" />}
      </g>
    )
  }

  // Rock. The whole silhouette, and the same silhouette split four ways —
  // the shard seams double as the facets, so an unbroken rock still reads
  // as faceted stone rather than a pebble.
  if (!broken) {
    return (
      <g>
        <path class="ink-res" d="M130 108 Q123 96 129 85 Q135 75 148 73 Q161 72 166 84 Q171 96 165 105 Q160 109 152 108 Z" />
        <path class="ink-facet" d="M143 89 L150 87 L157 92" />
        <path class="ink-facet" d="M143 89 L141 108" />
      </g>
    )
  }
  return (
    <g>
      <path class="ink-res ink-shard ink-shard--a" d="M130 108 Q123 96 129 85 L143 89 L141 108 Z" />
      <path class="ink-res ink-shard ink-shard--b" d="M129 85 Q135 75 148 73 L150 87 L143 89 Z" />
      <path class="ink-res ink-shard ink-shard--c" d="M148 73 Q161 72 166 84 L157 92 L150 87 Z" />
      <path class="ink-res ink-shard ink-shard--d" d="M143 89 L150 87 L157 92 L166 84 Q171 96 165 105 Q160 109 152 108 L141 108 Z" />
    </g>
  )
}
