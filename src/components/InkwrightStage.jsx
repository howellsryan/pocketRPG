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
  // Fishing and herblore are the two skills where the "resource" (or its
  // payoff) IS the item — a rock is always a rock, but a shark and a shrimp
  // are different animals, and an attack potion and a prayer potion are
  // different bottles. Both resolve to the same flat colour through
  // getItemIconTint (there is no tier ladder for fish, and a potion's tint is
  // already a full bottle illustration in its own right), so a tinted
  // silhouette could never tell them apart — the real bespoke art has to, the
  // same art the inventory already shows for that item.
  const itemArt = (prop === 'water' || prop === 'mortar') ? bespokeItemArt(product) : null
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
          <Prop kind={prop} itemArt={itemArt} swinging={swinging} />
        </g>
        {broke && (
          <g key={`p${yieldToken}`} class={`ink-payoff ink-payoff--${motion}`}>
            <Prop kind={prop} broken itemArt={itemArt} />
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
        {prop === 'water' && <FishingRig fishArt={itemArt} broke={broke} swinging={swinging} yieldToken={yieldToken} />}
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
  // Firemaking — a tinderbox struck over the pile: a steel striker in the
  // hand, its curved loop the whole silhouette. Short on purpose (the pile
  // is stacked up to meet it, see Prop()) — a long handle would read as
  // another axe.
  if (kind === 'kindle') {
    return (
      <g transform="translate(100,64) rotate(38) scale(.62)">
        <path class="ink-tool-grip" d="M-13 -4 Q-17 0 -13 4 L4 3.4 L4 -3.4 Z" />
        <path class="ink-tool-head" d="M4 -5 C17 -9 27 -3 26 5 C25 13 14 15 5 10 Z" />
        <path class="ink-tool-head" d="M9 -1 C16 -4 21 -1 20.5 3.5 C20 8 13 9 9 6 Z" style={{ fill: 'var(--ink-haft-shade)' }} />
        <path class="ink-tool-edge" d="M6 -3 C16 -6 23 -2 22 4" />
      </g>
    )
  }
  // Cooking — a long two-tine fork for turning what's on the fire. The tines
  // are the read: a solid block on a stick is a spatula, and a spatula over
  // an open flame reads as nothing in particular.
  if (kind === 'cook') {
    return (
      <g transform="translate(100,64) rotate(22) scale(.52)">
        <path class="ink-tool-haft" d="M-20 -2.6 Q-22 0 -20 2.6 L56 1.8 L56 -1.8 Z" />
        <path class="ink-tool-grip" d="M-20 -2.6 Q-22 0 -20 2.6 L-4 2.2 L-4 -2.2 Z" />
        <path class="ink-tool-collar" d="M52 -3.4 L60 -3.2 L60 3.2 L52 3.4 Z" />
        <path class="ink-tool-head" d="M60 -3.2 L76 -6.5 L78 -4.6 L62 -0.9 Z" />
        <path class="ink-tool-head" d="M60 3.2 L76 6.5 L78 4.6 L62 0.9 Z" />
      </g>
    )
  }
  // Smithing — a blacksmith's hammer: a heavy flat face on one side, a
  // tapered cross-peen on the other. The asymmetry is what separates it
  // from a mallet, and the eye + wedge are the same detailing the pickaxe
  // and axe already carry.
  if (kind === 'smith') {
    return (
      <g transform="translate(100,64) rotate(16) scale(.6)">
        <path class="ink-tool-haft" d="M-18 -2.8 Q-20 0 -18 2.8 L54 2 L54 -2 Z" />
        <path class="ink-tool-grip" d="M-18 -2.8 Q-20 0 -18 2.8 L2 2.5 L2 -2.5 Z" />
        <path class="ink-tool-head" d="M40 -13 L62 -13 L62 13 L40 13 Z" />
        <path class="ink-tool-head" d="M62 -10 L76 -5 L76 5 L62 10 Z" />
        <path class="ink-tool-edge" d="M76 -5 L76 5" />
        <path class="ink-tool-eye" d="M45 -9 L57 -9 L57 9 L45 9 Z" />
        <path class="ink-tool-wedge" d="M47 -4 L55 -4 M47 4 L55 4" />
      </g>
    )
  }
  // Crafting and fletching share one knife — a full tang handle, a bolster,
  // and a blade with a straight spine and a curved belly. The bolster is
  // what stops it reading as a bare spike.
  if (kind === 'craft' || kind === 'fletch') {
    return (
      <g transform="translate(100,64) rotate(16) scale(.6)">
        <path class="ink-tool-grip" d="M-17 -4 Q-20 0 -17 4 L6 3.4 L6 -3.4 Z" />
        <path class="ink-tool-wedge" d="M-12 -2 L1 -2 M-12 2 L1 2" />
        <path class="ink-tool-collar" d="M6 -4.4 L11 -4.2 L11 4.2 L6 4.4 Z" />
        <path class="ink-tool-head" d="M11 -4 L42 -3.4 L52 0 L42 3.6 Q26 5.6 11 4 Z" />
        <path class="ink-tool-edge" d="M13 3.2 Q28 4.8 42 2.6" />
      </g>
    )
  }
  // Herblore — a pestle: short, blunt and heavy-ended, because a mortar
  // needs crushing weight rather than an edge.
  if (kind === 'brew') {
    return (
      <g transform="translate(100,64) rotate(58) scale(.58)">
        <path class="ink-tool-haft" d="M-11 -3.4 Q-14 0 -11 3.4 L20 2.6 L20 -2.6 Z" />
        <path class="ink-tool-grip" d="M-11 -3.4 Q-14 0 -11 3.4 L1 3 L1 -3 Z" />
        <path class="ink-tool-head" d="M18 -5.4 Q30 -6 31 0 Q30 6 18 5.4 Z" />
      </g>
    )
  }
  // Prayer (bury) — a spade, and it is the whole reason this pose works. A
  // bare hand reaches ~17px from the shoulder and the ground is 44px below
  // it, so the earlier version sank the entire FIGURE to close the gap and
  // pushed its boots through the ground line. A tool that is long enough to
  // reach the ground is the honest fix, and a spade is also what a player
  // would expect to be burying bones with.
  if (kind === 'bury') {
    return (
      <g transform="translate(100,64) rotate(52) scale(.52)">
        <path class="ink-tool-haft" d="M-22 -3 Q-24 0 -22 3 L66 2.2 L66 -2.2 Z" />
        <path class="ink-tool-grip" d="M-8 -3 L10 -2.8 L10 2.8 L-8 3 Z" />
        {/* D-handle at the butt — the one detail that separates a spade from
            a rake or a broom at this size. */}
        <path class="ink-tool-collar" d="M-22 -3 Q-34 -8 -34 0 Q-34 8 -22 3 Z" />
        <path class="ink-tool-head" d="M66 -11 L84 -11 Q95 -6 95 0 Q95 6 84 11 L66 11 Z" />
        <path class="ink-tool-edge" d="M84 -9 Q93 -5 93 0 Q93 5 84 9" />
        <path class="ink-tool-wedge" d="M70 -6 L70 6" />
      </g>
    )
  }
  // Runecraft, and prayer's altar/scatter poses: bare-handed. A closed fist
  // at the grip so the arm reads as a limb rather than a stroke that stops
  // in mid-air (the same treatment InkwrightFigure gives its back arm).
  if (kind === 'weave' || kind === 'offer' || kind === 'scatter') {
    return (
      <g transform="translate(100,64)">
        <circle class="ink-skin-fill" cx="0" cy="0" r="4.6" />
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
            ? <BespokeItemArt art={fishArt} cx={178} cy={98} width={24} className="ink-catch" />
            : <path class="ink-catch ink-catch--fallback" d="M169 98 Q178 92 187 98 Q178 104 169 98 Z" />}
        </g>
      )}
    </g>
  )
}

// Every raw fish (and every herblore potion) has a bespoke entry, and none
// are `tintable`, so this always comes back as the item's own multi-tone art
// with no tint to apply — unlike ore/logs, whose colour IS the flat tint. A
// potion's bespoke body is a complete bottle illustration (glass + liquid +
// cork) in its own right, same as a fish is a complete animal — nesting
// either inside a second hand-drawn vial/silhouette is what puts two
// different-looking items on screen for the one payoff. Returns null only if
// the data hasn't loaded yet (chunk not ready) or an unmapped item slips
// through, and the caller falls back to a generic shape rather than guess.
export function bespokeItemArt(product) {
  if (!product) return null
  const icon = resolveItemIcon(product, {
    bespoke: typeof bespokeIconsData !== 'undefined' ? bespokeIconsData : null,
    glyphs: typeof gameIconsData !== 'undefined' ? gameIconsData : null,
  })
  if (icon.kind === 'none') return null
  const [vx, vy, vw, vh] = (icon.viewBox || '0 0 512 512').split(/\s+/).map(Number)
  return { body: icon.body, tint: icon.tint, cx: vx + vw / 2, cy: vy + vh / 2, size: Math.max(vw, vh) }
}

// The item's own bespoke art, scaled from its native (typically 512x512)
// viewBox down into this stage's frame and recentred on (cx, cy). A CSS
// animation on the OUTER group composes with this positioning transform
// rather than fighting it — same layering as .ink-arm's rotation around a
// fixed origin.
function BespokeItemArt({ art, cx, cy, width, className }) {
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

/** A cut log seen end-on: the sawn face plus its growth rings. Drawn from a
 * centre and radius rather than as a fixed path so one shape builds a whole
 * stack — and so a log always reads as round, which is the only view of a
 * log that cannot be mistaken for a plank or a crate. */
function LogRound({ cx, cy, r }) {
  return (
    <g>
      <circle class="ink-log-face" cx={cx} cy={cy} r={r} />
      <circle class="ink-log-ring" cx={cx - r * 0.12} cy={cy - r * 0.1} r={r * 0.6} />
      <circle class="ink-log-ring" cx={cx - r * 0.2} cy={cy - r * 0.16} r={r * 0.26} />
    </g>
  )
}

/** A skull and two crossed long bones, centred on (x, y). Prayer's whole
 * readability rests on this: the sockets and the knobbed shaft ends are what
 * separate bones from a pale rock at 20px wide, and both prayer props that
 * take an offering draw the same shape so they cannot drift apart. */
function Bones({ x, y }) {
  return (
    <g class="ink-bones" transform={`translate(${x} ${y})`}>
      {/* Crossbones sit BELOW the skull, jolly-roger fashion. Drawn crossing
          over the skull first, their knobbed ends poked out either side of
          the cranium and read as ears — the layout is the recognition, not
          just the shapes. */}
      <g transform="translate(0 7)">
        <Longbone rotate={26} />
        <Longbone rotate={-26} />
      </g>
      {/* Cranium + jaw as one silhouette, so there is a single outline. */}
      <path class="ink-bone" d="M-9 -2 Q-9 -12 0 -12 Q9 -12 9 -2 Q9 2 6 4 L6 7 Q6 9 3 9 L-3 9 Q-6 9 -6 7 L-6 4 Q-9 2 -9 -2 Z" />
      <ellipse class="ink-bone-socket" cx="-4" cy="-3" rx="2.4" ry="2.7" />
      <ellipse class="ink-bone-socket" cx="4" cy="-3" rx="2.4" ry="2.7" />
      <path class="ink-bone-shade" d="M0 1 l-1.6 2.6 l3.2 0 Z" />
      <path class="ink-bone-shade" d="M-4 6.4 L4 6.4" />
    </g>
  )
}

/** One long bone, knobbed at both ends, drawn along its own axis so the pair
 * above only has to name an angle. */
function Longbone({ rotate }) {
  return (
    <path
      class="ink-bone"
      transform={`rotate(${rotate})`}
      d="M-13 -3.4 Q-16.6 -3.4 -16.6 -1 Q-16.6 1 -14 1.2 Q-16.6 1.8 -16.6 3.6 Q-16.6 6 -13 5.6 Q-10.6 5.2 -10 2.4 L10 2.4 Q10.6 5.2 13 5.6 Q16.6 6 16.6 3.6 Q16.6 1.8 14 1.2 Q16.6 1 16.6 -1 Q16.6 -3.4 13 -3.4 Q10.6 -3.2 10 -0.6 L-10 -0.6 Q-10.6 -3.2 -13 -3.4 Z"
    />
  )
}

/** The resource. `broken` is the payoff layer — the same silhouette split
 * into pieces that fly, so the whole and the broken form can never drift
 * apart. `swinging` only matters to the idle float, so it can freeze with
 * the figure when the action is stalled (inventory full) rather than keep
 * bobbing. */
function Prop({ kind, broken = false, itemArt = null, swinging = true }) {
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
        {!broken && itemArt && (
          <BespokeItemArt art={itemArt} cx={158} cy={112} width={22} className={`ink-fish-idle${swinging ? ' is-working' : ''}`} />
        )}
      </g>
    )
  }

  // Firemaking. Logs drawn END-ON — a stacked pyramid of cut rounds with
  // their growth rings showing — because that is the one view that reads as
  // "logs" and not as a crate. (It was a plain stack of rectangles first,
  // and a rectangle is a box.) The pile never disappears: the top round
  // gives way to the flame, same "resource stays, fragments change" rule the
  // rock's shards and the tree's chips follow. Most firemaking actions have
  // no `product`, so the payoff IS the fire catching, not an item popping.
  if (kind === 'logpile') {
    return (
      <g>
        {/* Two side-on logs behind the stack, for depth. */}
        <path class="ink-log-side" d="M96 104 L150 104 L150 108 L96 108 Z" />
        <LogRound cx={108} cy={98} r={9} />
        <LogRound cx={128} cy={98} r={9} />
        {!broken && <LogRound cx={118} cy={83} r={9} />}
        {broken && (
          <g class="ink-flame">
            <path class="ink-flame-body" d="M110 96 Q104 82 116 68 Q113 82 122 76 Q131 84 126 96 Q134 84 137 92 Q140 100 130 100 L112 100 Z" />
            <path class="ink-flame-core" d="M115 94 Q112 84 119 74 Q118 84 124 80 Q128 88 122 96 Z" />
          </g>
        )}
      </g>
    )
  }

  // Cooking. A campfire under a spit: two forked uprights, a crossbar, and
  // the catch on it. The fish silhouette (body + tail fin) is what makes
  // this read as cooking rather than as a second firemaking stage — an oval
  // on a grate could be anything.
  if (kind === 'cookfire') {
    return (
      <g>
        <path class="ink-log-side" d="M114 100 L154 104 L154 108 L114 106 Z" />
        <path class="ink-log-side" d="M114 106 L154 102 L154 106 L114 108 Z" />
        <path class="ink-flame-body" d="M122 104 Q116 94 128 84 Q125 94 134 90 Q142 96 138 104 Q145 96 148 101 Q150 106 143 106 L124 106 Z" />
        <path class="ink-flame-core" d="M128 102 Q125 94 132 88 Q131 95 137 92 Q140 98 135 102 Z" />
        {/* Spit: forked uprights and the bar the catch turns on. */}
        <path class="ink-spit" d="M112 106 L112 74 M106 68 L112 74 L118 68" />
        <path class="ink-spit" d="M164 106 L164 74 M158 68 L164 74 L170 68" />
        <path class="ink-spit" d="M108 76 L168 76" />
        {!broken && (
          <g class="ink-catch-body">
            {/* Hung UNDER the bar, head forward, forked tail behind — an oval
                laid across the bar read as a bread roll. The tail fork and
                the eye are what name it as a fish at 30px wide. */}
            <path class="ink-res" d="M126 86 Q140 74 158 84 Q140 96 126 86 Z" />
            <path class="ink-res" d="M126 86 L114 79 L117 86 L114 93 Z" />
            <path class="ink-facet" d="M136 80 Q140 86 137 92" />
            <circle class="ink-fish-eye" cx="151" cy="84" r="1.4" />
          </g>
        )}
        {broken && (
          <>
            <g class="ink-steam ink-steam--a"><path d="M128 72 Q124 62 130 54" /></g>
            <g class="ink-steam ink-steam--b"><path d="M148 72 Q152 62 146 54" /></g>
          </>
        )}
      </g>
    )
  }

  // Smithing. A real anvil silhouette — horn, waisted body, splayed foot —
  // because the shape IS the recognition here; a plain trapezoid box read as
  // a crate with a stick on it. The anvil is the stationary half of the prop
  // (like the tree's trunk); the bar on its face is what transforms.
  if (kind === 'anvil') {
    return (
      <g>
        <path class="ink-anvil-body" d="M104 108 L108 100 L120 96 L120 88 L106 84 L106 76 L154 76 L154 84 L140 88 L140 96 L152 100 L156 108 Z" />
        {/* Horn: a taper off the face, not a stub — the single feature that
            says anvil rather than block. */}
        <path class="ink-anvil-horn" d="M154 76 L178 80 Q182 82 178 84 L154 84 Z" />
        <path class="ink-anvil-face" d="M106 76 L154 76 L154 79 L106 79 Z" />
        {!broken && (
          <g>
            <path class="ink-res" d="M114 68 L142 67 L143 74 L113 75 Z" />
            {/* Working heat. Without it the bar is a grey slab and the whole
                scene reads as carpentry — a smith hits metal that is hot. */}
            <path class="ink-hot" d="M126 67.5 L142 67 L143 74 L127 74.5 Z" />
          </g>
        )}
        {broken && (
          <>
            <g class="ink-spark ink-spark--a"><path d="M118 70 L112 60" /></g>
            <g class="ink-spark ink-spark--b"><path d="M128 68 L128 56" /></g>
            <g class="ink-spark ink-spark--c"><path d="M138 70 L146 61" /></g>
          </>
        )}
      </g>
    )
  }

  // Crafting. A hide stretched on the bench — drawn as an actual pelt, with
  // the four leg stubs that are the whole read. A rounded blob on a plank
  // said nothing about leather; the leg stubs say it instantly, at any size.
  if (kind === 'bench') {
    return (
      <g>
        <path class="ink-bench-top" d="M96 74 L172 74 L172 79 L96 79 Z" />
        <path class="ink-bench-leg" d="M102 79 L102 108 M166 79 L166 108 M102 92 L166 92" />
        {!broken && (
          <g>
            {/* A pelt: a broad body with four SHORT corner stubs. The body
                has to stay dominant — cut the notches deep enough for real
                legs and it reads as a star, which is exactly what the first
                two attempts did. */}
            <path class="ink-res" d="M116 57 L125 61 Q140 56 155 61 L164 57 L161 65 Q167 69 161 73 L164 80 L154 75 Q140 80 126 75 L116 80 L119 73 Q113 69 119 65 Z" />
            <path class="ink-facet" d="M126 68 Q140 72 154 68" />
          </g>
        )}
        {broken && (
          <>
            <path class="ink-res ink-scrap ink-scrap--a" d="M122 56 L138 60 L130 70 Z" />
            <path class="ink-res ink-scrap ink-scrap--b" d="M142 58 L160 56 L150 70 Z" />
          </>
        )}
      </g>
    )
  }

  // Fletching. A bow stave clamped on a shaving horse — a curved limb with
  // a nocked tip, being drawn down with the knife. A flat plank on a trestle
  // could have been any woodworking; the recurve is what names the skill.
  if (kind === 'shavehorse') {
    return (
      <g>
        <path class="ink-bench-leg" d="M106 108 L118 82 M162 108 L150 82" />
        <path class="ink-bench-top" d="M110 82 L160 82 L160 87 L110 87 Z" />
        {!broken && (
          <g>
            <path class="ink-stave" d="M106 68 Q134 58 170 70 Q172 71 170 74 Q134 63 107 73 Q104 71 106 68 Z" />
            <path class="ink-facet" d="M110 70 L166 73" />
            {/* Nocks: the tiny notch at each tip that reads as a bow limb. */}
            <path class="ink-stave-nock" d="M106 66 L103 69 M170 68 L173 72" />
            {/* The horse's clamp. Without it the stave floated above the
                bench and the figure read as shaving thin air. */}
            <path class="ink-clamp" d="M128 62 L128 84 M140 62 L140 84" />
            <path class="ink-clamp-jaw" d="M124 60 L144 60 L144 66 L124 66 Z" />
          </g>
        )}
        {broken && (
          <>
            <g class="ink-chip ink-chip--a"><path d="M120 66 L128 63 L130 69 L122 72 Z" /></g>
            <g class="ink-chip ink-chip--b"><path d="M142 65 L150 64 L151 70 L143 71 Z" /></g>
          </>
        )}
      </g>
    )
  }

  // Herblore. A stone mortar on a stand with herb sprigs standing out of it
  // — leaves, not a lump, so the bowl reads as full of something growable.
  // The payoff is the finished potion — the item's own bespoke bottle art,
  // same as fishing's catch-rise, because every potion's bespoke body is
  // already a complete vial illustration. A second, hand-drawn generic vial
  // here (as this used to be) put two differently-styled potions on screen
  // for the one payoff; only an item with no bespoke/glyph art at all falls
  // back to the plain silhouette below.
  if (kind === 'mortar') {
    return (
      <g>
        <path class="ink-mortar-stand" d="M104 108 L112 92 L136 92 L144 108 Z" />
        <path class="ink-mortar-bowl" d="M94 78 L150 78 Q148 94 122 95 Q96 94 94 78 Z" />
        <path class="ink-mortar-rim" d="M92 74 L152 74 L152 79 L92 79 Z" />
        {!broken && (
          <g class="ink-herb">
            <path d="M106 76 Q102 64 110 56" />
            <path class="ink-herb-leaf" d="M110 56 Q104 57 103 63 Q110 63 110 56 Z" />
            <path d="M120 76 Q120 62 128 54" />
            <path class="ink-herb-leaf" d="M128 54 Q121 55 120 61 Q128 61 128 54 Z" />
            <path d="M134 76 Q138 66 134 58" />
            <path class="ink-herb-leaf" d="M134 58 Q140 60 140 66 Q134 65 134 58 Z" />
          </g>
        )}
        {broken && (
          itemArt
            ? <BespokeItemArt art={itemArt} cx={122} cy={64} width={32} className="ink-vial" />
            : (
              <g class="ink-vial">
                <path class="ink-vial-neck" d="M116 48 L128 48 L128 58 L116 58 Z" />
                <path class="ink-vial-cork" d="M115 43 L129 43 L129 49 L115 49 Z" />
                <path class="ink-res" d="M116 56 L128 56 Q140 64 138 74 Q136 84 122 84 Q108 84 106 74 Q104 64 116 56 Z" />
                <path class="ink-vial-shine" d="M114 66 Q112 72 114 78" />
              </g>
            )
        )}
      </g>
    )
  }

  // Runecraft. A standing rune altar — a carved monolith, not a low dais —
  // with the essence held up in front of it. Height is what makes an altar
  // read as a place of power rather than as another workbench.
  if (kind === 'runealtar') {
    return (
      <g>
        <path class="ink-altar-dais" d="M112 108 L118 98 L176 98 L182 108 Z" />
        {/* Two standing stones with a lintel across them, not one rounded
            slab — a single round-topped stone is a headstone, which is the
            last thing this should read as next to prayer's own grave. */}
        <path class="ink-altar-stone" d="M120 98 L120 56 L134 56 L134 98 Z" />
        <path class="ink-altar-stone" d="M160 98 L160 56 L174 56 L174 98 Z" />
        <path class="ink-altar-stone" d="M114 44 L180 44 L180 58 L114 58 Z" />
        <path class="ink-altar-carve" d="M147 66 L158 80 L147 94 L136 80 Z" />
        <path class="ink-altar-carve" d="M147 72 L147 88 M141 80 L153 80" />
        {!broken && (
          <g class="ink-essence">
            <path class="ink-res" d="M108 54 Q116 48 122 55 Q124 62 115 64 Q106 62 108 54 Z" />
            {/* Spark lines — essence is charged, not a pebble in the hand. */}
            <path class="ink-essence-spark" d="M104 46 L107 51 M126 47 L123 52 M115 42 L115 47" />
          </g>
        )}
        {broken && (
          <g class="ink-rune-glow">
            <path class="ink-res" d="M104 44 L126 44 L126 68 L104 68 Z" />
            <path class="ink-rune-mark" d="M110 50 L120 62 M120 50 L110 62 M115 47 L115 65" />
          </g>
        )}
      </g>
    )
  }

  // Prayer — bury. A dug hollow in a mound of earth, with a skull and
  // crossed bones going into it. Bones have to LOOK like bones (a skull with
  // sockets, two knobbed shafts) or the whole act is unreadable — the first
  // version drew a grey polygon and it read as a rock. The spade (Tool's
  // `bury` branch) is what reaches the ground; the figure never sinks.
  if (kind === 'grave') {
    return (
      <g>
        <path class="ink-grave-mound" d="M100 108 Q108 92 138 90 Q168 92 174 108 Z" />
        <path class="ink-grave-hollow" d="M120 96 Q132 88 146 96 Q132 100 120 96 Z" />
        {!broken && <Bones x={140} y={86} />}
        {broken && (
          <>
            <g class="ink-bone-sink"><Bones x={140} y={86} /></g>
            <g class="ink-dust ink-dust--a"><circle cx="126" cy="92" r="2.4" /></g>
            <g class="ink-dust ink-dust--b"><circle cx="140" cy="88" r="2.1" /></g>
            <g class="ink-dust ink-dust--c"><circle cx="152" cy="92" r="2.3" /></g>
          </>
        )}
      </g>
    )
  }

  // Prayer — gilded altar. A stepped plinth under a gold slab, with a lit
  // candle at each end; the bones are laid on top and the offering rises as
  // a golden updraft. Nothing is granted but XP, so there is no item pop.
  if (kind === 'gildedAltar') {
    return (
      <g>
        <path class="ink-gilded-altar" d="M104 108 L110 96 L166 96 L172 108 Z" />
        <path class="ink-gilded-altar" d="M108 96 L108 84 L168 84 L168 96 Z" />
        <path class="ink-gilded-trim" d="M104 80 L172 80 L172 86 L104 86 Z" />
        <path class="ink-gilded-trim" d="M112 90 L164 90 L164 93 L112 93 Z" />
        {/* Candles — the detail that separates a gilded altar from a bench. */}
        <path class="ink-candle" d="M114 80 L114 70 L119 70 L119 80 Z M157 80 L157 70 L162 70 L162 80 Z" />
        <path class="ink-flame-core" d="M116.5 64 Q113 68 116.5 70 Q120 68 116.5 64 Z M159.5 64 Q156 68 159.5 70 Q163 68 159.5 64 Z" />
        {!broken && <Bones x={138} y={74} />}
        {broken && (
          <>
            <g class="ink-bone-rise"><Bones x={138} y={74} /></g>
            <g class="ink-updraft">
              <path d="M124 76 Q128 58 122 42" />
              <path d="M138 76 Q134 54 142 36" />
              <path d="M152 76 Q158 58 152 44" />
            </g>
          </>
        )}
      </g>
    )
  }

  // Prayer — scatter gargoyle dust. No furniture: an open urn set down at
  // the figure's feet, and the dust thrown forward in an arc. The urn is
  // what tells the player where the dust is coming from.
  if (kind === 'dust') {
    return (
      <g>
        <path class="ink-urn" d="M104 108 L102 96 Q102 88 114 88 Q126 88 126 96 L124 108 Z" />
        <path class="ink-urn-mouth" d="M100 84 L128 84 L128 90 L100 90 Z" />
        {!broken && (
          <>
            <path class="ink-res" d="M104 84 Q114 78 124 84 Z" />
            {/* Dust leaving the hand on every throw, not only on the yield.
                Gated on the payoff alone, the rest of the loop was a figure
                gesturing at a pot with nothing coming out of it. */}
            <g class={`ink-cast${swinging ? ' is-working' : ''}`}>
              <circle cx="132" cy="72" r="1.7" />
              <circle cx="146" cy="64" r="1.4" />
              <circle cx="158" cy="62" r="1.6" />
              <circle cx="170" cy="66" r="1.2" />
            </g>
          </>
        )}
        {broken && (
          <>
            <g class="ink-dust ink-dust--a"><circle cx="118" cy="76" r="2.6" /></g>
            <g class="ink-dust ink-dust--b"><circle cx="134" cy="66" r="2.2" /></g>
            <g class="ink-dust ink-dust--c"><circle cx="150" cy="62" r="2.5" /></g>
            <g class="ink-dust ink-dust--d"><circle cx="166" cy="66" r="2" /></g>
          </>
        )}
      </g>
    )
  }

  // Rock. The whole silhouette (a boulder proud of the wall, not merged into
  // it — the pick lands on stone, not inside the wall it's part of), and the
  // same silhouette split into shard facets for the payoff. Named explicitly
  // rather than left as the fallthrough: an unmatched prop silently drawing a
  // boulder is how a new skill ends up mining its anvil.
  if (kind === 'rock') {
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

  return null
}
