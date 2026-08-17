import { actionCycleMs } from './actionSprites.js'

// ──────────────────────────────────────────────────────────────────────────
// Inkwright — the skilling figure. One inked-vector character, reused across
// every gathering skill: the tool and the motion change per skill, the figure
// never does. Design record: docs/action-animations.md; checklist: the
// `action-animation` skill.
//
// This is the SECOND presentation on the action-animation foundation, not a
// second timing system. ActionSpriteStage draws a tool glyph in a lane between
// two combatants; a skilling action has one actor working on a resource, and
// the thing the player is waiting for is the resource giving way. So the stage
// differs and the CADENCE LAW does not — every duration here still comes from
// actionSprites.js.
//
// Where skilling genuinely diverges from combat, and why: a combat cycle is ONE
// swing, so a slower weapon means a slower-looking swing. A skilling action is
// several strikes that end in one yield, so a longer action means MORE strikes
// at the same tempo — runeforged ore takes 23 swings to break, not one slow
// one. Tempo is what a player reads as "how hard am I working"; strike count is
// what they read as "how tough is this rock".
//
// Pure logic — no UI imports, no DOM. The component is
// components/InkwrightStage.jsx.
// ──────────────────────────────────────────────────────────────────────────

// The tempo a strike wants to land at. Not a duration — a TARGET the real
// period is solved back from, so strikes divide the action evenly and the last
// one lands exactly on the yield. Real periods across shipped actions come out
// 720-890ms, which is the point: the player feels one working rhythm whatever
// they are mining.
export const TARGET_STRIKE_MS = 800

// A cap, not a curve. Runeforged ore (30 ticks) wants 23 strikes and gets them;
// this only stops an absurd action from remounting the loop hundreds of times.
const MAX_STRIKES = 40

// Motion vocabulary, keyed by the skill it belongs to. `motion` names a
// keyframe family in src/index.css (.ink-fig--<motion>) AND the tool and prop
// the stage draws, because in skilling those are one decision: a pickaxe swings
// at a rock, an axe at a trunk.
//
// Unlike ActionSpriteStage, the tool is DRAWN, not a masked game-icons glyph.
// A glyph in the hand of an inked figure reads as a sticker on a drawing — the
// tool has to share the figure's outline weight to belong to it. That is a
// handful of paths per motion, kept in the stage beside the figure they hang on.
export const INKWRIGHT_MOTIONS = {
  mine: { motion: 'mine', prop: 'rock',  label: 'Mining' },
  chop: { motion: 'chop', prop: 'tree',  label: 'Woodcutting' },
  fish: { motion: 'fish', prop: 'water', label: 'Fishing' },
}

// Only the three skills whose action is a physical strike at a resource. Every
// other skill keeps the orb until it gets a motion of its own — a row here with
// no keyframes renders a figure holding a tool perfectly still.
const SKILL_MOTIONS = {
  mining: 'mine',
  woodcutting: 'chop',
  fishing: 'fish',
}

/** The motion key for a skill, or null if it has no figure yet. */
export function inkwrightMotionForSkill(skill) {
  const key = SKILL_MOTIONS[String(skill || '').toLowerCase()]
  return key ? INKWRIGHT_MOTIONS[key] : null
}

export function hasInkwrightMotion(skill) {
  return !!inkwrightMotionForSkill(skill)
}

/**
 * Everything the stage needs to animate one action, derived from that action's
 * own tick cost.
 *
 * `ticks` must be the EFFECTIVE cost — what the player's tool actually gets —
 * not the action's base cost. SkillingScreen already stores the tool-adjusted
 * action on the session (`getEffectiveToolActionTicks`), so a Rune pickaxe
 * strikes visibly faster than a Bronze one for free. Passing the base cost
 * silently throws that away, which is the whole law.
 *
 * Returns null for a skill with no figure, so callers can fall back to the orb
 * with a single truthiness check.
 */
export function inkwrightPlan(skill, ticks) {
  const sprite = inkwrightMotionForSkill(skill)
  if (!sprite) return null

  const cycleMs = actionCycleMs(ticks)
  // Solve the count from the target, then the period back from the count, so
  // an exact whole number of strikes fills the action. Rounding the PERIOD
  // instead leaves a partial strike at the end and the yield lands mid-windup.
  const strikes = Math.max(1, Math.min(MAX_STRIKES, Math.round(cycleMs / TARGET_STRIKE_MS)))
  const strikePeriodMs = Math.round(cycleMs / strikes)

  return {
    ...sprite,
    cycleMs,
    strikes,
    strikePeriodMs,
    // The yield beat overlaps the first strike of the NEXT action rather than
    // reserving a tail of this one: the engine grants the item at progress 1
    // and immediately starts again, so there is no dead time to reserve. The
    // prop breaks, then returns as the next rock.
    payoffMs: Math.min(900, Math.round(strikePeriodMs * 1.1)),
  }
}
