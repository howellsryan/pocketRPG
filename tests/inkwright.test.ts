import { describe, it, expect } from 'vitest'
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

const FIGURE_SKILLS = ['mining', 'woodcutting', 'fishing']

describe('inkwright — which skills have a figure', () => {
  it('covers exactly the three gathering skills wired so far', () => {
    for (const skill of FIGURE_SKILLS) expect(hasInkwrightMotion(skill)).toBe(true)
    for (const skill of ['smithing', 'cooking', 'crafting', 'agility', 'magic', 'prayer']) {
      expect(hasInkwrightMotion(skill)).toBe(false)
      expect(inkwrightPlan(skill, 4)).toBeNull()
    }
  })

  it('every motion names a prop the stage can draw', () => {
    const drawable = new Set(['rock', 'tree', 'water'])
    for (const key of Object.keys(INKWRIGHT_MOTIONS)) {
      const m = INKWRIGHT_MOTIONS[key]
      expect(m.motion).toBe(key)
      expect(drawable.has(m.prop)).toBe(true)
    }
  })

  it('is case-insensitive and safe on junk input', () => {
    expect(inkwrightMotionForSkill('MINING')?.motion).toBe('mine')
    expect(inkwrightMotionForSkill(null)).toBeNull()
    expect(inkwrightMotionForSkill(undefined)).toBeNull()
    expect(inkwrightMotionForSkill('')).toBeNull()
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
    for (const skill of FIGURE_SKILLS) {
      for (const action of skillsData[skill].actions) {
        const plan = inkwrightPlan(skill, action.ticks)!
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
    // sets --ink-strike and --ink-payoff and nothing else.
    const plan = inkwrightPlan('mining', 5)!
    expect(Object.keys(plan).sort()).toEqual(
      ['cycleMs', 'label', 'motion', 'payoffMs', 'prop', 'strikePeriodMs', 'strikes'],
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
