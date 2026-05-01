import { describe, it, expect } from 'vitest'
import skills from '../src/data/skills.json'
import items from '../src/data/items.json'
import { ALL_SKILLS, SKILL_ICONS, STUB_SKILLS, UTILITY_SKILLS } from '../src/utils/constants.js'
import { getAvailableActions } from '../src/engine/skilling.js'
import { getXPForLevel } from '../src/engine/experience.js'
import { simulateIdleSkilling } from '../src/engine/idleEngine.js'
import { getSkipPreflight, isChargeableSkipOutcome, SKIP_HOUR_MS } from '../src/engine/skipPreflight.js'

const dungeoneering = (skills as Record<string, any>).dungeoneering
const itemIds = new Set(Object.keys(items as Record<string, any>))

const REWARD_SPECS: Record<string, { level: number; ticks: number; product: string }> = {
  unlock_chaotic_rapier:        { level: 80, ticks: 60000, product: 'chaotic_rapier' },
  unlock_chaotic_longsword:     { level: 80, ticks: 60000, product: 'chaotic_longsword' },
  unlock_chaotic_maul:          { level: 80, ticks: 60000, product: 'chaotic_maul' },
  unlock_chaotic_crossbow:      { level: 80, ticks: 60000, product: 'chaotic_crossbow' },
  unlock_chaotic_staff:         { level: 80, ticks: 60000, product: 'chaotic_staff' },
  unlock_eagle_eyed_kiteshield: { level: 80, ticks: 60000, product: 'eagle_eyed_kiteshield' },
  unlock_arcane_kiteshield:     { level: 80, ticks: 60000, product: 'arcane_kiteshield' },
  unlock_arcane_necklace:       { level: 65, ticks: 15000, product: 'arcane_necklace' },
}

describe('dungeoneering: skill wiring', () => {
  it('skill exists in skills.json', () => {
    expect(dungeoneering).toBeDefined()
    expect(dungeoneering.id).toBe('dungeoneering')
    expect(Array.isArray(dungeoneering.actions)).toBe(true)
  })

  it('is registered in ALL_SKILLS via UTILITY_SKILLS', () => {
    expect(UTILITY_SKILLS).toContain('dungeoneering')
    expect(ALL_SKILLS).toContain('dungeoneering')
  })

  it('has a SKILL_ICONS entry', () => {
    expect(SKILL_ICONS.dungeoneering).toBeDefined()
    expect(typeof SKILL_ICONS.dungeoneering).toBe('string')
    expect(SKILL_ICONS.dungeoneering.length).toBeGreaterThan(0)
  })

  it('is not a stub skill', () => {
    expect(STUB_SKILLS.has('dungeoneering')).toBe(false)
  })
})

describe('dungeoneering: training actions', () => {
  const trainingActions = dungeoneering.actions.filter((a: any) => a.category !== 'reward')

  it('has exactly ten training actions at the expected levels', () => {
    expect(trainingActions).toHaveLength(10)
    const levels = trainingActions.map((a: any) => a.level).sort((x: number, y: number) => x - y)
    expect(levels).toEqual([1, 10, 20, 30, 40, 50, 60, 70, 80, 90])
  })

  it('every training action runs for 500 ticks (5 minutes)', () => {
    for (const a of trainingActions) {
      expect(a.ticks, `${a.id} ticks`).toBe(500)
    }
  })

  it('XP awards are 1k–10k in 1k increments matching level tier', () => {
    const byLevel = new Map<number, number>()
    for (const a of trainingActions) byLevel.set(a.level, a.xp)
    const expected: Array<[number, number]> = [
      [1, 1000], [10, 2000], [20, 3000], [30, 4000], [40, 5000],
      [50, 6000], [60, 7000], [70, 8000], [80, 9000], [90, 10000],
    ]
    for (const [level, xp] of expected) {
      expect(byLevel.get(level), `level ${level} xp`).toBe(xp)
    }
  })

  it('training actions never produce items', () => {
    for (const a of trainingActions) {
      expect(a.product, `${a.id} should have no product`).toBeUndefined()
      expect(a.dropTable, `${a.id} should have no drop table`).toBeUndefined()
      expect(a.materials, `${a.id} should have no materials`).toBeUndefined()
    }
  })
})

describe('dungeoneering: reward actions', () => {
  const rewardActions: any[] = dungeoneering.actions.filter((a: any) => a.category === 'reward')
  const rewardById = new Map<string, any>(rewardActions.map((a) => [a.id, a]))

  it('has every named reward action', () => {
    for (const id of Object.keys(REWARD_SPECS)) {
      expect(rewardById.has(id), `missing reward action ${id}`).toBe(true)
    }
    expect(rewardActions).toHaveLength(Object.keys(REWARD_SPECS).length)
  })

  it('reward actions match required level/ticks/xp/product', () => {
    for (const [id, spec] of Object.entries(REWARD_SPECS)) {
      const action = rewardById.get(id)
      expect(action, id).toBeDefined()
      expect(action.level, `${id} level`).toBe(spec.level)
      expect(action.ticks, `${id} ticks`).toBe(spec.ticks)
      expect(action.xp, `${id} xp`).toBe(0)
      expect(action.product, `${id} product`).toBe(spec.product)
    }
  })

  it('every reward product exists in items.json', () => {
    for (const action of rewardActions) {
      expect(itemIds.has(action.product), `${action.id} product ${action.product} missing`).toBe(true)
    }
  })
})

describe('dungeoneering: action availability gates', () => {
  const actions = dungeoneering.actions

  it('level 64 cannot access arcane necklace', () => {
    const xp = getXPForLevel(64)
    const ids = new Set(getAvailableActions(actions, xp).map((a: any) => a.id))
    expect(ids.has('unlock_arcane_necklace')).toBe(false)
  })

  it('level 65 unlocks arcane necklace', () => {
    const xp = getXPForLevel(65)
    const ids = new Set(getAvailableActions(actions, xp).map((a: any) => a.id))
    expect(ids.has('unlock_arcane_necklace')).toBe(true)
  })

  it('level 79 cannot access chaotic or shield rewards', () => {
    const xp = getXPForLevel(79)
    const ids = new Set(getAvailableActions(actions, xp).map((a: any) => a.id))
    for (const id of [
      'unlock_chaotic_rapier',
      'unlock_chaotic_longsword',
      'unlock_chaotic_maul',
      'unlock_chaotic_crossbow',
      'unlock_chaotic_staff',
      'unlock_eagle_eyed_kiteshield',
      'unlock_arcane_kiteshield',
    ]) {
      expect(ids.has(id), `${id} should be locked at 79`).toBe(false)
    }
  })

  it('level 80 unlocks all chaotic and shield rewards', () => {
    const xp = getXPForLevel(80)
    const ids = new Set(getAvailableActions(actions, xp).map((a: any) => a.id))
    for (const id of [
      'unlock_chaotic_rapier',
      'unlock_chaotic_longsword',
      'unlock_chaotic_maul',
      'unlock_chaotic_crossbow',
      'unlock_chaotic_staff',
      'unlock_eagle_eyed_kiteshield',
      'unlock_arcane_kiteshield',
    ]) {
      expect(ids.has(id), `${id} should be available at 80`).toBe(true)
    }
  })
})

describe('dungeoneering: reward actions support partial idle progress', () => {
  const rewardAction = (dungeoneering.actions as any[]).find(
    (a) => a.id === 'unlock_chaotic_rapier',
  )
  const arcaneNeck = (dungeoneering.actions as any[]).find(
    (a) => a.id === 'unlock_arcane_necklace',
  )

  it('partial idle reduces ticksRemaining without granting product', () => {
    const task = {
      type: 'skill',
      skill: 'dungeoneering',
      action: rewardAction,
      ticksRemaining: rewardAction.ticks, // 60,000
    }
    const oneHourMs = SKIP_HOUR_MS // 6,000 ticks
    const sim = simulateIdleSkilling(task, oneHourMs, {}, {}, {}, items as any, [])
    expect(sim).not.toBeNull()
    expect(sim!.actions).toBe(0)
    expect(sim!.ticksRemaining).toBe(rewardAction.ticks - 6000)
    expect(sim!.rewardTimeReduced).toBe(true)
    expect(sim!.rewardCompleted).toBe(false)
    expect(Object.keys(sim!.itemsBanked || {})).toHaveLength(0)
  })

  it('completing the action banks the product exactly once', () => {
    const task = {
      type: 'skill',
      skill: 'dungeoneering',
      action: arcaneNeck,
      ticksRemaining: 1000, // about 10 minutes left of a 2.5-hour action
    }
    const oneHourMs = SKIP_HOUR_MS
    const sim = simulateIdleSkilling(task, oneHourMs, {}, {}, {}, items as any, [])
    expect(sim).not.toBeNull()
    expect(sim!.rewardCompleted).toBe(true)
    expect(sim!.rewardTimeReduced).toBe(false)
    expect(sim!.ticksRemaining).toBe(0)
    expect(sim!.actions).toBe(1)
    expect(sim!.itemsBanked).toEqual({ arcane_necklace: 1 })
  })

  it('skip preflight allows reward actions even with no full action completed', () => {
    const task = {
      type: 'skill',
      skill: 'dungeoneering',
      action: rewardAction, // 60,000 ticks — far longer than a 1h skip
    }
    const preflight = getSkipPreflight(task, { itemsData: items as any, inventory: [], bank: {}, equipment: {}, stats: {} }, SKIP_HOUR_MS)
    expect(preflight.canSkip).toBe(true)
    expect(preflight.kind).toBe('skill:reward')
  })

  it('skip preflight blocks reward actions whose ticksRemaining is zero', () => {
    const task = {
      type: 'skill',
      skill: 'dungeoneering',
      action: rewardAction,
      ticksRemaining: 0,
    }
    const preflight = getSkipPreflight(task, { itemsData: items as any, inventory: [], bank: {}, equipment: {}, stats: {} }, SKIP_HOUR_MS)
    expect(preflight.canSkip).toBe(false)
    expect(preflight.shouldStopTask).toBe(true)
  })

  it('isChargeableSkipOutcome accepts partial reward progress and completion', () => {
    const task = { type: 'skill', skill: 'dungeoneering', action: rewardAction }
    expect(isChargeableSkipOutcome(task, { rewardTimeReduced: true })).toBe(true)
    expect(isChargeableSkipOutcome(task, { rewardCompleted: true })).toBe(true)
    expect(isChargeableSkipOutcome(task, {})).toBe(false)
  })
})
