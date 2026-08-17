import GameIcon from './GameIcon.jsx'
import InkwrightFigure, { Limb } from './InkwrightFigure.jsx'
import { getItemIconTint } from '../utils/itemIcons.js'
import { resolveItemIcon } from '../utils/itemIconResolve.js'
import bespokeIconsData from '../data/bespokeIcons.json'
import gameIconsData from '../data/gameIcons.json'

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
  // Fishing is the one skill where the "resource" IS the item — a rock is
  // always a rock, but a shark and a shrimp are different animals. Every raw
  // fish resolves to the same flat #f4a08c through getItemIconTint (there is
  // no tier ladder for fish), so a tinted silhouette could never tell a shark
  // from a shrimp — the real bespoke art has to, the same art the inventory
  // already shows for that item.
  const fishArt = prop === 'water' ? bespokeFishArt(product) : null
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
          <Prop kind={prop} fishArt={fishArt} swinging={swinging} />
        </g>
        {broke && (
          <g key={`p${yieldToken}`} class={`ink-payoff ink-payoff--${motion}`}>
            <Prop kind={prop} broken fishArt={fishArt} />
          </g>
        )}

        {/* The figure. Only the arm swings; the body carries the recoil. */}
        <g class={`ink-fig ink-fig--${motion}${swinging ? ' is-working' : ''}`} key={`f${yieldToken}`}>
          <InkwrightFigure>
            {/* Arm and tool rotate together about the shoulder, so the tool
                cannot drift out of the hand. */}
            <g class="ink-arm">
              <Limb d="M84 58 L94 62 L100 64" w={11} />
              <Tool kind={motion} />
            </g>
          </InkwrightFigure>
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
    // The line's end point sits well below the water's y=96 surface (not
    // right at it) so the rod's ±7deg rest-sway (inkStrikeFish) never swings
    // the hook back above the surface — a line that clears the water even
    // briefly breaks the "cast into the pond" read this stage exists for.
    return (
      <g>
        <path class="ink-shaft ink-shaft--thin" d="M92 72 L138 36" />
        <circle class="ink-blade" cx="103" cy="63" r="3.2" />
        <path class="ink-lineout" d="M138 36 Q150 74 148 114" />
        <circle class="ink-float" cx="148" cy="114" r="2.4" />
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

// Every raw fish has a bespoke entry (checked against skills.json's fishing
// products) and none are `tintable`, so this always comes back as the item's
// own multi-tone art with no tint to apply — unlike ore/logs, whose colour IS
// the flat tint. Returns null only if the data hasn't loaded yet (chunk not
// ready) or an unmapped item slips through, and the water just stays empty
// rather than guess at a placeholder.
export function bespokeFishArt(product) {
  if (!product) return null
  const icon = resolveItemIcon(product, {
    bespoke: typeof bespokeIconsData !== 'undefined' ? bespokeIconsData : null,
    glyphs: typeof gameIconsData !== 'undefined' ? gameIconsData : null,
  })
  if (icon.kind === 'none') return null
  const [vx, vy, vw, vh] = (icon.viewBox || '0 0 512 512').split(/\s+/).map(Number)
  return { body: icon.body, tint: icon.tint, cx: vx + vw / 2, cy: vy + vh / 2, size: Math.max(vw, vh) }
}

// The fish's own art, scaled from its native (typically 512x512) viewBox down
// into this stage's 200x128 frame and recentred on (cx, cy). A CSS animation
// on the OUTER group composes with this positioning transform rather than
// fighting it — same layering as .ink-arm's rotation around a fixed origin.
function FishArt({ art, cx, cy, width, className }) {
  const scale = width / (art.size || 512)
  return (
    <g class={className} style={{ transformOrigin: `${cx}px ${cy}px` }}>
      <g
        transform={`translate(${cx} ${cy}) scale(${scale}) translate(${-art.cx} ${-art.cy})`}
        {...(art.tint ? { fill: art.tint } : {})}
        dangerouslySetInnerHTML={{ __html: art.body }}
      />
    </g>
  )
}

/** The resource. `broken` is the payoff layer — the same silhouette split into
 * pieces that fly, so the whole and the broken form can never drift apart.
 * `swinging` only matters to the idle fish, so it can freeze with the figure
 * when the action is stalled (inventory full) rather than keep roaming. */
function Prop({ kind, broken = false, fishArt = null, swinging = true }) {
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
        {/* The bank: a solid ledge the figure stands at the lip of, so the cast
            reads as thrown OUT and DOWN into the pond rather than into a flat
            puddle at the figure's feet. */}
        <path class="ink-bank" d="M92 108 L118 96 L104 128 Z" />
        <path class="ink-water" d="M104 128 L118 96 H196 V128 Z" />
        <path class="ink-water-ripple" d="M118 96 Q130 92 142 96 T168 96 T196 96" />
        {/* Idling: the actual species, roaming below the surface. Hidden the
            instant the payoff starts (sibling `.ink-payoff` group takes over),
            so there is never a second fish on screen at once. */}
        {!broken && fishArt && (
          <FishArt art={fishArt} cx={152} cy={112} width={26} className={`ink-fish-idle${swinging ? ' is-working' : ''}`} />
        )}
        {/* Caught: the SAME art, breaking the surface on the rise. Falls back
            to a plain silhouette if the bespoke data was not ready — better a
            generic catch than none at all mid-payoff. */}
        {broken && (fishArt
          ? <FishArt art={fishArt} cx={156} cy={100} width={22} className="ink-catch" />
          : <path class="ink-catch ink-catch--fallback" d="M149 104 Q156 99 164 104 Q156 109 149 104 Z" />
        )}
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
