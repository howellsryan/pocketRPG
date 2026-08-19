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
// @ts-ignore
import { BUILDING_ACTIONS } from '../src/engine/construction.js'
// @ts-ignore
import { SUMMONING_CREATURES, getPouchRecipe, getScrollRecipe, CRAFT_ACTION_TICKS } from '../src/engine/summoning.js'

// docs/skill-animations-proposal.md Tier A: pure content on the existing
// mining/woodcutting/fishing system, no new component or timing behaviour.
// Prayer isn't listed by skill name here — its motion depends on the action
// id (bury/altar/scatter), covered separately below.
const FIGURE_SKILLS = [
  'mining', 'woodcutting', 'fishing',
  'firemaking', 'cooking', 'smithing', 'crafting', 'fletching', 'herblore', 'runecraft',
]
// Tier E/G. Neither is listed above: construction's actions live in
// engine/construction.js rather than skills.json, and magic's motion depends
// on the action id (alchemy/enchant/superheat/transmute/hex) the same way
// prayer's does. Both are covered on their own below. Tiers C/D/F (thieving,
// hunter, summoning) are the same shape and are covered below too — thieving
// and hunter pick their prop off the target's id, and summoning's actions are
// built by engine/summoning.js rather than living in skills.json.
// Agility is the last skill on the coverage plan (Tier B) with no figure yet.
const NO_FIGURE_SKILLS = ['agility']

describe('inkwright — which skills have a figure', () => {
  it('covers every gathering/production skill wired so far, plus prayer, construction and magic', () => {
    for (const skill of FIGURE_SKILLS) expect(hasInkwrightMotion(skill)).toBe(true)
    expect(hasInkwrightMotion('prayer')).toBe(true)
    expect(hasInkwrightMotion('construction')).toBe(true)
    expect(hasInkwrightMotion('magic')).toBe(true)
    expect(hasInkwrightMotion('hunter')).toBe(true)
    expect(hasInkwrightMotion('thieving')).toBe(true)
    expect(hasInkwrightMotion('summoning')).toBe(true)
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
      'scaffold',
      'alchPedestal', 'smeltPedestal', 'transmutePedestal', 'enchantPedestal', 'hexDummy',
      'snareBeast', 'snareMark',
      'mark', 'markGuard', 'stall',
      'obelisk',
    ])
    // One CSS keyframe family (`.ink-fig--<motion>`) may be shared by several
    // INKWRIGHT_MOTIONS keys — prayer's three poses all animate as `commune`
    // — so this checks the prop is drawable, not that motion === key.
    const knownMotions = new Set([
      'mine', 'chop', 'fish',
      'kindle', 'cook', 'smith', 'craft', 'fletch', 'brew', 'weave',
      'bury', 'offer', 'scatter',
      'build', 'cast', 'enchant', 'hex',
      'snare', 'pickpocket', 'infuse',
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

  it('magic picks its act from the action id, defaulting to a transmutation', () => {
    expect(inkwrightMotionForSkill('magic', 'high_alch')?.prop).toBe('alchPedestal')
    expect(inkwrightMotionForSkill('magic', 'superheat')?.prop).toBe('smeltPedestal')
    expect(inkwrightMotionForSkill('magic', 'tan_leather')?.prop).toBe('transmutePedestal')
    expect(inkwrightMotionForSkill('magic', 'plank_make')?.prop).toBe('transmutePedestal')
    expect(inkwrightMotionForSkill('magic', 'enchant_onyx_bolts')?.prop).toBe('enchantPedestal')
    expect(inkwrightMotionForSkill('magic', 'curse')?.prop).toBe('hexDummy')
    expect(inkwrightMotionForSkill('magic', 'stun')?.prop).toBe('hexDummy')
    // A spell this table has never heard of still gets a figure — every
    // non-combat spell on that screen turns one item into another.
    expect(inkwrightMotionForSkill('magic', 'brand_new_spell')?.prop).toBe('transmutePedestal')
    // Alchemy, superheating and transmuting are one CAST wearing three
    // targets; enchanting and cursing are motions of their own.
    expect(inkwrightMotionForSkill('magic', 'high_alch')?.motion).toBe('cast')
    expect(inkwrightMotionForSkill('magic', 'superheat')?.motion).toBe('cast')
    expect(inkwrightMotionForSkill('magic', 'enchant_ruby')?.motion).toBe('enchant')
    expect(inkwrightMotionForSkill('magic', 'stun')?.motion).toBe('hex')
  })

  it('every magic action in skills.json resolves to a real prop', () => {
    const props = new Set(['alchPedestal', 'smeltPedestal', 'transmutePedestal', 'enchantPedestal', 'hexDummy'])
    for (const action of skillsData.magic.actions) {
      const plan = inkwrightPlan('magic', action.ticks, action.id)!
      expect(props, `${action.id} resolved to ${plan.prop}`).toContain(plan.prop)
    }
  })

  it('every building action resolves to the bench figure', () => {
    expect(BUILDING_ACTIONS.length).toBeGreaterThan(0)
    for (const action of BUILDING_ACTIONS) {
      const plan = inkwrightPlan('construction', action.ticks, action.id)!
      expect(plan.motion).toBe('build')
      expect(plan.prop).toBe('scaffold')
      expect(plan.strikes).toBeGreaterThanOrEqual(1)
    }
  })

  it('hunter picks its quarry from the action id, defaulting to a beast', () => {
    expect(inkwrightMotionForSkill('hunter', 'hunt_cow')?.prop).toBe('snareBeast')
    expect(inkwrightMotionForSkill('hunter', 'hunt_herbi')?.prop).toBe('snareBeast')
    expect(inkwrightMotionForSkill('hunter', 'hunt_wizard')?.prop).toBe('snareMark')
    expect(inkwrightMotionForSkill('hunter', 'hunt_master_trader')?.prop).toBe('snareMark')
    // New content is a beast until the humanoid list says otherwise — one
    // trap, one motion, so an unrecognised target still gets a figure.
    expect(inkwrightMotionForSkill('hunter', 'hunt_brand_new_thing')?.prop).toBe('snareBeast')
    expect(inkwrightMotionForSkill('hunter')?.motion).toBe('snare')
  })

  it('every hunter action in skills.json resolves to a real trap', () => {
    expect(skillsData.hunter.actions.length).toBeGreaterThan(0)
    for (const action of skillsData.hunter.actions) {
      const plan = inkwrightPlan('hunter', action.ticks, action.id)!
      expect(['snareBeast', 'snareMark'], `${action.id} resolved to ${plan.prop}`).toContain(plan.prop)
      expect(plan.motion).toBe('snare')
    }
  })

  it('thieving picks its target from the npc id — stall, guard or plain mark', () => {
    expect(inkwrightMotionForSkill('thieving', 'cake_stall')?.prop).toBe('stall')
    expect(inkwrightMotionForSkill('thieving', 'guard')?.prop).toBe('markGuard')
    expect(inkwrightMotionForSkill('thieving', 'knight')?.prop).toBe('markGuard')
    expect(inkwrightMotionForSkill('thieving', 'ardougne_knight')?.prop).toBe('markGuard')
    expect(inkwrightMotionForSkill('thieving', 'villager')?.prop).toBe('mark')
    expect(inkwrightMotionForSkill('thieving', 'elf')?.prop).toBe('mark')
    // Everyone the table has never heard of is somebody with pockets.
    expect(inkwrightMotionForSkill('thieving', 'brand_new_target')?.prop).toBe('mark')
    expect(inkwrightMotionForSkill('thieving')?.motion).toBe('pickpocket')
  })

  it('every thieving npc in skills.json resolves to a real target', () => {
    const props = new Set(['mark', 'markGuard', 'stall'])
    expect(skillsData.thieving.npcs.length).toBeGreaterThan(0)
    for (const npc of skillsData.thieving.npcs) {
      const plan = inkwrightPlan('thieving', npc.pickpocketTicks || 4, npc.id)!
      expect(props, `${npc.id} resolved to ${plan.prop}`).toContain(plan.prop)
      expect(plan.strikes).toBeGreaterThanOrEqual(1)
    }
    // Every stall in the data is furniture, and every furniture target must
    // reach the stall prop — a stall drawn as a person is a mark being robbed
    // who is not there.
    const stalls = skillsData.thieving.npcs.filter((n: any) => n.id.endsWith('_stall'))
    expect(stalls.length).toBeGreaterThan(0)
    for (const npc of stalls) {
      expect(inkwrightMotionForSkill('thieving', npc.id)?.prop).toBe('stall')
    }
  })

  it('every quarry and every target kind is actually reached by real content', () => {
    // HUNTER_HUMANOIDS and THIEVING_GUARDS are hand-maintained id lists in
    // inkwright.js, and a typo in one is invisible: the target quietly falls
    // to the default prop and stays there forever. Nothing else in this file
    // would notice — the "resolves to a real prop" tests above pass either
    // way. What a typo cannot survive is a prop nothing reaches.
    const hunterProps = new Set(
      skillsData.hunter.actions.map((a: any) => inkwrightMotionForSkill('hunter', a.id)!.prop),
    )
    expect(hunterProps).toEqual(new Set(['snareBeast', 'snareMark']))
    const thievingProps = new Set(
      skillsData.thieving.npcs.map((n: any) => inkwrightMotionForSkill('thieving', n.id)!.prop),
    )
    expect(thievingProps).toEqual(new Set(['mark', 'markGuard', 'stall']))
  })

  it('every summoning recipe resolves to the obelisk', () => {
    expect(SUMMONING_CREATURES.length).toBeGreaterThan(0)
    for (const creature of SUMMONING_CREATURES) {
      for (const recipe of [getPouchRecipe(creature), getScrollRecipe(creature)]) {
        expect(recipe).toBeTruthy()
        const plan = inkwrightPlan('summoning', CRAFT_ACTION_TICKS, `summon_${creature.id}`)!
        expect(plan.prop).toBe('obelisk')
        expect(plan.motion).toBe('infuse')
        expect(plan.strikes).toBeGreaterThanOrEqual(1)
      }
      // The stage draws the FIRST material's own art on the plate (the charm
      // for a pouch, the pouch for a scroll batch), which is the only thing
      // telling two infusions apart — so a recipe must have one.
      expect(Object.keys(getPouchRecipe(creature).materials)[0]).toBe(creature.charm)
      expect(Object.keys(getScrollRecipe(creature).materials)[0]).toBe(creature.pouch)
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
    for (const action of [...skillsData.magic.actions, ...BUILDING_ACTIONS]) {
      const plan = inkwrightPlan(action.runeReq ? 'magic' : 'construction', action.ticks, action.id)!
      expect(plan.strikes).toBeGreaterThanOrEqual(1)
      expect(Math.abs(plan.strikePeriodMs * plan.strikes - plan.cycleMs))
        .toBeLessThanOrEqual(plan.strikes)
    }
    for (const action of skillsData.hunter.actions) {
      const plan = inkwrightPlan('hunter', action.ticks, action.id)!
      expect(Math.abs(plan.strikePeriodMs * plan.strikes - plan.cycleMs))
        .toBeLessThanOrEqual(plan.strikes)
    }
    for (const npc of skillsData.thieving.npcs) {
      const plan = inkwrightPlan('thieving', npc.pickpocketTicks || 4, npc.id)!
      expect(Math.abs(plan.strikePeriodMs * plan.strikes - plan.cycleMs))
        .toBeLessThanOrEqual(plan.strikes)
    }
  })

  it('holds the tempo for the three tiers whose actions are not in skills.json shape', () => {
    // Hunter, thieving and summoning between them span 2 ticks (an infusion)
    // to 20 (a hunt) — the widest spread any single pass has added, and the
    // one place a new motion could quietly fall outside the tempo window the
    // whole system is tuned in.
    const plans = [
      ...skillsData.hunter.actions.map((a: any) => inkwrightPlan('hunter', a.ticks, a.id)!),
      ...skillsData.thieving.npcs.map((n: any) => inkwrightPlan('thieving', n.pickpocketTicks || 4, n.id)!),
      inkwrightPlan('summoning', CRAFT_ACTION_TICKS)!,
    ]
    for (const plan of plans) {
      expect(plan.strikePeriodMs).toBeGreaterThanOrEqual(TARGET_STRIKE_MS * 0.55)
      expect(plan.strikePeriodMs).toBeLessThanOrEqual(TARGET_STRIKE_MS * 1.45)
      expect(plan.payoffMs).toBeLessThanOrEqual(plan.strikePeriodMs * 1.15)
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
