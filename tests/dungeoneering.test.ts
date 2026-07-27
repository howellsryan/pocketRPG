import { describe, it, expect } from 'vitest'
import skills from '../src/data/skills.json'
import items from '../src/data/items.json'
import { ALL_SKILLS, SKILL_ICONS, STUB_SKILLS, UTILITY_SKILLS } from '../src/utils/constants.js'
import { getAvailableActions } from '../src/engine/skilling.js'
import { getXPForLevel } from '../src/engine/experience.js'

const dungeoneering = (skills as Record<string, any>).dungeoneering
const itemIds = new Set(Object.keys(items as Record<string, any>))

const REWARD_SPECS: Record<string, { level: number; product: string; tokenCost: number }> = {
  unlock_chaotic_rapier:        { level: 80, product: 'chaotic_rapier', tokenCost: 1000000 },
  unlock_chaotic_longsword:     { level: 80, product: 'chaotic_longsword', tokenCost: 1000000 },
  unlock_chaotic_maul:          { level: 80, product: 'chaotic_maul', tokenCost: 1000000 },
  unlock_chaotic_crossbow:      { level: 80, product: 'chaotic_crossbow', tokenCost: 1000000 },
  unlock_chaotic_staff:         { level: 80, product: 'chaotic_staff', tokenCost: 1000000 },
  unlock_eagle_eyed_kiteshield: { level: 80, product: 'eagle_eyed_kiteshield', tokenCost: 300000 },
  unlock_arcane_kiteshield:     { level: 80, product: 'arcane_kiteshield', tokenCost: 300000 },
  unlock_arcane_necklace:       { level: 65, product: 'arcane_necklace', tokenCost: 65000 },
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

  it('reward actions match required level/xp/product/tokenCost', () => {
    for (const [id, spec] of Object.entries(REWARD_SPECS)) {
      const action = rewardById.get(id)
      expect(action, id).toBeDefined()
      expect(action.level, `${id} level`).toBe(spec.level)
      expect(action.xp, `${id} xp`).toBe(0)
      expect(action.product, `${id} product`).toBe(spec.product)
      expect(action.tokenCost, `${id} tokenCost`).toBe(spec.tokenCost)
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
