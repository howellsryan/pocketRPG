import GameIcon from './GameIcon.jsx'
import InkwrightFigure, { Limb } from './InkwrightFigure.jsx'
import { getItemIconTint } from '../utils/itemIcons.js'
import { resolveItemIcon } from '../utils/itemIconResolve.js'
import bespokeIconsData from '../data/bespokeIcons.json'
import gameIconsData from '../data/gameIcons.json'

/**
 * Inkwright: the skilling figure at work. One articulated character strikes
 * a resource in time with the action, and the resource gives way when the
 * action completes.
 *
 * Baseline for the fidelity bar every skilling animation now targets: real
 * tools (a crescent pickaxe, a bearded felling axe, a three-segment fishing
 * rod — authored local-frame, same convention as combat's `weaponShapes.js`)
 * and real environments (an ore boulder proud of a strata'd rock wall, a
 * tree with a persistent notch under a broken-silhouette canopy, a river
 * with a surface film and the caught species' own art), replacing the
 * hooded ink-vector figure this used to draw. Design record, the review
 * artifact this was built from, and the measured-impact-point methodology:
 * docs/action-animations.md.
 *
 * The figure body (`InkwrightFigure.jsx`) is shared with combat — this file
 * supplies only the front arm/tool, same as it always did, at the same
 * shoulder (84,58) and grip (100,64) combat's math depends on. What's new is
 * everything drawn AROUND that figure.
 *
 * Pure presentation. Every duration arrives already solved by
 * utils/inkwright.js — this component must not derive one, or the "animation
 * speed IS the action's cadence" law stops holding the moment someone edits
 * the CSS. The two it receives:
 *   --ink-strike  one strike, looping forever at the action's own tempo
 *   --ink-payoff  the one-shot beat when the resource gives way
 *
 * THE STRIKE LOOP IS RE-KEYED ON EVERY COMPLETED ACTION, which is what keeps
 * it phase-locked. `plan.strikes` strikes divide the action exactly, so a
 * loop restarted at each yield lands its final impact on the next yield,
 * forever. A free-running loop drifts within a few actions and the pick
 * starts passing through a rock that breaks on its own.
 *
 * The payoff is a SIBLING of the prop, never a wrapper: a CSS animation
 * replays when its element mounts, so a wrapper remounting on each yield
 * would drag the strike loop inside it along and restart the figure
 * mid-swing.
 *
 * Progress is deliberately NOT a prop. getActionProgress is tick-quantised —
 * a 4-tick action only ever reports 0, .25, .5, .75 — so driving motion from
 * it gives four poses and a jump. The bar reads progress; the figure reads a
 * clock.
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
  // fish resolves to the same flat colour through getItemIconTint (there is
  // no tier ladder for fish), so a tinted silhouette could never tell a
  // shark from a shrimp — the real bespoke art has to, the same art the
  // inventory already shows for that item.
  const fishArt = prop === 'water' ? bespokeFishArt(product) : null
  // Nothing has given way until an action has actually completed. Rendering
  // the payoff at mount shattered the rock the instant the screen opened,
  // and popped a reward for an action nobody had finished.
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
        <Backdrop kind={prop} />

        {/* Prop, and its payoff as a SIBLING layer keyed on the yield. The
            intact resource hides for exactly the payoff's length and returns
            as the next one — left up, the broken pieces fly over a rock that
            is still standing there whole. */}
        <g key={`pr${yieldToken}`} class={`ink-prop${broke ? ' is-breaking' : ''}`}>
          <Prop kind={prop} fishArt={fishArt} swinging={swinging} />
        </g>
        {broke && (
          <g key={`p${yieldToken}`} class={`ink-payoff ink-payoff--${motion}`}>
            <Prop kind={prop} broken fishArt={fishArt} />
          </g>
        )}

        {/* Ground the figure stands on, and its own contact shadow — drawn
            after the backdrop's own ground/floor so the character always
            reads as standing IN the scene, not pasted over it. Runs the full
            width for a solid resource (mining/chop) so the resource never
            reads as floating past where the line used to stop; stops at the
            bank for fishing, or it would draw a stray stroke across the
            water Prop already painted at this same y. */}
        <path class="ink-ground" d={prop === 'water' ? 'M6 108 H100' : 'M6 108 H196'} />
        <ellipse class="ink-shadow" cx="76" cy="108" rx="23" ry="3.4" />

        {/* The figure. Only the arms/head carry the strike; InkwrightFigure
            itself never animates, so every skill (and combat) can choreograph
            it differently without touching the shared body. */}
        <g class={`ink-fig ink-fig--${motion}${swinging ? ' is-working' : ''}`} key={`f${yieldToken}`}>
          <InkwrightFigure>
            {/* Arm and tool rotate together about the shoulder (84,58), the
                exact joint combat's weapon math is anchored to — this segment
                is deliberately identical to InkwrightCombatStage's own, so a
                redraw of the body behind it never has to re-derive where the
                hand is. */}
            <g class="ink-arm">
              <Limb d="M84 58 L94 62 L100 64" w={11} />
              <Tool kind={motion} />
            </g>
          </InkwrightFigure>
        </g>

        {/* Terminal fishing tackle (line/float/catch) lives in STAGE space,
            not inside the rod's local frame — a line hangs by gravity, it
            does not rotate rigidly with the blank. Its own motion is driven
            off the rod tip's own measured path (inkRigMotion, index.css),
            same technique the review artifact validated. */}
        {prop === 'water' && <FishingRig fishArt={fishArt} broke={broke} swinging={swinging} yieldToken={yieldToken} />}
      </svg>

      {/* What the action produced, popped on the yield. An HTML sibling
          rather than a foreignObject: GameIcon renders its own <svg>, and
          nesting one inside this one through foreignObject buys nothing but
          quirks. */}
      {product && broke && (
        <div key={`y${yieldToken}`} class="ink-yield" aria-hidden="true">
          <GameIcon item={product} size={30} />
        </div>
      )}
    </div>
  )
}

// Tier A backdrops are grouped by SETTING rather than one bespoke scene per
// prop — firemaking's log pile and cooking's skewer both sit at a hearth,
// smithing/crafting/fletching/herblore all work a bench, runecraft and every
// prayer pose read as a small shrine.
const HEARTH_PROPS = new Set(['logpile', 'cookfire'])
const WORKSHOP_PROPS = new Set(['anvil', 'bench', 'shavehorse', 'mortar'])
const SHRINE_PROPS = new Set(['runealtar', 'grave', 'gildedAltar', 'dust'])

/** The scene behind the figure and its prop — a strata'd cave wall for
 * mining, a forest edge for woodcutting, a far bank and water for fishing.
 * Fixed, atmospheric colour (not theme tokens): a cave is dark and a river
 * is blue regardless of whether the surrounding UI chrome is parchment or
 * iron, the same reasoning `--tier-*`/`--potion-*` already rely on elsewhere
 * in this file. Purely decorative — never the thing carrying gameplay state,
 * which is why nothing here reads `swinging`/`broken`. */
function Backdrop({ kind }) {
  if (kind === 'rock') {
    return (
      <g class="ink-scene ink-scene--mine">
        <path class="ink-cave-wall" d="M0 108 L0 74 L22 62 L46 78 L70 58 L92 72 L100 108 Z" />
        <path class="ink-cave-wall ink-cave-wall--near" d="M0 108 L0 90 L28 82 L58 94 L88 84 L100 92 L100 108 Z" />
      </g>
    )
  }
  if (kind === 'tree') {
    return (
      <g class="ink-scene ink-scene--chop">
        <path class="ink-treeline" d="M0 108 L6 84 L12 108 Z" />
        <path class="ink-treeline" d="M14 108 L21 78 L28 108 Z" />
        <path class="ink-treeline" d="M2 96 Q22 88 40 96 Q54 100 78 97 L78 108 L0 108 Z" />
      </g>
    )
  }
  // Backdrop is grouped by SETTING, not one bespoke scene per prop — a
  // hearth is a hearth whether it's cooking food or catching a log pile,
  // same "one shape per economy" the props themselves follow.
  if (HEARTH_PROPS.has(kind)) {
    return (
      <g class="ink-scene ink-scene--hearth">
        <path class="ink-hearth-wall" d="M0 108 L0 60 L34 52 L60 62 L60 108 Z" />
        <path class="ink-hearth-stone" d="M6 108 L6 88 L26 82 L46 90 L46 108 Z" />
      </g>
    )
  }
  if (WORKSHOP_PROPS.has(kind)) {
    return (
      <g class="ink-scene ink-scene--workshop">
        <path class="ink-workshop-wall" d="M0 108 L0 56 L70 56 L70 108 Z" />
        <path class="ink-workshop-shelf" d="M6 74 L46 74 L46 80 L6 80 Z" />
      </g>
    )
  }
  if (SHRINE_PROPS.has(kind)) {
    return (
      <g class="ink-scene ink-scene--shrine">
        <path class="ink-shrine-stone" d="M4 108 L10 66 L18 66 L22 108 Z" />
        <path class="ink-shrine-stone" d="M46 108 L52 70 L58 70 L62 108 Z" />
        <path class="ink-shrine-glow" d="M0 104 Q35 96 70 104 L70 108 L0 108 Z" />
      </g>
    )
  }
  return (
    <g class="ink-scene ink-scene--fish">
      <path class="ink-far-bank" d="M0 88 Q40 84 78 87 L78 96 L0 96 Z" />
      <g class="ink-reed">
        <path d="M14 88 Q13 79 15 73 M18 88 Q18 78 16 72" />
        <path d="M58 87 Q57 78 59 72" />
      </g>
    </g>
  )
}

/** Each shaft passes THROUGH the hand at (100,64) and shows a grip, so the
 * tool reads as held rather than floating alongside the arm — same
 * convention as `weaponShapes.js`'s combat weapons, authored in the tool's
 * own local frame (origin at the hand, +X toward the working end) and
 * placed here by one translate+rotate+scale. The scale exists because this
 * stage's whole canvas is a third the size of the review artifact's — the
 * geometry is the SAME shapes, just fitted to a mobile skilling card
 * instead of a full scene. */
function Tool({ kind }) {
  if (kind === 'chop') {
    return (
      <g transform="translate(100,64) rotate(19) scale(.8)">
        <path class="ink-tool-haft" d="M-22 3 Q-27 5 -25 8 Q-21 10 -17 7 L14 3 L13 -3 L-17 1 Z" />
        <path class="ink-tool-grip" d="M-22 3 Q-27 5 -25 8 Q-21 10 -17 7 L-4 5 L-5 10 L-17 12 Q-24 10 -22 3 Z" />
        {/* Bearded bit: a straight top edge running on from the haft, the
            mass dropping BELOW into a beard — a symmetric flare reads as a
            spade, this asymmetry is what reads as an axe. */}
        <path class="ink-tool-head" d="M12 -13 L28 -15 C33 -8 34 0 32 8 C30 15 24 21 16 23 L12 12 Z" />
        <path class="ink-tool-edge" d="M27 -13 C32 -6 33 1 31 7 C29 13 25 18 19 21" />
        <path class="ink-tool-eye" d="M0 -11 L13 -13 L13 11 L0 9 Z" />
        <path class="ink-tool-wedge" d="M2 -6 L10 -7 M2 3 L10 3.6" />
      </g>
    )
  }
  if (kind === 'fish') {
    return (
      <g transform="translate(100,64) rotate(-10) scale(.4)">
        <path class="ink-tool-grip" d="M-18 -4 Q-22 0 -18 4 L20 3.8 L20 -3.8 Z" />
        <path class="ink-tool-seat" d="M20 -4 L34 -3.4 L34 3.4 L20 4 Z" />
        <g class="ink-rod-reel">
          <circle class="ink-tool-reel" cx="27" cy="13" r="11" />
          <path class="ink-tool-reel-spoke" d="M27 4 L27 22 M18.6 13 L35.4 13 M21 7 L33 19 M33 7 L21 19" />
        </g>
        {/* Three chained segments so the blank bends as a curve, not a stick
            tilting — the single detail the review artifact's fishing plate
            was praised for. Each nested group is its own animated joint
            (index.css: .ink-rod-seg1/2/3). */}
        <path class="ink-tool-blank" d="M34 -3.2 L96 -2.2 L96 2.2 L34 3.2 Z" />
        <g class="ink-rod-seg1">
          <path class="ink-tool-blank" d="M96 -2.2 L150 -1.5 L150 1.5 L96 2.2 Z" />
          <path class="ink-tool-guide" d="M112 -1.9 L110 -8 Q115 -12 120 -8 L118 -1.8" />
          <g class="ink-rod-seg2">
            <path class="ink-tool-blank" d="M150 -1.5 L186 -1 L186 1 L150 1.5 Z" />
            <path class="ink-tool-guide" d="M162 -1.3 L160 -6.4 Q165 -9.8 170 -6.4 L168 -1.2" />
            <g class="ink-rod-seg3">
              <path class="ink-tool-blank" d="M186 -1 L226 -.35 L226 .35 L186 1 Z" />
              <path class="ink-tool-guide" d="M198 -.9 L196 -4.8 Q200.5 -7.6 205 -4.8 L203 -.85" />
              <circle class="ink-tool-tip" cx="228" cy="-2.6" r="2.4" />
            </g>
          </g>
        </g>
      </g>
    )
  }
  if (kind === 'kindle') {
    return (
      <g transform="translate(100,64) rotate(24) scale(.55)">
        <path class="ink-tool-haft" d="M-16 -3 Q-19 0 -16 3 L8 2.4 L8 -2.4 Z" />
        <path class="ink-tool-grip" d="M-16 -3 Q-19 0 -16 3 L-4 2.6 L-4 -2.6 Z" />
        {/* A fire steel's own curved loop, not a bladed head — the small
            radius is what reads as a striker rather than a shrunk axe. */}
        <path class="ink-tool-head" d="M8 -4 C20 -8 30 -3 29 5 C28 12 18 14 9 9 Z" />
        <path class="ink-tool-edge" d="M9 -2 C18 -5 25 -1 24 5" />
      </g>
    )
  }
  if (kind === 'cook') {
    return (
      <g transform="translate(100,64) rotate(15) scale(.5)">
        <path class="ink-tool-haft" d="M-18 -2.4 Q-20 0 -18 2.4 L58 1.6 L58 -1.6 Z" />
        <path class="ink-tool-grip" d="M-18 -2.4 Q-20 0 -18 2.4 L-2 2 L-2 -2 Z" />
        <path class="ink-tool-head" d="M58 -3 L70 -3 L70 3 L58 3 Z" />
        <path class="ink-tool-edge" d="M62 -3 L62 3 M66 -3 L66 3" />
      </g>
    )
  }
  if (kind === 'smith') {
    return (
      <g transform="translate(100,64) rotate(18) scale(.55)">
        <path class="ink-tool-haft" d="M-17 -2.6 Q-19 0 -17 2.6 L58 1.8 L58 -1.8 Z" />
        <path class="ink-tool-grip" d="M-17 -2.6 Q-19 0 -17 2.6 L0 2.2 L0 -2.2 Z" />
        {/* A rectangular block, not a crescent — proportion is what makes
            this read as a hammer rather than a shrunk pick. */}
        <path class="ink-tool-head" d="M50 -14 L78 -14 L78 14 L50 14 Z" />
        <path class="ink-tool-edge" d="M78 -14 L86 -8 L86 8 L78 14" />
        <path class="ink-tool-wedge" d="M50 -6 L78 -6 M50 6 L78 6" />
      </g>
    )
  }
  // Crafting's knife and fletching's knife are the same tool per
  // docs/skill-animations-proposal.md — one shape reads close enough for
  // both, so it doesn't need a second one.
  if (kind === 'craft' || kind === 'fletch') {
    return (
      <g transform="translate(100,64) rotate(12) scale(.55)">
        <path class="ink-tool-haft" d="M-16 -2.6 Q-18 0 -16 2.6 L10 2 L10 -2 Z" />
        <path class="ink-tool-grip" d="M-16 -2.6 Q-18 0 -16 2.6 L-4 2.3 L-4 -2.3 Z" />
        <path class="ink-tool-head" d="M10 -3 L46 -1 L52 0 L46 1 L10 3 Z" />
        <path class="ink-tool-edge" d="M12 2.3 L48 0.6" />
      </g>
    )
  }
  if (kind === 'brew') {
    return (
      <g transform="translate(100,64) rotate(30) scale(.5)">
        <path class="ink-tool-haft" d="M-14 -3 Q-16 0 -14 3 L26 2 L26 -2 Z" />
        <path class="ink-tool-grip" d="M-14 -3 Q-16 0 -14 3 L-2 2.6 L-2 -2.6 Z" />
        {/* The pestle's own blunt, rounded head — a mortar needs crushing
            weight, not an edge. */}
        <path class="ink-tool-head" d="M22 -6 C32 -6 34 6 22 6 Z" />
      </g>
    )
  }
  // Runecraft (weave) and prayer (commune) are bare-handed per the proposal
  // — no tool, just a closed hand at the grip so the arm doesn't read as
  // ending in a stump.
  if (kind === 'weave' || kind === 'commune') {
    return (
      <g transform="translate(100,64)">
        <circle class="ink-skin-fill" cx="0" cy="0" r="4.4" />
      </g>
    )
  }
  return (
    <g transform="translate(100,64) rotate(17) scale(.5)">
      <path class="ink-tool-haft" d="M-19 -3 Q-21 0 -19 3 L100 2.4 L100 -2.4 Z" />
      <path class="ink-tool-grip" d="M-19 -3 Q-21 0 -19 3 L14 2.9 L14 -2.9 Z" />
      <path class="ink-tool-collar" d="M72 -3 L86 -2.85 L86 2.85 L72 3 Z" />
      {/* A crescent crossing the haft, sharp at both points — proportion is
          what makes this read as a pick rather than a spear: taller than it
          is wide, the head running well past the haft on both sides. */}
      <path class="ink-tool-head" d="M84 -31 C101 -25 113 -13 114 0 C115 13 109 24 99 32 C104 20 106 10 104 0 C102 -11 95 -22 84 -31 Z" />
      <path class="ink-tool-edge" d="M86 -28 C101 -22 111.5 -12 112.5 0 C113.5 12 107.5 22 98.5 29" />
      <path class="ink-tool-eye" d="M87 -11 L107 -9.5 L106 8 L86 9 Z" />
      <path class="ink-tool-wedge" d="M93 -6 L101 -5.4 M93 2 L101 2.4" />
    </g>
  )
}

/** Line, float and (once hooked) the real species art — kept in STAGE
 * coordinates, sibling to the rod rather than nested inside its local frame.
 * Two earlier attempts (docs/skilling-plates-review.html) failed for the
 * same underlying reason: a fixed anchor left the line visibly detached
 * from the tip through the swing, and parenting the tackle to the tip made
 * it inherit the rod's own rotation and fly off-stage — a line hangs by
 * gravity, it does not swing rigidly with the blank. `.ink-rig`'s keyframes
 * (index.css) are the rod tip's own measured path instead: damped to a
 * quarter during the idle sway (slack absorbs it), full during the haul
 * (which is what actually lifts the catch clear of the water).
 *
 * The float stays mounted continuously — the catch is a SEPARATE layer on
 * top of it, keyed on `yieldToken` so it remounts (and its one-shot CSS
 * animation replays) on every yield, then fades itself out and holds that
 * state (`animation-fill-mode: forwards`) rather than snapping back to its
 * start pose the instant the payoff clock runs out. A cross-tree selector
 * scoped through `.ink-payoff--fish` looked like it drove this once, but
 * `.ink-catch-rise` isn't a descendant of that element — it's a sibling, in
 * this same STAGE-space group — so it never matched; the animation is
 * self-contained on `.ink-catch-rise` now. */
function FishingRig({ fishArt, broke, swinging, yieldToken }) {
  return (
    <g class={`ink-rig${swinging ? ' is-working' : ''}`}>
      {/* Anchored at the rod tip's own REST position (190,47) — computed from
          the tool's placement transform, not eyeballed, the same discipline
          the review artifact's measured-impact-point probe established. The
          float sits at y=100, well below the water's y=96 surface (x>=118,
          Prop()'s .ink-water) — a float drawn AT the surface line reads as
          floating in the air above the pond, the same trap the old fishing
          rod's own line-length comment was written to avoid. */}
      <path class="ink-rod-line" d="M190 47 Q186 72 178 100" />
      <g class="ink-float-idle">
        <circle class="ink-tool-float" cx="178" cy="100" r="3.6" />
      </g>
      {broke && (
        <g key={yieldToken} class="ink-catch-rise">
          {fishArt
            ? <FishArt art={fishArt} cx={178} cy={98} width={24} className="ink-catch" />
            : <path class="ink-catch ink-catch--fallback" d="M169 98 Q178 92 187 98 Q178 104 169 98 Z" />}
        </g>
      )}
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
// into this stage's frame and recentred on (cx, cy). A CSS animation on the
// OUTER group composes with this positioning transform rather than fighting
// it — same layering as .ink-arm's rotation around a fixed origin.
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

/** The resource. `broken` is the payoff layer — the same silhouette split
 * into pieces that fly, so the whole and the broken form can never drift
 * apart. `swinging` only matters to the idle float, so it can freeze with
 * the figure when the action is stalled (inventory full) rather than keep
 * bobbing. */
function Prop({ kind, broken = false, fishArt = null, swinging = true }) {
  if (kind === 'tree') {
    // Every coordinate here is authored directly at the size this stage
    // actually renders at — NOT scaled down at runtime from a bigger canvas.
    // An earlier version wrapped a much-larger canopy in a single
    // translate/scale "shrink it to fit" transform; the arithmetic checked
    // out on paper (canopy bottom and trunk top landed on the same y), but
    // the RESULT read as a squat blob sitting on a barely-visible stump —
    // proportion has to be judged on the actual render, not derived once
    // and trusted. A proper trunk (50 units, roughly the figure's own
    // torso+leg height) under a canopy clearly wider and taller than it is
    // what makes this read as a standing tree rather than a fallen one.
    return (
      <g>
        {!broken && (
          <g class="ink-faller">
            <path class="ink-canopy" d="M122 18 C100 18 86 30 86 46 C86 58 98 66 116 68 L128 68 C146 66 158 58 158 46 C158 30 144 18 122 18 Z" />
            <path class="ink-canopy-lit" d="M100 36 C95 40 96 47 102 50 C109 53 116 48 115 41 C114 35 106 32 100 36 Z" />
            <path class="ink-canopy-lit" d="M132 24 C125 27 125 35 132 39 C140 42 148 36 146 29 C144 24 137 21 132 24 Z" />
            <path class="ink-bough" d="M116 68 Q108 60 98 54" />
            <path class="ink-bough" d="M128 64 Q138 56 148 51" />
          </g>
        )}
        {/* Trunk + notch — the trunk never moves, the notch STAYS CUT between
            swings so the loop reads as progress, and the fall hinges from
            exactly where the axe has been landing (measured against the
            axe's own reach — src/components/InkwrightStage.jsx's Tool()). */}
        <path class="ink-trunk" d="M113 108 Q110 86 114 60 L124 60 Q128 86 125 108 Z" />
        <g class="ink-notch">
          <path class="ink-notch-face" d="M114 82 L126 88 L114 94 Z" />
          <path class="ink-notch-lit" d="M114 82 L126 88 L116 91 Z" />
        </g>
        {/* The payoff is wood chips flying out of the notch, not the whole
            tree toppling — the same "the resource stays, only fragments
            fly" pattern the rock's own payoff uses (its ink-shard--a/b/c/d
            below). A repeatable action can't end each cycle by felling the
            tree it's about to cut again; a full topple also had to stay
            visibly "down" for most of its own duration to read as a fall at
            all, which is most of a short action's total cycle — exactly
            what made a 2-tick action look like it was chopping a tree that
            was already on the ground. */}
        {broken && (
          <g class="ink-chip ink-chip--a"><path d="M116 84 L123 82 L125 87 L118 89 Z" /></g>
        )}
        {broken && (
          <g class="ink-chip ink-chip--b"><path d="M114 88 L120 87 L121 92 L115 93 Z" /></g>
        )}
        {broken && (
          <g class="ink-chip ink-chip--c"><path d="M118 90 L125 89 L126 94 L119 95 Z" /></g>
        )}
      </g>
    )
  }

  if (kind === 'water') {
    return (
      <g>
        {/* The bank: a ledge the figure stands at the lip of, so the line
            reads as cast OUT and DOWN into the water rather than into a
            puddle at the figure's own feet. */}
        <path class="ink-bank" d="M90 108 L118 96 L102 128 Z" />
        <path class="ink-water" d="M102 128 L118 96 H200 V128 Z" />
        <path class="ink-water-ripple" d="M118 97 Q134 92 150 97 T182 97 T200 97" />
        {/* Idling: the actual species, roaming below the surface. Hidden the
            instant the payoff starts (FishingRig's sibling group takes over),
            so there is never a second fish visible at once. */}
        {!broken && fishArt && (
          <FishArt art={fishArt} cx={158} cy={112} width={22} className={`ink-fish-idle${swinging ? ' is-working' : ''}`} />
        )}
      </g>
    )
  }

  // Firemaking. The pile itself never disappears (only the top logs give
  // way to catch), same "resource stays, fragments change" rule the rock's
  // shards and the tree's chips follow — most actions here have no
  // `product` at all, so the payoff IS the flame catching, not an item pop.
  if (kind === 'logpile') {
    return (
      <g>
        <path class="ink-res" d="M98 108 L98 98 L142 98 L142 108 Z" />
        {/* The top layer sits close to the flint striker's own short reach
            (docs/action-animations.md's measured-arithmetic methodology,
            traced by hand for this tool's shorter-than-a-pickaxe radius) —
            stacked higher than a resting pile would sit on its own. */}
        {!broken && <path class="ink-res" d="M102 98 L102 76 L138 76 L138 98 Z" />}
        {broken && (
          <g class="ink-flame">
            <path class="ink-flame-body" d="M118 100 Q112 88 122 78 Q120 88 128 84 Q134 90 130 100 Q136 92 138 98 Q140 104 132 108 L118 108 Z" />
            <path class="ink-flame-core" d="M122 100 Q120 92 126 86 Q126 94 130 92 Q133 98 128 104 Z" />
          </g>
        )}
      </g>
    )
  }

  // Cooking. The fire is stationary and always lit (a hearth doesn't go out
  // between meals) — only the food over it toggles raw/steaming, same
  // always-there furniture pattern the anvil/mortar/bench below all share.
  if (kind === 'cookfire') {
    return (
      <g>
        <path class="ink-flame-body" d="M110 108 Q104 96 114 86 Q112 96 120 92 Q126 98 122 108 Q128 100 130 106 Q132 108 128 108 Z" />
        <path class="ink-flame-core" d="M114 108 Q112 100 118 94 Q118 102 122 100 Q124 106 120 108 Z" />
        <path class="ink-grate" d="M100 88 L140 88 M106 84 L106 92 M114 84 L114 92 M122 84 L122 92 M130 84 L130 92" />
        {!broken && <path class="ink-res" d="M110 78 Q120 72 130 78 Q128 84 120 85 Q112 84 110 78 Z" />}
        {broken && (
          <>
            <g class="ink-steam ink-steam--a"><path d="M114 76 Q112 68 116 62" /></g>
            <g class="ink-steam ink-steam--b"><path d="M126 76 Q128 68 124 62" /></g>
          </>
        )}
      </g>
    )
  }

  // Smithing. The anvil is the stationary part of the prop, like the tree's
  // trunk or fishing's water — the bar on top is what transforms/breaks.
  if (kind === 'anvil') {
    return (
      <g>
        <path class="ink-anvil-body" d="M92 108 L92 98 L100 92 L150 92 L158 98 L158 108 Z" />
        <path class="ink-anvil-horn" d="M150 92 L172 90 L172 96 L152 98 Z" />
        {!broken && <path class="ink-res" d="M114 84 L140 83 L142 90 L112 91 Z" />}
        {broken && (
          <>
            <g class="ink-spark ink-spark--a"><path d="M120 82 L124 74" /></g>
            <g class="ink-spark ink-spark--b"><path d="M132 80 L136 71" /></g>
            <g class="ink-spark ink-spark--c"><path d="M144 82 L149 75" /></g>
          </>
        )}
      </g>
    )
  }

  // Crafting. A workbench under whatever material is being worked — hide,
  // gem or bar, tinted by the same product-tint trick mining/woodcutting use.
  if (kind === 'bench') {
    // The knife's own short reach (same measured-tip methodology as the
    // logpile above) puts the working surface at chest height, not the
    // low bench a heavier tool like the hammer can reach past.
    return (
      <g>
        <path class="ink-bench-top" d="M96 68 L166 68 L166 72 L96 72 Z" />
        <path class="ink-bench-leg" d="M100 72 L100 108 M162 72 L162 108" />
        {!broken && <path class="ink-res" d="M112 58 Q126 52 142 58 Q140 66 126 67 Q114 66 112 58 Z" />}
        {broken && (
          <>
            <path class="ink-res ink-scrap ink-scrap--a" d="M112 58 L126 55 L124 64 Z" />
            <path class="ink-res ink-scrap ink-scrap--b" d="M126 55 L142 58 L128 64 Z" />
          </>
        )}
      </g>
    )
  }

  // Fletching. A shaving horse (its own low-slung frame, not the flat
  // workbench above) with a log laid across it; the payoff reuses the
  // tree's own wood-chip shapes (`.ink-chip`) — a shaving is a wood chip.
  // Raised to the same chest-height reach as crafting's bench, same knife.
  if (kind === 'shavehorse') {
    return (
      <g>
        <path class="ink-bench-leg" d="M100 108 L112 68 M150 108 L138 68" />
        <path class="ink-bench-top" d="M108 70 L142 70 L142 74 L108 74 Z" />
        {!broken && <path class="ink-res" d="M96 68 L156 66 L156 70 L96 72 Z" />}
        {broken && (
          <>
            <g class="ink-chip ink-chip--a"><path d="M112 66 L119 64 L121 69 L114 71 Z" /></g>
            <g class="ink-chip ink-chip--b"><path d="M128 65 L135 64 L136 69 L129 70 Z" /></g>
          </>
        )}
      </g>
    )
  }

  // Herblore. Ingredients ground in the mortar's bowl; the payoff is the
  // finished vial standing in it, per the proposal's "vial pops" note. The
  // pestle is a short tool too, so the bowl sits on its own raised stand
  // rather than the ground.
  if (kind === 'mortar') {
    return (
      <g>
        <path class="ink-mortar-bowl" d="M100 88 Q98 76 108 72 L146 72 Q156 76 154 88 Z" />
        <path class="ink-bench-leg" d="M108 88 L108 108 M146 88 L146 108" />
        {!broken && <path class="ink-res" d="M112 76 Q127 70 142 76 Q140 82 127 83 Q114 82 112 76 Z" />}
        {broken && (
          <g class="ink-vial">
            <path class="ink-res" d="M122 58 L122 72 Q116 78 118 84 Q127 88 136 84 Q138 78 132 72 L132 58 Z" />
            <path class="ink-vial-neck" d="M122 58 L132 58 L132 54 L122 54 Z" />
          </g>
        )}
      </g>
    )
  }

  // Runecraft. A small stone dais holding the essence mound; the payoff is
  // the essence resolving into the specific rune's own shape/tint.
  if (kind === 'runealtar') {
    return (
      <g>
        <path class="ink-altar-dais" d="M90 108 L90 100 L150 100 L150 108 Z" />
        <path class="ink-altar-rim" d="M96 100 L96 96 L144 96 L144 100 Z" />
        {/* The essence sits close to the raised hands — a channel doesn't
            need contact the way a strike does, but it should still read as
            aimed at something, not gesturing into empty air. */}
        {!broken && <path class="ink-res" d="M104 90 Q116 84 128 90 Q126 96 116 97 Q106 96 104 90 Z" />}
        {broken && (
          <g class="ink-rune-glow">
            <path class="ink-res" d="M116 74 L124 88 L116 96 L108 88 Z" />
          </g>
        )}
      </g>
    )
  }

  // Prayer — bury. The mound of earth never disappears; only the bones on
  // top do, sinking in behind a small scatter of dust (`.ink-dust`, shared
  // with the scatter pose below).
  if (kind === 'grave') {
    return (
      <g>
        <path class="ink-grave-mound" d="M96 108 Q100 96 128 94 Q156 96 160 108 Z" />
        {/* Bones sit close to the body — a bare hand's reach is short, and
            the kneel (inkBodyCommune's own translate, index.css) is what
            carries it down to the mound, not the arm alone. */}
        {!broken && <path class="ink-res" d="M96 96 L104 90 L118 92 L124 98 L110 100 Z" />}
        {broken && (
          <>
            <g class="ink-dust ink-dust--a"><circle cx="120" cy="92" r="1.6" /></g>
            <g class="ink-dust ink-dust--b"><circle cx="132" cy="90" r="1.4" /></g>
            <g class="ink-dust ink-dust--c"><circle cx="126" cy="86" r="1.2" /></g>
          </>
        )}
      </g>
    )
  }

  // Prayer — gilded altar. Bones placed on an ornate golden altar; the
  // payoff is the "hands raised into a golden updraft" beat from the
  // proposal, not an item — the altar grants XP only, like bury.
  if (kind === 'gildedAltar') {
    return (
      <g>
        <path class="ink-gilded-altar" d="M92 108 L92 96 L100 90 L156 90 L164 96 L164 108 Z" />
        <path class="ink-gilded-trim" d="M96 96 L160 96 L160 100 L96 100 Z" />
        {!broken && <path class="ink-res" d="M98 88 L106 82 L122 84 L128 90 L114 92 Z" />}
        {broken && (
          <g class="ink-updraft">
            <path d="M118 86 Q120 70 116 56" />
            <path d="M128 86 Q126 66 132 52" />
            <path d="M138 86 Q142 70 138 58" />
          </g>
        )}
      </g>
    )
  }

  // Prayer — scatter gargoyle dust. No furniture at all: a handful set down
  // ahead of the figure, cast into the same dust-mote payoff the grave uses.
  if (kind === 'dust') {
    return (
      <g>
        {!broken && <path class="ink-res" d="M98 108 Q96 100 108 98 Q120 100 118 108 Z" />}
        {broken && (
          <>
            <g class="ink-dust ink-dust--a"><circle cx="94" cy="94" r="1.6" /></g>
            <g class="ink-dust ink-dust--b"><circle cx="108" cy="88" r="1.4" /></g>
            <g class="ink-dust ink-dust--c"><circle cx="122" cy="92" r="1.5" /></g>
            <g class="ink-dust ink-dust--d"><circle cx="132" cy="100" r="1.2" /></g>
          </>
        )}
      </g>
    )
  }

  // Rock. The whole silhouette (a boulder proud of the wall, not merged into
  // it — the pick lands on stone, not inside the wall it's part of), and the
  // same silhouette split into shard facets for the payoff.
  if (!broken) {
    return (
      <g>
        <path class="ink-res" d="M108 108 Q104 94 112 84 Q121 74 134 72 Q149 70 156 82 Q163 94 158 104 Q153 109 144 108 Z" />
        <path class="ink-facet" d="M124 90 L136 87 L146 93" />
        <path class="ink-facet" d="M124 90 L120 108" />
        <g class="ink-seam">
          <path d="M113 102 Q120 90 130 85 Q140 81 151 82" />
        </g>
      </g>
    )
  }
  return (
    <g>
      <path class="ink-res ink-shard ink-shard--a" d="M108 108 Q104 94 112 84 L124 90 L120 108 Z" />
      <path class="ink-res ink-shard ink-shard--b" d="M112 84 Q121 74 134 72 L136 87 L124 90 Z" />
      <path class="ink-res ink-shard ink-shard--c" d="M134 72 Q149 70 156 82 L146 93 L136 87 Z" />
      <path class="ink-res ink-shard ink-shard--d" d="M124 90 L136 87 L146 93 Q163 94 158 104 Q153 109 144 108 L120 108 Z" />
    </g>
  )
}
