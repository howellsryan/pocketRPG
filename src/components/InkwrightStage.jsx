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
 *   subject    — the item being WORKED ON (consumed), for the tint and, on a
 *                prop that shows it, its own art: the plank a build eats, the
 *                amulet under an enchantment, the item being alchemised, the
 *                charm going into a pouch. Three skills need this because
 *                none takes its whole read from a product — construction has
 *                none at all, magic's subject matter IS the thing on the
 *                pedestal, and a summoning is only legible as the charm it
 *                is infusing (every pouch craft otherwise looks identical).
 *   yieldToken — completed-action count; a change replays the payoff
 *   paused     — true when the action is stalled (inventory full), freezing the figure
 *   label      — accessible description
 */
export default function InkwrightStage({ plan, product = null, subject = null, yieldToken = 0, paused = false, label = null }) {
  if (!plan) return null

  const { motion, prop, strikePeriodMs, payoffMs } = plan
  const swinging = !paused
  // The resource takes its colour from the item it yields, through the same
  // resolver the inventory uses — so copper reads copper and mithril blue
  // without this component knowing a single ore exists.
  const tint = ((product || subject) && getItemIconTint(product || subject)) || 'var(--text-soft)'
  // Two props are the item rather than merely coloured by it. Fishing was the
  // first: a rock is always a rock, but a shark and a shrimp are different
  // animals, and every raw fish resolves to the same flat colour through
  // getItemIconTint (there is no tier ladder for fish), so a tinted
  // silhouette could never tell them apart — the real bespoke art has to.
  // Magic's pedestal is the same problem in a different skill: what is on it
  // IS the spell's subject matter, and an amulet, an ore and a cowhide are
  // only distinguishable as themselves.
  const itemArt = prop === 'water'
    ? bespokeItemArt(product)
    : (SUBJECT_ART_PROPS.has(prop) ? bespokeItemArt(subject) : null)
  // Nothing has given way until an action has actually completed. Rendering
  // the payoff at mount shattered the rock the instant the screen opened,
  // and popped a reward for an action nobody had finished.
  const broke = yieldToken > 0
  // Construction's one structural difference from every other prop: the
  // workpiece is not consumed and respawned, it GAINS a part per completed
  // action and starts a fresh frame once it is finished (BUILD_STAGES parts,
  // one plank each). `built` is which part was added last, so the payoff can
  // settle exactly that piece into place.
  const built = yieldToken % BUILD_STAGES

  return (
    <div
      class={`ink-stage ink-stage--${motion}`}
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
          <Prop kind={prop} itemArt={itemArt} swinging={swinging} built={built} />
        </g>
        {broke && (
          <g key={`p${yieldToken}`} class={`ink-payoff ink-payoff--${motion}`}>
            <Prop kind={prop} broken itemArt={itemArt} built={built} />
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

        {/* The spell leaving the staff. STAGE space, like the fishing tackle
            and for the same reason: it is launched by the arm but not carried
            by it — once it is away it belongs to the room, not to the hand.
            Drawn at the muzzle's own RELEASE position (124,52 — the orb's
            place once the arm has swung through to +6deg) so the flight
            keyframe starts from where the orb actually is at the frame it
            appears on, rather than being translated into place first. */}
        <SpellBolt motion={motion} prop={prop} swinging={swinging} />
        {motion === 'enchant' && <ChannelStream swinging={swinging} />}

        {/* The trapper's trigger line, and the spirit light leaving the
            summoner's palm. Both are STAGE space for the same reason the
            fishing tackle and the spell bolt are: one end is anchored to
            something that is not the hand. */}
        {motion === 'snare' && <SnareLine swinging={swinging} />}
        {motion === 'infuse' && <SpiritStream swinging={swinging} />}
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
const WORKSHOP_PROPS = new Set(['anvil', 'bench', 'shavehorse', 'mortar', 'scaffold'])
const SHRINE_PROPS = new Set(['runealtar', 'grave', 'gildedAltar', 'dust'])
// Tier G — magic works in a sanctum, which is deliberately NOT the shrine
// runecraft and prayer share: a rune altar is a place you bring essence TO,
// a sanctum is a room you work in. Sharing the scene would have made every
// caster look like they were runecrafting.
const SANCTUM_PROPS = new Set(['alchPedestal', 'smeltPedestal', 'transmutePedestal', 'enchantPedestal', 'hexDummy'])
// Tier D — hunter works a game trail, outdoors and unbuilt. The woodcutting
// treeline was the obvious thing to reuse and is deliberately not: a felling
// site is a place with a tree in it, a trapline is undergrowth you are hiding
// in, and the two skills would have read as each other.
const WILD_PROPS = new Set(['snareBeast', 'snareMark'])
// Tier C — thieving happens in a street, in front of the shopfronts the marks
// belong to. Its own scene rather than the workshop wall for the same reason:
// a thief in a workshop is a crafter.
const STREET_PROPS = new Set(['mark', 'markGuard', 'stall'])
// Tier F — summoning is worked outdoors at a standing obelisk, at dusk. Not
// the sanctum: a spellbook spell is cast in a room you own, a familiar is
// bound at a place that was already there.
const GLADE_PROPS = new Set(['obelisk'])
// The props that stand the spell's SUBJECT on a plinth and draw its real art
// (see InkwrightStage's `subject`). The dummy is the one magic prop that
// doesn't: a curse is cast at something, not on something.
const PEDESTAL_PROPS = new Set(['alchPedestal', 'smeltPedestal', 'transmutePedestal', 'enchantPedestal'])
// Every prop that stands the `subject` up and draws its REAL art rather than a
// tinted stand-in. The obelisk joins magic's four for the same reason they
// exist: a gold charm and a blue charm are the same silhouette, and which one
// is being infused is the only thing telling two pouch crafts apart.
const SUBJECT_ART_PROPS = new Set([...PEDESTAL_PROPS, 'obelisk'])
// Which colour the spell leaves the staff in. A school, not a tint: this is
// the one thing telling a superheat from a transmutation at a glance, since
// both are a caster pointing a staff at an item on a plinth.
const SPELL_SCHOOL = {
  alchPedestal: 'gold',
  smeltPedestal: 'fire',
  transmutePedestal: 'nature',
  enchantPedestal: 'arcane',
  hexDummy: 'arcane',
}
// How many planks make one piece of furniture before the next frame goes up.
// Four: a frame, a seat, its posts, its back — any fewer and the piece never
// looks finished, any more and a short session never sees one completed.
const BUILD_STAGES = 4

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
  if (SANCTUM_PROPS.has(kind)) {
    return (
      <g class="ink-scene ink-scene--sanctum">
        <path class="ink-sanctum-wall" d="M0 108 L0 40 L66 40 L66 108 Z" />
        {/* A pointed arch with a mullion. The POINT is the whole read — a
            square opening in a wall is a window in any building, an arch is
            a tower. */}
        <path class="ink-sanctum-glass" d="M18 92 L18 62 Q32 44 46 62 L46 92 Z" />
        <path class="ink-sanctum-mullion" d="M32 48 L32 92 M18 74 L46 74" />
        <path class="ink-sanctum-arch" d="M18 92 L18 62 Q32 44 46 62 L46 92" />
        <path class="ink-sanctum-shelf" d="M4 96 L14 96 L14 108 L4 108 Z" />
      </g>
    )
  }
  // A game trail through undergrowth: bracken in the near ground, two trunks
  // running off the top of the frame behind it. The trunks are CROPPED rather
  // than drawn whole — a complete little tree reads as woodcutting's felling
  // site, a trunk with no top reads as being in among them.
  if (WILD_PROPS.has(kind)) {
    return (
      <g class="ink-scene ink-scene--wild">
        <path class="ink-wild-trunk" d="M12 108 L10 0 L24 0 L22 108 Z" />
        <path class="ink-wild-trunk" d="M44 96 L42 12 L51 12 L50 96 Z" />
        <g class="ink-bracken">
          <path d="M4 104 Q2 92 10 84 M10 84 Q4 86 3 93 M10 84 Q16 87 16 93" />
          <path d="M28 104 Q28 92 34 85 M34 85 Q28 87 27 93" />
          <path d="M58 104 Q60 94 54 86 M54 86 Q60 88 61 94" />
        </g>
      </g>
    )
  }
  // A street: a plastered shopfront with a shuttered window and a bracket
  // sign. Kept behind the figures and low-contrast — the scene has two people
  // standing in it, and anything busier fights them.
  if (STREET_PROPS.has(kind)) {
    return (
      <g class="ink-scene ink-scene--street">
        <path class="ink-street-wall" d="M0 108 L0 20 L72 20 L72 108 Z" />
        <path class="ink-street-window" d="M12 40 L44 40 L44 68 L12 68 Z" />
        <path class="ink-street-shutter" d="M12 40 L12 68 M22 40 L22 68 M34 40 L34 68 M44 40 L44 68 M12 54 L44 54" />
        <path class="ink-street-sign" d="M56 28 L56 44 M56 30 L68 30" />
        <path class="ink-street-sign-board" d="M60 32 L74 32 L74 44 L60 44 Z" />
        <path class="ink-street-cobble" d="M4 104 L18 104 M24 104 L36 104 M42 104 L54 104" />
      </g>
    )
  }
  // A hillside at dusk, with the first stars out. Flat bands rather than a
  // gradient (the one rule this file's palette does not bend): a dark ridge
  // under a lighter sky is all the depth a 128px frame needs.
  if (GLADE_PROPS.has(kind)) {
    return (
      <g class="ink-scene ink-scene--glade">
        <path class="ink-glade-ridge" d="M0 108 L0 88 Q30 78 62 85 Q92 91 122 86 L122 108 Z" />
        {/* Points, not plus signs. Drawn as two crossed strokes they read as
            literal "+" characters printed on the sky. */}
        <g class="ink-glade-star">
          <circle cx="22" cy="34" r="1.5" />
          <circle cx="56" cy="20" r="1.9" />
          <circle cx="96" cy="42" r="1.3" />
          <circle cx="38" cy="14" r="1.2" />
        </g>
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
  // Construction — a claw hammer, and it is drawn the way a claw hammer
  // actually is: the head crosses the haft, striking face on one side and a
  // curved fork on the other. Smithing's cross-peen runs ALONG its haft
  // instead, which is what keeps the two hammers this game now draws from
  // reading as the same tool. The face's own local contact point (54,14) is
  // what the placement below is solved for — at the impact frame (arm -6deg,
  // inkArmBuild) it lands on (133.8,73.5), the top edge of the workpiece's
  // apron rail (Prop's `scaffold`). Reach from the shoulder is fixed by the scale
  // alone, so the scale, that rail and the impact angle move together or the
  // hammer misses the wood.
  if (kind === 'build') {
    return (
      <g transform="translate(100,64) rotate(10) scale(.63)">
        {/* Haft first and stopping short: it passes BEHIND the head, which is
            what a hammer's eye actually does and what keeps the head reading
            as one solid object rather than a block with a window in it. */}
        <path class="ink-tool-haft" d="M-18 -2.8 Q-20 0 -18 2.8 L54 2.4 L54 -2.4 Z" />
        <path class="ink-tool-grip" d="M-18 -2.8 Q-20 0 -18 2.8 L4 2.6 L4 -2.6 Z" />
        <path class="ink-tool-wedge" d="M-13 -1.8 L-2 -1.8 M-13 1.8 L-2 1.8" />
        {/* Claw first, so its root passes behind the head. Small and hooked,
            not long and sweeping: drawn big it stops being a claw and becomes
            a crescent, which at this size is a PICKAXE — the one silhouette
            in this file it must not be mistaken for. */}
        <path class="ink-tool-head" d="M45 -11 C41 -18 34 -22 28 -21 C25 -19.5 24.5 -16 26 -13 C29.5 -15 33 -14 37 -11 C41 -8 43.5 -5 45 -2 Z" />
        <path class="ink-tool-claw-slot" d="M30 -17 C34 -15 38 -12 41.5 -8" />
        {/* The head: one capsule ACROSS the haft, domed at the striking end.
            The crossing is the whole difference between this and every other
            tool the figure holds, and the dome is what separates a hammer
            from a mallet. */}
        <path class="ink-tool-head" d="M44 -11 L64 -11 L64 11 Q54 16 44 11 Z" />
        <path class="ink-tool-edge" d="M46.5 12.6 Q54 15.6 61.5 12.6" />
        <path class="ink-tool-edge" d="M47 -8 L47 9" />
      </g>
    )
  }
  // Magic — one staff for all three casting motions, drawn from the same
  // profile combat's own `staff` uses (weaponShapes.js): a quarterstaff with
  // a three-pronged claw CRADLING the orb, claws before the orb so their
  // tips pass behind it. One character with one kit is the whole point of
  // the shared figure, and a caster who swaps staves between the fight
  // screen and the spellbook screen would break it.
  //
  // The orb sits at local (52,0); at this placement that is 28.6 units from
  // the grip along -34deg, and the bolt's own launch point (SpellBolt) is
  // where that lands once the arm has swung through to its release angle.
  if (kind === 'cast' || kind === 'hex' || kind === 'enchant') {
    return (
      <g transform="translate(100,64) rotate(-34) scale(.55)">
        <path class="ink-tool-haft" d="M-34 -3.2 L36 -3.8 L36 3.8 L-34 3.2 Z" />
        <path class="ink-tool-collar" d="M-37 -4.2 L-31 -4.4 L-31 4.4 L-37 4.2 Z" />
        <path class="ink-tool-grip" d="M-26 -4.6 L-13 -4.8 L-13 4.8 L-26 4.6 Z" />
        <path class="ink-tool-wedge" d="M-4 -3.6 L-4 3.6 M8 -3.5 L8 3.5" />
        <path class="ink-tool-collar" d="M30 -5.6 L36 -5.8 L36 5.8 L30 5.6 Z" />
        <path class="ink-staff-claw" d="M36 -3 C44 -12 53 -15 60 -10" />
        <path class="ink-staff-claw" d="M36 3 C44 12 53 15 60 10" />
        <path class="ink-staff-claw" d="M38 0 C46 -1 54 -3 59 -7" />
        <path class="ink-staff-claw-lit" d="M36 -3 C44 -12 53 -15 60 -10" />
        <path class="ink-staff-claw-lit" d="M36 3 C44 12 53 15 60 10" />
        <path class="ink-staff-claw-lit" d="M38 0 C46 -1 54 -3 59 -7" />
        <circle class="ink-tool-orb" cx="52" cy="0" r="9.6" />
        <circle class="ink-tool-orb-core" cx="49" cy="-3" r="3.6" />
      </g>
    )
  }
  // Hunter — a coil of trigger cord, gripped in a closed fist. The whole
  // tool is the fist plus three wraps of line around it: the working end of
  // this "tool" is not in the hand at all, it is the stake 50 units away
  // (SnareLine, drawn in stage space), so anything longer here would read as
  // a second, unrelated implement.
  if (kind === 'snare') {
    return (
      <g transform="translate(100,64)">
        <circle class="ink-skin-fill" cx="0" cy="0" r="4.8" />
        <path class="ink-cord" d="M-5 -3 Q0 -6 5 -3 M-5.4 0 Q0 -3 5.4 0 M-5 3 Q0 0 5 3" />
        {/* The spare coil, hanging off the back of the fist. */}
        <ellipse class="ink-cord-coil" cx="-7" cy="4" rx="4.4" ry="3" />
      </g>
    )
  }
  // Thieving — no tool at all: the reach IS the tool. This draws the FOREARM
  // and an open hand continuing on from the figure's own upper arm, which is
  // what buys the reach a pickpocket needs: the fingertip sits at local
  // (22,3), i.e. 39.2 units from the shoulder once the grip offset (16,6) and
  // this group's own rotation are composed. That radius is fixed by rotation,
  // so it is what the mark's purse (112,88) and the stall's cash box are
  // placed ON — move one and the other three numbers move with it.
  if (kind === 'pickpocket') {
    return (
      <g transform="translate(100,64) rotate(20)">
        <path class="ink-skin" d="M-1 -4.4 L13 -3 Q18 -2.6 18 0 Q18 2.6 13 3 L-1 4.4 Z" />
        {/* The hand: a palm and three fingers reaching on past it. A closed
            fist here read as a punch — an open, leading hand is the whole
            difference between reaching into a pocket and hitting someone. */}
        <path class="ink-skin-fill" d="M15 -3.6 Q21 -4.4 22.6 -1.6 Q23.4 0.4 22 2.4 Q19 4.6 15 3.8 Z" />
        <path class="ink-finger" d="M20 -2.6 L25.6 -3.6 M21 0.2 L26.4 0.2 M20.4 2.8 L25 3.8" />
      </g>
    )
  }
  // Summoning — an open palm turned toward the rite, fingers fanned. The
  // proposal asked for a two-hand charge and this is deliberately one: the
  // rig's back arm hangs on the far side of the torso and cannot be brought
  // round to the front without inverting its elbow (enchanting settled the
  // same question the same way), and a visibly broken shoulder costs more
  // than the second hand buys.
  if (kind === 'infuse') {
    return (
      <g transform="translate(100,64) rotate(-8)">
        <path class="ink-skin" d="M-3 -6 Q5 -8.4 10 -4.6 Q13.4 -1 10.6 3 Q6 7.6 -3 5.6 Z" />
        <path class="ink-finger" d="M9 -5 L16.6 -7.6 M11.4 -1.4 L19.4 -1.8 M10.4 2.6 L17.4 5" />
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
            ? <ItemArt art={fishArt} cx={178} cy={98} width={24} className="ink-catch" />
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

// The fish's own art, scaled from its native (typically 512x512) viewBox down
// into this stage's frame and recentred on (cx, cy). A CSS animation on the
// OUTER group composes with this positioning transform rather than fighting
// it — same layering as .ink-arm's rotation around a fixed origin.
function ItemArt({ art, cx, cy, width, className }) {
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


/** The plinth all three pedestal spells work over — a base, a waisted
 * column and a cap slab wide enough to stand something on. Drawn once and
 * shared rather than per spell, so the three can never drift into looking
 * like three different rooms; it reuses prayer/runecraft's own stone classes
 * for the same reason a bench is a bench in every workshop scene. Its top
 * surface is y=66, which is what the subject art's 26-unit box is centred
 * against (158,52). */
function Pedestal() {
  return (
    <g>
      {/* Stepped base, tapered shaft, capital — a plinth, in that order.
          Drawn as a waisted body with a wide top it read as an ANVIL, which
          is the one thing on this stage a caster must not appear to be
          working at (smithing already has one, two screens away). */}
      <path class="ink-plinth-base" d="M134 108 L134 101 L182 101 L182 108 Z" />
      <path class="ink-plinth-base" d="M139 101 L139 95 L177 95 L177 101 Z" />
      <path class="ink-plinth-shaft" d="M147 95 L149 72 L167 72 L169 95 Z" />
      <path class="ink-plinth-flute" d="M153 92 L154.5 75 M163 92 L161.5 75" />
      <path class="ink-plinth-cap" d="M141 66 L175 66 L175 72 L141 72 Z" />
      <path class="ink-plinth-cap" d="M144 62 L172 62 L172 66 L144 66 Z" />
    </g>
  )
}

/** What stands on the plinth when the item's own art hasn't resolved (the
 * game chunk not loaded yet, or an unmapped id) — a plain tinted ingot in
 * the colour the item would have had, rather than an empty pedestal that
 * reads as a spell being cast at nothing. */
function Ingot() {
  return (
    <g>
      <path class="ink-res" d="M147 42 L169 42 L173 58 L143 58 Z" />
      <path class="ink-facet" d="M150 49 L166 49" />
    </g>
  )
}

/** The spell in flight, from the staff's orb to whatever is being cast at.
 * A STAGE-space sibling of the figure, exactly like the fishing tackle and
 * for the same reason: it is launched by the arm but not carried by it.
 *
 * Both cast targets sit on the same spot (the pedestal's subject at (158,53),
 * the dummy's painted mark at (158,70)) so one flight path serves both — a
 * second path would be two things to keep in agreement for no visible gain.
 * The bolt is drawn at the muzzle's RELEASE position, not its rest position:
 * the orb has already swung through to (124,52) by the frame the bolt first
 * appears on, so a bolt drawn at rest would have to be translated into place
 * before it could fly, and that correction is exactly the kind of thing that
 * silently stops matching the arm when a keyframe is retuned. */
function SpellBolt({ motion, prop, swinging }) {
  if (motion !== 'cast' && motion !== 'hex') return null
  const school = SPELL_SCHOOL[prop] || 'arcane'
  return (
    <g class={`ink-bolt ink-bolt--${school} ink-bolt--${motion}${swinging ? ' is-working' : ''}`}>
      <path class="ink-bolt-trail" d="M108 49 Q116 50 124 52" />
      <circle class="ink-bolt-halo" cx="124" cy="52" r="7" />
      <circle class="ink-bolt-core" cx="124" cy="52" r="3.4" />
    </g>
  )
}

/** Enchanting's channel: light running off the raised staff and down into
 * the item, three motes on staggered delays so the stream reads as
 * continuous rather than as one repeating dot. Its own sibling group for the
 * same reason the bolt is one — and separate from the bolt because a channel
 * is not a projectile: it never leaves, it pours. */
function ChannelStream({ swinging }) {
  return (
    <g class={`ink-channel${swinging ? ' is-working' : ''}`}>
      <circle class="ink-channel-mote ink-channel-mote--a" cx="110" cy="28" r="2.6" />
      <circle class="ink-channel-mote ink-channel-mote--b" cx="110" cy="28" r="2.1" />
      <circle class="ink-channel-mote ink-channel-mote--c" cx="110" cy="28" r="2.4" />
    </g>
  )
}

/** The trapper's trigger line, hand to stake, in STAGE space — one end is
 * tied to the ground, so it cannot live in the tool's rotating local frame
 * (the fishing tackle's own lesson, arrived at from the opposite direction:
 * there the far end was free and the near end was the problem).
 *
 * It is a stiff, taut cord, so it does not sway: what it does is turn about
 * the stake as the trapper hauls. The angle is measured rather than picked —
 * the hand at (100,66) is 47.4 units from the stake at (143,86), the pull
 * (inkArmSnare, -2deg to -14deg) moves it about 3.6 units, and 3.6/47.4 is
 * 4.4 degrees. Retune the pull and this follows it. */
function SnareLine({ swinging }) {
  return (
    <g class={`ink-snare-line${swinging ? ' is-working' : ''}`}>
      <path class="ink-cord" d="M100 66 Q122 79 143 86" />
    </g>
  )
}

/** Spirit light leaving the summoner's palm for the charm on the plate.
 * Three motes on staggered delays, exactly like the enchantment's channel and
 * for the same reason — one dot going round again reads as a repeating dot,
 * not as a stream. Its own component rather than ChannelStream's because the
 * path is different at both ends: this one starts at a raised open hand
 * (99,51) and lands on (134,58), not on magic's pedestal. */
function SpiritStream({ swinging }) {
  return (
    <g class={`ink-spirit-stream${swinging ? ' is-working' : ''}`}>
      {/* A thread of light under the motes: three dots alone read as bubbles,
          the thread is what makes it a channel going somewhere. */}
      <path class="ink-spirit-beam" d="M103 51 Q122 53 140 57" />
      <circle class="ink-spirit-flow ink-spirit-flow--a" cx="103" cy="51" r="3" />
      <circle class="ink-spirit-flow ink-spirit-flow--b" cx="103" cy="51" r="2.4" />
      <circle class="ink-spirit-flow ink-spirit-flow--c" cx="103" cy="51" r="2.7" />
    </g>
  )
}

/** The familiar taking shape out of the charm — summoning's payoff, and the
 * answer to the coverage proposal's open question 3. A creature silhouette
 * rather than the product's ordinary icon, because the icon already pops
 * (ink-yield) and the thing worth SHOWING here is that something was
 * summoned; one generic spirit serves every creature, since what comes out of
 * a pouch on the bench is a wisp, not the beast itself. */
function Wisp() {
  return (
    <g class="ink-wisp">
      <path class="ink-wisp-body" d="M134 53 Q134 43 142 43 Q150 43 150 53 Q150 61 142 62 Q134 61 134 53 Z" />
      <path class="ink-wisp-ear" d="M135 46 L131 37 L140 43 Z" />
      <path class="ink-wisp-ear" d="M149 46 L153 37 L144 43 Z" />
      <path class="ink-wisp-tail" d="M142 62 Q136 71 141 79 Q145 85 139 91" />
      <circle class="ink-wisp-eye" cx="138.4" cy="52" r="1.9" />
      <circle class="ink-wisp-eye" cx="145.6" cy="52" r="1.9" />
    </g>
  )
}

/** What floats over the obelisk when the charm's own art hasn't resolved
 * (chunk not loaded, or an unmapped id) — a drawstring pouch in the product's
 * tint, rather than an empty rite. Magic's `Ingot` for the same reason. */
function Pouch() {
  return (
    <g>
      <path class="ink-res" d="M131 54 Q142 44 153 54 Q157 66 142 69 Q127 66 131 54 Z" />
      <path class="ink-facet" d="M133 56 Q142 61 151 56" />
    </g>
  )
}

/** Three leaves at the sapling's tip. Without them a bent brown pole is a
 * shepherd's crook and a straight one is a fence post — the leaves are the
 * only thing saying the trap is powered by a living, springy tree. Drawn at
 * whichever end is currently the tip: `flip` points them back down the bend
 * for the armed pose, up for the sprung one. */
function SaplingLeaves({ x, y, flip = false }) {
  return (
    <g class="ink-sapling-leaf" transform={`translate(${x} ${y})${flip ? ' scale(-1,1)' : ''}`}>
      <path d="M0 0 Q5 -7 12 -5 Q7 2 0 0 Z" />
      <path d="M0 0 Q2 -9 9 -11 Q8 -3 0 0 Z" />
      <path d="M0 0 Q-2 -8 3 -13 Q6 -6 0 0 Z" />
    </g>
  )
}

/** Hunter's quarry, on four legs — head lowered to the bait, ears up, tail
 * flicked. Drawn in its own local frame with the feet on y=0 and facing LEFT
 * (the trap is downhill of it), so the two quarries can share one placement
 * transform and one creep keyframe. Small on purpose: it is further down the
 * trail than the trapper, and a beast drawn at the hero's own scale would
 * read as standing beside him rather than being stalked. */
function QuarryBeast() {
  return (
    <g class="ink-quarry-art">
      <path class="ink-quarry-body" d="M-14 -21 Q-2 -26 10 -22 Q16 -20 15 -13 Q14 -7 7 -6 L-8 -7 Q-17 -11 -14 -21 Z" />
      <path class="ink-quarry-body" d="M-12 -20 Q-20 -18 -24 -10 L-18 -6 Q-15 -13 -8 -15 Z" />
      <path class="ink-quarry-body" d="M-26 -11 Q-31 -10 -30 -5 Q-29 -2 -24 -3 L-18 -5 L-19 -10 Z" />
      <path class="ink-quarry-ear" d="M-15 -22 L-18 -29 L-10 -24 Z" />
      <path class="ink-quarry-leg" d="M-8 -7 L-9 0 M-1 -6 L-1 0 M7 -7 L7 0 M13 -8 L14 0" />
      <path class="ink-quarry-leg" d="M15 -19 Q20 -21 19 -26" />
      <circle class="ink-quarry-eye" cx="-17" cy="-13" r="1.5" />
    </g>
  )
}

/** Hunter's other quarry — a hooded traveller, for the five targets that are
 * people rather than animals. Same local frame and the same creep, because a
 * snare does not care what walks into it. */
function QuarryTraveller() {
  return (
    <g class="ink-quarry-art">
      {/* Boots and a hand's width of leg BELOW the hem. The first version ran
          the robe to the ground and the whole quarry read as a canister — a
          walking figure has to show that it walks. */}
      <path class="ink-quarry-leg" d="M-5 -13 L-6 -4 M2 -13 L2 -4" />
      <path class="ink-quarry-boot" d="M-6 0 L-11 0 L-11 -3.6 L-5 -3.6 Z" />
      <path class="ink-quarry-boot" d="M4 0 L-1 0 L-1 -3.6 L5 -3.6 Z" />
      {/* A robe that FLARES to its hem: straight sides read as a barrel. */}
      <path class="ink-quarry-cloak" d="M-10 -12 L-7 -29 Q-1 -32 5 -29 L8 -12 Q-1 -9 -10 -12 Z" />
      <path class="ink-quarry-cloak" d="M-8 -26 Q-13 -21 -11 -14 L-7 -15 Q-8 -20 -5 -25 Z" />
      <path class="ink-quarry-hood" d="M-9 -29 Q-10 -39 0 -39.5 Q9 -39 8 -29 Q4 -26 0 -26 Q-5 -26 -9 -29 Z" />
      {/* The face opening, on the LEFT — it is the only thing saying which
          way the quarry is walking, and it is walking into the snare. */}
      <path class="ink-quarry-face" d="M-8 -34.5 Q-3 -36.5 -1.5 -33 Q-3.5 -29 -8 -30.5 Z" />
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
function Prop({ kind, broken = false, itemArt = null, swinging = true, built = 0 }) {
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
          <ItemArt art={itemArt} cx={158} cy={112} width={22} className={`ink-fish-idle${swinging ? ' is-working' : ''}`} />
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
  // The payoff is steam off the bowl, not a drawn vial — mirroring cooking's
  // steam and mining's shards, the same "resource stays, only an EFFECT
  // changes" rule every other prop in this file follows. A hand-drawn potion
  // here (this used to draw one) duplicated the ink-yield overlay's own
  // bespoke icon of the actual brewed item, putting two different-looking
  // potions on screen for the one payoff; the overlay is the only reveal.
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
          <>
            <g class="ink-steam ink-steam--a"><path d="M112 74 Q108 64 114 56" /></g>
            <g class="ink-steam ink-steam--b"><path d="M132 74 Q136 64 130 56" /></g>
          </>
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


  // Construction. A chair taking shape on the workshop floor — the ONE prop
  // in this file that is not consumed and respawned. `built` names the part
  // added last (0 = a fresh frame, then seat, posts, back), so a session
  // visibly assembles furniture instead of replaying the same blow forever;
  // the piece the payoff drops into place is exactly that one.
  //
  // The frame's apron rail is at y=73..80 and the hammer's face lands on its
  // top edge (see Tool's `build`). Every part added after it grows UP and
  // AWAY from that rail, because the nail the figure is hitting cannot move:
  // reach from the shoulder is fixed, so a workpiece that climbed with the
  // build would leave the hammer swinging at air.
  if (kind === 'scaffold') {
    const newest = built
    const fit = (index) => (broken && index === newest ? ' ink-fit' : '')
    return (
      <g>
        {/* Offcuts stacked out of the way — the detail that says workshop
            rather than "a chair happens to be standing here". */}
        <path class="ink-build-stack" d="M182 98 L198 98 L198 102 L182 102 Z" />
        <path class="ink-build-stack" d="M180 103 L198 103 L198 107 L180 107 Z" />

        {/* The frame: four legs and the apron rail they are pegged to. */}
        <g class={`ink-build-part${fit(0)}`}>
          <path class="ink-build-leg" d="M136 77 L135 103 L142 103 L143 77 Z" />
          <path class="ink-build-leg" d="M162 77 L162 103 L169 103 L169 77 Z" />
          <path class="ink-build-post" d="M127 79 L125 108 L134 108 L135 79 Z" />
          <path class="ink-build-post" d="M157 79 L157 108 L166 108 L164 79 Z" />
          <path class="ink-build-beam" d="M124 73 L170 73 L170 80 L124 80 Z" />
          <path class="ink-build-grain" d="M128 76.5 L166 76.5" />
          <circle class="ink-nail" cx="134" cy="76" r="1.5" />
          <circle class="ink-nail" cx="160" cy="76" r="1.5" />
        </g>

        {/* Seat. */}
        {built >= 1 && (
          <g class={`ink-build-part${fit(1)}`}>
            <path class="ink-build-beam" d="M120 65 L176 65 L176 73 L120 73 Z" />
            <path class="ink-build-grain" d="M120 69 L176 69 M148 65 L148 73" />
          </g>
        )}
        {/* Back posts, rising off the rear of the seat. */}
        {built >= 2 && (
          <g class={`ink-build-part${fit(2)}`}>
            <path class="ink-build-leg" d="M168 65 L168 38 L175 38 L175 65 Z" />
            <path class="ink-build-post" d="M156 65 L156 36 L165 36 L165 65 Z" />
            <circle class="ink-nail" cx="160.5" cy="62" r="1.4" />
          </g>
        )}
        {/* Crest rail and slat — the parts that finish it as a CHAIR rather
            than a bench with two sticks on the end. */}
        {built >= 3 && (
          <g class={`ink-build-part${fit(3)}`}>
            <path class="ink-build-beam" d="M152 33 L179 33 L179 41 L152 41 Z" />
            <path class="ink-build-beam" d="M154 47 L177 47 L177 54 L154 54 Z" />
            <path class="ink-build-grain" d="M152 37 L179 37 M154 50.5 L177 50.5" />
          </g>
        )}

        {broken && (
          <>
            <g class="ink-dust ink-dust--a"><circle cx="130" cy="74" r="1.9" /></g>
            <g class="ink-dust ink-dust--b"><circle cx="137" cy="72" r="1.6" /></g>
            <g class="ink-spark ink-spark--a"><path d="M132 74 L127 66" /></g>
            <g class="ink-spark ink-spark--b"><path d="M136 73 L138 65" /></g>
            {/* Only the blow that finishes the piece gets a flourish — it is
                the beat that tells the player a whole thing got made, which a
                per-plank sparkle would drown out. */}
            {built === BUILD_STAGES - 1 && (
              <g class="ink-finish-glint">
                <path d="M144 30 L144 40 M139 35 L149 35" />
                <path d="M186 46 L186 54 M182 50 L190 50" />
              </g>
            )}
          </>
        )}
      </g>
    )
  }

  // Magic — the three pedestal spells. Same plinth, same cast: what tells
  // them apart is the SUBJECT standing on it (its own real art, resolved
  // through the same path fishing's species art uses) and the colour the
  // spell arrives in. That is deliberate economy — an alchemist, a smelter
  // and a transmuter are one person doing one thing to three different
  // objects, and drawing three sets of furniture would say otherwise.
  if (PEDESTAL_PROPS.has(kind)) {
    const enchanting = kind === 'enchantPedestal'
    return (
      <g>
        {enchanting && (
          // The circle is what makes an enchantment a RITUAL rather than
          // another zap: it is drawn on the floor, so it reads before the
          // figure has moved at all.
          <g class={`ink-rune-circle${swinging ? ' is-working' : ''}`}>
            <ellipse class="ink-rune-ring" cx="158" cy="104" rx="36" ry="9" />
            <ellipse class="ink-rune-ring" cx="158" cy="104" rx="28" ry="7" />
            <path class="ink-rune-glyph" d="M128 104 L133 101 M158 96 L158 100 M188 104 L183 101 M143 108 L146 105 M173 108 L170 105" />
          </g>
        )}
        <Pedestal />
        {!broken && (
          <g class={`ink-subject${enchanting && swinging ? ' is-floating' : ''}`}>
            {itemArt
              ? <ItemArt art={itemArt} cx={158} cy={48} width={30} className="ink-subject-art" />
              : <Ingot />}
            {/* The spell landing on every pulse, not only on the completed
                action — gated on the payoff alone, the loop was a caster
                throwing light at an object that never once reacted. */}
            <circle class={`ink-zap ink-zap--${SPELL_SCHOOL[kind]}${swinging ? ' is-working' : ''}`} cx="158" cy="50" r="16" />
          </g>
        )}
        {broken && (
          <>
            <circle class={`ink-flash ink-flash--${SPELL_SCHOOL[kind]}`} cx="158" cy="50" r="18" />
            {kind === 'alchPedestal' && (
              // Alchemy's payoff is the one that does not transform into a
              // thing you can see on the plinth — the item leaves as coins,
              // so the coins have to be the beat.
              <g class="ink-coins">
                <g class="ink-coin ink-coin--a"><ellipse cx="150" cy="52" rx="4.4" ry="3.4" /><path d="M147 52 L153 52" /></g>
                <g class="ink-coin ink-coin--b"><ellipse cx="159" cy="48" rx="4.8" ry="3.7" /><path d="M156 48 L162 48" /></g>
                <g class="ink-coin ink-coin--c"><ellipse cx="167" cy="53" rx="4.2" ry="3.2" /><path d="M164 53 L170 53" /></g>
              </g>
            )}
            {kind === 'smeltPedestal' && (
              <>
                <g class="ink-spark ink-spark--a"><path d="M152 54 L146 44" /></g>
                <g class="ink-spark ink-spark--b"><path d="M158 52 L158 40" /></g>
                <g class="ink-spark ink-spark--c"><path d="M164 54 L171 45" /></g>
              </>
            )}
            {kind === 'transmutePedestal' && (
              <>
                <g class="ink-mote ink-mote--a"><circle cx="150" cy="54" r="2.4" /></g>
                <g class="ink-mote ink-mote--b"><circle cx="158" cy="50" r="2.7" /></g>
                <g class="ink-mote ink-mote--c"><circle cx="166" cy="54" r="2.2" /></g>
              </>
            )}
            {enchanting && (
              <g class="ink-enchant-burst">
                <path d="M158 34 L158 22 M141 44 L131 38 M175 44 L185 38" />
                <ellipse class="ink-rune-ring" cx="158" cy="104" rx="36" ry="9" />
              </g>
            )}
          </>
        )}
      </g>
    )
  }

  // Magic — curse and stun. The one non-combat spell with nothing to stand
  // on a plinth, so it needs something that can be hexed: a straw dummy,
  // which is also how it would actually be practised. Deliberately NOT the
  // mirrored player rig combat uses for its enemy — that trick is reserved
  // for thieving's mark (docs/skill-animations-proposal.md, Tier C), and a
  // second person standing there being cursed for XP reads as something
  // else entirely.
  if (kind === 'hexDummy') {
    return (
      <g>
        {/* A cross-braced foot, so the post reads as something stood up to be
            hit rather than something growing out of the floor. */}
        <path class="ink-dummy-foot" d="M140 108 L158 96 M176 108 L158 96" />
        <path class="ink-dummy-base" d="M142 108 Q158 101 174 108 Z" />
        <g class={`ink-dummy-rock${swinging && !broken ? ' is-working' : ''}`}>
          <path class="ink-dummy-post" d="M154 108 L154 42 L162 42 L162 108 Z" />
          {/* The crossbar has to stick WELL clear of the sack or the dummy
              reads as a bollard: at six units of overhang the sack's own
              outline swallowed it. */}
          <path class="ink-dummy-post" d="M126 62 L190 62 L190 68 L126 68 Z" />
          {/* Straw bursting from every cut end — the detail that separates a
              dummy from a signpost. */}
          <path class="ink-straw" d="M128 62 L120 55 M130 61 L124 52 M188 62 L196 55 M186 61 L192 52" />
          <path class="ink-dummy-sack" d="M145 54 Q158 47 171 54 L176 84 Q158 92 140 84 Z" />
          <path class="ink-dummy-seam" d="M142 72 Q158 79 174 72" />
          <path class="ink-dummy-seam" d="M147 58 Q158 63 169 58" />
          <ellipse class="ink-dummy-head" cx="158" cy="39" rx="11" ry="10.5" />
          <path class="ink-straw" d="M150 31 L146 24 M158 29 L158 21 M166 31 L170 24" />
          {/* Tied at the neck: a sack with a cord around it is a dummy's
              head, an untied circle is a snowman's. */}
          <path class="ink-dummy-tie" d="M150 46 Q158 50 166 46" />
          <path class="ink-dummy-tie" d="M153 44 L152 49 M163 44 L164 49" />
          {/* A painted mark, so a bolt landing on it has somewhere to land. */}
          <circle class="ink-dummy-target" cx="158" cy="70" r="9" />
          <circle class="ink-dummy-target" cx="158" cy="70" r="3.8" />
        </g>
        {broken && (
          <>
            {/* The hex itself: a sigil struck over the dummy, and the straw
                it knocks loose. */}
            <g class="ink-hex-sigil">
              <circle cx="158" cy="66" r="18" />
              <path d="M158 50 L172 74 L144 74 Z" />
              <path d="M158 58 L158 74 M151 68 L165 68" />
            </g>
            <g class="ink-straw-fly ink-straw-fly--a"><path d="M146 62 L138 56" /></g>
            <g class="ink-straw-fly ink-straw-fly--b"><path d="M170 62 L178 56" /></g>
            <g class="ink-straw-fly ink-straw-fly--c"><path d="M158 52 L160 43" /></g>
          </>
        )}
      </g>
    )
  }

  // Tier D — hunter. A spring-pole snare set on a game trail: a sapling
  // hauled down and pegged to a trigger stake, its noose laid open around a
  // scatter of bait. The trap is armed ONCE and fires ONCE, which is why this
  // is the only prop in this file that does not change between beats — what
  // moves per beat is the quarry (creeping in and bolting) and the trapper's
  // pull on the line. Everything is placed off the noose at (146,101): the
  // stake, the tip cord, the trigger line's own pivot in stage space
  // (SnareLine) and both quarries' creep distances are all measured to it.
  if (kind === 'snareBeast' || kind === 'snareMark') {
    const beast = kind === 'snareBeast'
    if (!broken) {
      return (
        <g>
          {/* Pole FIRST, quarry SECOND, trap LAST. That order is the depth of
              the scene: the sapling is the far side of the trail, the animal
              is walking down it, and the noose is lying on the near ground in
              front of both. Drawn the other way round the pole runs straight
              through the quarry's ribs, which is what the first pass did. */}
          <path class="ink-sapling" d="M180 108 C178 88 180 70 168 62 C160 56 152 55 144 56 L144.5 60 C152 59.4 158 60.6 164 66 C173 74 184 90 187 108 Z" />
          <SaplingLeaves x={144} y={58} flip />
          <path class="ink-cord" d="M144.5 58 L143.5 87" />
          <g class={`ink-quarry ink-quarry--${beast ? 'beast' : 'mark'}${swinging ? ' is-working' : ''}`}>
            {/* The placement lives on a NESTED group: this element carries the
                creep animation, and a static transform attribute on the same
                element is silently discarded the moment that animation starts. */}
            <g transform={beast ? 'translate(184,108) scale(.85)' : 'translate(172,108) scale(1.12)'}>
              {beast ? <QuarryBeast /> : <QuarryTraveller />}
            </g>
          </g>
          <path class="ink-stake" d="M141 106 L141 88 L146 88 L146 106 Z" />
          <path class="ink-cord" d="M138 85 L143.5 90 L149 85" />
          <ellipse class="ink-noose" cx="146" cy="101" rx="19" ry="5.4" />
          <path class="ink-cord" d="M146 95.8 Q145 92 143.5 88" />
          <g class="ink-bait">
            <circle cx="140" cy="101" r="1.5" />
            <circle cx="147" cy="103" r="1.4" />
            <circle cx="152" cy="100" r="1.3" />
            <circle cx="144" cy="99" r="1.2" />
          </g>
        </g>
      )
    }
    return (
      <g>
        {/* Sprung: the pole whipped upright, the stake kicked out from under
            it and lying on the ground, and the catch swinging by its ankles.
            The hoist origin is well LEFT of the pole because a 180-degree
            rotation flips the quarry's own local +x — hung at the tip it
            swung straight through the trunk. */}
        <path class="ink-sapling" d="M181 108 C180 84 178 60 175 38 L181.5 37 C184.5 62 187 86 187.5 108 Z" />
        <SaplingLeaves x={178} y={36} />
        <path class="ink-stake ink-stake--kicked" d="M138 102 L156 99 L156.6 103.4 L138.6 106.4 Z" />
        <g class="ink-hoist">
          <path class="ink-cord" d="M178 39 L170 53" />
          {/* scale(1,-1), not rotate(180). A half turn also flips the quarry's
              local +x, which threw its whole body out to the RIGHT and
              straight through the pole; a vertical flip hangs it head-down
              where it actually is, with the caught legs still at the rope. */}
          <g transform={beast ? 'translate(170,53) scale(.85,-.85)' : 'translate(170,53) scale(1.12,-1.12)'}>
            {beast ? <QuarryBeast /> : <QuarryTraveller />}
          </g>
        </g>
        <g class="ink-leaf-fly ink-leaf-fly--a"><path d="M148 96 L138 89" /></g>
        <g class="ink-leaf-fly ink-leaf-fly--b"><path d="M160 98 L169 91" /></g>
        <g class="ink-leaf-fly ink-leaf-fly--c"><path d="M153 92 L154 82" /></g>
      </g>
    )
  }

  // Tier C — thieving. The mark is the player's OWN rig, translated 52 units
  // right and recoloured through a scoped custom-property override
  // (.ink-mark, index.css) — the trick combat already proved for its enemy,
  // and the reason this tier costs no second character. They face the SAME
  // way the player does, which is what makes them a back turned rather than a
  // confrontation; the mirror combat uses would have them staring at the
  // thief.
  //
  // The purse hangs at (112,88) — on the circle of radius 39.2 the reaching
  // hand actually sweeps (see Tool's `pickpocket`), at the back corner of the
  // mark's belt and just under their own hanging fist. Move it and the tool's
  // reach has to be re-derived with it.
  if (kind === 'mark' || kind === 'markGuard') {
    const guard = kind === 'markGuard'
    return (
      <g>
        <g class={`ink-mark${guard ? ' ink-mark--guard' : ''}${swinging && !broken ? ' is-working' : ''}`}>
          <g transform="translate(58,0)">
            <InkwrightFigure>
              {/* The mark's own front arm, hanging at their side. Supplied
                  rather than omitted: InkwrightFigure draws only the back
                  arm, so a mark without this reads as one-armed. */}
              <g>
                <Limb d="M84 58 L94 66 L97 76" w={11} />
                <circle class="ink-skin-fill" cx="97" cy="78" r="4.4" />
              </g>
            </InkwrightFigure>
            {guard && (
              <g>
                {/* A domed helm with a nasal bar — the one addition that
                    turns a townsman into somebody it is dangerous to rob,
                    without a second body to draw. */}
                <path class="ink-helm" d="M62 33 Q61 15 77 12 Q93 15 92 33 Q85 29 77 29 Q68 29 62 33 Z" />
                <path class="ink-helm-rim" d="M60 29 L94 29 L94 34 L60 34 Z" />
                <path class="ink-helm" d="M85 33 L89 33 L89 44 L85 44 Z" />
                {/* Spear, planted, with the mark's own fist closed on it. */}
                <path class="ink-spear-shaft" d="M95 34 L99 34 L100 108 L96 108 Z" />
                <path class="ink-spear-head" d="M95 34 L95 20 Q97 10 99 20 L99 34 Z" />
              </g>
            )}
          </g>
        </g>
        {/* Belt strap. It stays behind on the payoff (cut, with nothing on
            the end of it) — a purse that vanishes leaves nothing to say a
            theft happened at all. */}
        <path class="ink-purse-strap" d="M119.5 80 L113 89" />
        {!broken && (
          <g>
            <path class="ink-purse" d="M104 89 Q112 83 120 89 Q122 97 112 99.5 Q102 97 104 89 Z" />
            <path class="ink-purse-tie" d="M105 90.5 Q112 94 119 90.5" />
          </g>
        )}
        {broken && (
          <>
            <g class="ink-purse-lift">
              <path class="ink-purse" d="M104 89 Q112 83 120 89 Q122 97 112 99.5 Q102 97 104 89 Z" />
              <path class="ink-purse-tie" d="M105 90.5 Q112 94 119 90.5" />
            </g>
            <g class="ink-coin ink-coin--a ink-coin--steal"><ellipse cx="106" cy="92" rx="3.6" ry="2.8" /><path d="M103.6 92 L108.4 92" /></g>
            <g class="ink-coin ink-coin--b ink-coin--steal"><ellipse cx="115" cy="94" rx="3.4" ry="2.6" /><path d="M112.6 94 L117.4 94" /></g>
          </>
        )}
      </g>
    )
  }

  // Thieving's one target that is furniture. Its cash box sits UNDER the near
  // end of the counter, which is both where a trader would actually keep it
  // and the one spot on the reaching hand's arc (112,88) — a box on the
  // counter top would need a second arm angle for one prop.
  if (kind === 'stall') {
    return (
      <g>
        <path class="ink-stall-post" d="M106 108 L106 44 L111 44 L111 108 Z" />
        <path class="ink-stall-post" d="M184 108 L184 44 L189 44 L189 108 Z" />
        <path class="ink-stall-awning" d="M98 36 L196 36 L192 50 L102 50 Z" />
        <path class="ink-stall-stripe" d="M120 36 L116 50 M140 36 L136 50 M160 36 L156 50 M180 36 L176 50" />
        <path class="ink-stall-valance" d="M102 50 Q108 58 114 50 Q120 58 126 50 Q132 58 138 50 Q144 58 150 50 Q156 58 162 50 Q168 58 174 50 Q180 58 186 50 Q189 54 192 50 L192 46 L102 46 Z" />
        <path class="ink-stall-counter" d="M100 72 L194 72 L194 79 L100 79 Z" />
        {/* The apron board stops short of the near bay, or it hides the box
            the whole animation is aimed at. */}
        <path class="ink-stall-apron" d="M128 79 L190 79 L190 85 L128 85 Z" />
        <g class="ink-cake">
          <path d="M132 72 L134 63 L146 63 L148 72 Z" />
          <path class="ink-cake-ice" d="M134 63 Q140 58 146 63 Z" />
        </g>
        <g class="ink-cake">
          <path d="M152 72 L154 64 L164 64 L166 72 Z" />
          <path class="ink-cake-ice" d="M154 64 Q159 59 164 64 Z" />
        </g>
        <g class="ink-cake">
          <path d="M170 72 L172 65 L181 65 L183 72 Z" />
          <path class="ink-cake-ice" d="M172 65 Q176.5 61 181 65 Z" />
        </g>
        <path class="ink-box-lid" d="M103 84 L127 84 L131 73 L107 73 Z" />
        <path class="ink-box" d="M104 104 L104 84 L126 84 L126 104 Z" />
        <path class="ink-box-band" d="M104 94 L126 94 M114 84 L114 104" />
        {!broken && (
          <g class="ink-coin-pile">
            <ellipse cx="110" cy="90" rx="4.2" ry="2.8" />
            <ellipse cx="119" cy="91" rx="4.4" ry="2.9" />
            <ellipse cx="114" cy="86" rx="4.2" ry="2.8" />
          </g>
        )}
        {broken && (
          <>
            <g class="ink-coin-pile">
              <ellipse cx="119" cy="91" rx="4.4" ry="2.9" />
            </g>
            <g class="ink-purse-lift">
              <g class="ink-coin-pile">
                <ellipse cx="112" cy="88" rx="4.4" ry="2.9" />
                <path d="M109.6 88 L114.4 88" />
              </g>
            </g>
          </>
        )}
      </g>
    )
  }

  // Tier F — summoning. A standing obelisk with a lit crystal at its cap, a
  // rune plate scored into the turf in front of it, and the charm being
  // infused floating over the plate. The charm is the item's OWN art (the
  // same path magic's pedestal and fishing's species use) because that is the
  // only thing telling one pouch craft from another — every one of them is
  // the same figure making the same push.
  if (kind === 'obelisk') {
    return (
      <g>
        <g class={`ink-spirit-circle${swinging ? ' is-working' : ''}`}>
          <ellipse class="ink-spirit-ring" cx="142" cy="102" rx="30" ry="8" />
          <ellipse class="ink-spirit-ring" cx="142" cy="102" rx="22" ry="6" />
          <path class="ink-spirit-glyph" d="M116 102 L120 99 M142 94 L142 98 M168 102 L164 99 M129 106 L132 103 M155 106 L152 103" />
        </g>
        <path class="ink-obelisk-base" d="M158 108 L160 101 L196 101 L198 108 Z" />
        <path class="ink-obelisk-base" d="M163 101 L164 96 L192 96 L193 101 Z" />
        {/* Tall and narrow. Drawn wider and shorter it read as a lighthouse —
            a standing stone is defined by being much taller than it is broad. */}
        <path class="ink-obelisk-shaft" d="M166 96 L173 26 L184 26 L190 96 Z" />
        <path class="ink-obelisk-band" d="M168 78 L188 78 M170 56 L186 56" />
        {/* A sigil, not a character: two chevrons over a slit. Drawn as a bar,
            a stem and a second bar it read as a legible written glyph, which
            is a different and much odder thing for a standing stone to have. */}
        <path class="ink-obelisk-rune" d="M173 60 L178 65 L183 60 M173 68 L178 63 L183 68 M178 70 L178 74" />
        <path class="ink-obelisk-cap" d="M172.5 26 L184.5 26 L182 20 L175 20 Z" />
        {/* The crystal is held ABOVE the cap, not set into it: a stone with a
            gem in it is a monument, a stone holding one up is a machine that
            is switched on. */}
        <path class={`ink-spirit-crystal${swinging ? ' is-working' : ''}`} d="M178 2 L185 11 L178 19 L171 11 Z" />
        {!broken && (
          <g>
            <g class={`ink-subject ink-subject--rite${swinging ? ' is-floating' : ''}`}>
              {itemArt
                ? <ItemArt art={itemArt} cx={142} cy={58} width={28} className="ink-subject-art" />
                : <Pouch />}
            </g>
            {/* The charge arriving on every push, not only on the completed
                action — the same correction magic's own zap needed. */}
            <circle class={`ink-charge${swinging ? ' is-working' : ''}`} cx="142" cy="58" r="17" />
          </g>
        )}
        {broken && (
          <>
            <circle class="ink-flash ink-flash--spirit" cx="142" cy="58" r="25" />
            <Wisp />
            <g class="ink-spirit-mote ink-spirit-mote--a"><circle cx="134" cy="62" r="2.4" /></g>
            <g class="ink-spirit-mote ink-spirit-mote--b"><circle cx="142" cy="58" r="2.7" /></g>
            <g class="ink-spirit-mote ink-spirit-mote--c"><circle cx="150" cy="62" r="2.2" /></g>
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
