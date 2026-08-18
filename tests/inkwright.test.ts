import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
// @ts-ignore
import {
  inkwrightPlan,
  inkwrightMotionForSkill,
  hasInkwrightMotion,
  INKWRIGHT_MOTIONS,
  TARGET_STRIKE_MS,
} from '../src/utils/inkwright.js'
// @ts-ignore
import { actionCycleMs } from '../src/utils/actionSprites.js'
// @ts-ignore
import skillsData from '../src/data/skills.json'

// docs/skill-animations-proposal.md Tier A: pure content on the existing
// mining/woodcutting/fishing system, no new component or timing behaviour.
// Prayer isn't listed by skill name here — its motion depends on the action
// id (bury/altar/scatter), covered separately below.
const FIGURE_SKILLS = [
  'mining', 'woodcutting', 'fishing',
  'firemaking', 'cooking', 'smithing', 'crafting', 'fletching', 'herblore', 'runecraft',
]
const NO_FIGURE_SKILLS = ['agility', 'magic']

describe('inkwright — which skills have a figure', () => {
  it('covers every gathering/production skill wired so far, plus prayer', () => {
    for (const skill of FIGURE_SKILLS) expect(hasInkwrightMotion(skill)).toBe(true)
    expect(hasInkwrightMotion('prayer')).toBe(true)
    for (const skill of NO_FIGURE_SKILLS) {
      expect(hasInkwrightMotion(skill)).toBe(false)
      expect(inkwrightPlan(skill, 4)).toBeNull()
    }
  })

  it('every motion names a prop the stage can draw', () => {
    const drawable = new Set([
      'rock', 'tree', 'water',
      'logpile', 'cookfire', 'anvil', 'bench', 'shavehorse', 'mortar', 'runealtar',
      'grave', 'gildedAltar', 'dust',
    ])
    // One CSS keyframe family (`.ink-fig--<motion>`) may be shared by several
    // INKWRIGHT_MOTIONS keys — prayer's three poses all animate as `commune`
    // — so this checks the prop is drawable, not that motion === key.
    const knownMotions = new Set([
      'mine', 'chop', 'fish',
      'kindle', 'cook', 'smith', 'craft', 'fletch', 'brew', 'weave',
      'bury', 'offer', 'scatter',
    ])
    for (const key of Object.keys(INKWRIGHT_MOTIONS)) {
      const m = INKWRIGHT_MOTIONS[key]
      expect(knownMotions.has(m.motion)).toBe(true)
      expect(drawable.has(m.prop)).toBe(true)
    }
  })

  it('is case-insensitive and safe on junk input', () => {
    expect(inkwrightMotionForSkill('MINING')?.motion).toBe('mine')
    expect(inkwrightMotionForSkill(null)).toBeNull()
    expect(inkwrightMotionForSkill(undefined)).toBeNull()
    expect(inkwrightMotionForSkill('')).toBeNull()
  })

  it('prayer picks its pose from the action id, defaulting to bury', () => {
    expect(inkwrightMotionForSkill('prayer', 'bury_dragon_bones')?.prop).toBe('grave')
    expect(inkwrightMotionForSkill('prayer', 'altar_dragon_bones')?.prop).toBe('gildedAltar')
    expect(inkwrightMotionForSkill('prayer', 'scatter_gargoyle_dust')?.prop).toBe('dust')
    expect(inkwrightMotionForSkill('prayer')?.prop).toBe('grave')
    // Each pose is its own motion, not one gesture wearing three props:
    // digging, offering and casting look nothing like each other, and the
    // shared version read as none of them.
    expect(inkwrightMotionForSkill('prayer', 'bury_bones')?.motion).toBe('bury')
    expect(inkwrightMotionForSkill('prayer', 'altar_bones')?.motion).toBe('offer')
    expect(inkwrightMotionForSkill('prayer', 'scatter_gargoyle_dust')?.motion).toBe('scatter')
  })

  // Same precedent as tests/theme.test.ts and tests/itemIconParity.test.ts:
  // the CSS is the other half of this contract, and a motion row whose
  // keyframes were never written renders a figure standing perfectly still
  // holding a tool — which looks like a hang, not like a missing animation.
  it('every motion has a keyframe family and a drawn prop', () => {
    const css = readFileSync(resolve(__dirname, '../src/index.css'), 'utf8')
    const stage = readFileSync(resolve(__dirname, '../src/components/InkwrightStage.jsx'), 'utf8')
    // Scoped to Prop()'s own body: Backdrop() branches on the same prop names,
    // so searching the whole file would pass a prop that has a scene but
    // nothing to strike.
    const propBody = stage.slice(stage.indexOf('function Prop({'))
    for (const key of Object.keys(INKWRIGHT_MOTIONS)) {
      const { motion, prop } = INKWRIGHT_MOTIONS[key]
      expect(css, `${motion} has no arm keyframes`)
        .toContain(`.ink-fig--${motion}.is-working .ink-arm`)
      // The payoff beat is what the player reads as "the action completed".
      expect(css, `${motion} has no payoff rule`).toContain(`.ink-payoff--${motion}`)
      // A prop Prop() cannot draw falls through to the rock silhouette, so
      // smithing would silently mine a boulder.
      expect(propBody, `${prop} is not drawn by Prop()`).toContain(`kind === '${prop}'`)
    }
  })

  it('every prayer action in skills.json resolves to a real pose', () => {
    for (const action of skillsData.prayer.actions) {
      const plan = inkwrightPlan('prayer', action.ticks, action.id)!
      expect(['grave', 'gildedAltar', 'dust']).toContain(plan.prop)
      expect(plan.pose).toBeTruthy()
    }
  })
})

describe('inkwright — the cadence law', () => {
  it('strikes divide the action exactly, so the last impact lands on the yield', () => {
    for (const skill of FIGURE_SKILLS) {
      for (const action of skillsData[skill].actions) {
        const plan = inkwrightPlan(skill, action.ticks)!
        expect(plan.strikes).toBeGreaterThanOrEqual(1)
        // The period times the count reconstructs the cycle (within rounding),
        // which is what keeps the loop phase-locked to the progress bar.
        expect(Math.abs(plan.strikePeriodMs * plan.strikes - plan.cycleMs))
          .toBeLessThanOrEqual(plan.strikes)
      }
    }
    for (const action of skillsData.prayer.actions) {
      const plan = inkwrightPlan('prayer', action.ticks, action.id)!
      expect(plan.strikes).toBeGreaterThanOrEqual(1)
      expect(Math.abs(plan.strikePeriodMs * plan.strikes - plan.cycleMs))
        .toBeLessThanOrEqual(plan.strikes)
    }
  })

  it('a longer action takes MORE strikes, never slower ones', () => {
    // The product decision this system encodes: runeforged ore is a long grind
    // of ordinary swings, not one sluggish one.
    const tin = inkwrightPlan('mining', 4)!
    const runite = inkwrightPlan('mining', 30)!
    expect(runite.strikes).toBeGreaterThan(tin.strikes)
    // Tempo holds steady while the count scales.
    expect(Math.abs(runite.strikePeriodMs - tin.strikePeriodMs)).toBeLessThan(200)
  })

  it('holds the strike tempo near target across every shipped action', () => {
    // MAX_STRIKES (40, see inkwright.js) is a cap, not a curve — an action
    // long enough to saturate it (smithing's 100-tick godswords) is allowed
    // to run its period past the target window, same tradeoff the "caps the
    // strike count" test below documents for mining.
    const MAX_STRIKES = 40
    for (const skill of FIGURE_SKILLS) {
      for (const action of skillsData[skill].actions) {
        const plan = inkwrightPlan(skill, action.ticks)!
        if (plan.strikes >= MAX_STRIKES) continue
        // Never frantic, never sluggish — the window the prototype was tuned in.
        expect(plan.strikePeriodMs).toBeGreaterThanOrEqual(TARGET_STRIKE_MS * 0.55)
        expect(plan.strikePeriodMs).toBeLessThanOrEqual(TARGET_STRIKE_MS * 1.45)
        // The payoff must fit inside the next action's first strike, or a
        // shattered rock is still flying while the next one is being hit.
        expect(plan.payoffMs).toBeLessThanOrEqual(plan.strikePeriodMs * 1.15)
      }
    }
  })

  it('a faster tool strikes faster — the whole point of the law', () => {
    // Same action, fewer effective ticks (what a better pickaxe buys).
    const slow = inkwrightPlan('mining', 8)!
    const fast = inkwrightPlan('mining', 4)!
    expect(fast.cycleMs).toBeLessThan(slow.cycleMs)
    expect(fast.strikes).toBeLessThan(slow.strikes)
  })

  it('takes its cycle from the shared law, never its own arithmetic', () => {
    for (const ticks of [3, 6, 30]) {
      expect(inkwrightPlan('woodcutting', ticks)!.cycleMs).toBe(actionCycleMs(ticks))
    }
  })

  it('exposes only durations the stage actually consumes', () => {
    // A plan field nothing reads is a claim the CSS does not honour. The stage
    // sets --ink-strike and --ink-payoff and nothing else. `pose` is the one
    // deliberate exception — InkwrightStage doesn't read it either, but it's
    // reserved for a future prayer-specific payoff tweak without another
    // inkwright.js signature change.
    const plan = inkwrightPlan('mining', 5)!
    expect(Object.keys(plan).sort()).toEqual(
      ['cycleMs', 'label', 'motion', 'payoffMs', 'prop', 'strikePeriodMs', 'strikes'],
    )
    const prayerPlan = inkwrightPlan('prayer', 3, 'bury_bones')!
    expect(Object.keys(prayerPlan).sort()).toEqual(
      ['cycleMs', 'label', 'motion', 'payoffMs', 'pose', 'prop', 'strikePeriodMs', 'strikes'],
    )
  })

  it('survives a degenerate tick cost rather than dividing by zero', () => {
    for (const ticks of [0, -3, null, undefined, NaN]) {
      const plan = inkwrightPlan('mining', ticks as any)!
      expect(plan.strikes).toBeGreaterThanOrEqual(1)
      expect(plan.strikePeriodMs).toBeGreaterThan(0)
      expect(Number.isFinite(plan.payoffMs)).toBe(true)
    }
  })

  it('caps the strike count so an absurd action cannot melt the loop', () => {
    const plan = inkwrightPlan('mining', 100000)!
    expect(plan.strikes).toBeLessThanOrEqual(40)
  })
})
