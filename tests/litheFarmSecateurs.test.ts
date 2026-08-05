import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  initFarmingState,
  getCropDef,
  plantCrop,
  harvestCrop,
  herbYieldMultiplier,
} from '../src/engine/farming.ts'
import {
  minigameRequirements,
  minigameRequirementLabel,
  minigameRequirementsLabel,
  minigameRequirementShortLabel,
  unmetMinigameRequirements,
} from '../src/engine/minigameGates.js'
import { activityLevelRequirements, activityLockReason } from '../src/engine/worldContent.js'
import { isEquippable, isSkillingTool, typeFilterOf, describeObtainment } from '../src/utils/armoury.js'
import { hasPositiveCombatBonus } from '../src/utils/armoury.js'
import { getXPForLevel } from '../src/engine/experience.js'
import { OTHER_BONUS_LABELS, OTHER_BONUS_PERCENT_KEYS } from '../src/utils/bonusLabels.js'
import items from '../src/data/items.json'
import minigames from '../src/data/minigames.json'
import collectionLog from '../src/data/collectionLog.json'
import worldActivities from '../src/data/worldActivities.json'

const itemsData = items as Record<string, any>
const SECATEURS = { weapon: { itemId: 'magic_secateurs' } }

describe('Magic Secateurs item', () => {
  const item = itemsData.magic_secateurs

  it('is an equippable, statless skilling tool', () => {
    expect(isEquippable(item)).toBe(true)
    expect(item.slot).toBe('weapon')
    expect(hasPositiveCombatBonus(item)).toBe(false)
    expect(item.attackBonus).toEqual({ stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 })
    expect(item.defenceBonus).toEqual({ stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 })
    expect(item.requirements).toEqual({})
    expect(isSkillingTool(item)).toBe(true)
    expect(typeFilterOf(item)).toBe('skilling')
  })

  it('grants a 100% herb yield bonus and is priced as a 2h untradeable minigame reward', () => {
    expect(item.otherBonus.herbYieldPercent).toBe(100)
    expect(item.isUntradeable).toBe(true)
    expect(item.shopValue).toBe(250_000 * 2)
  })

  it('labels its herb bonus as a percentage in the equipment stat display', () => {
    expect(OTHER_BONUS_LABELS.herbYieldPercent).toBeTruthy()
    expect(OTHER_BONUS_PERCENT_KEYS.has('herbYieldPercent')).toBe(true)
  })

  it('reports Lithe Farm as its source in the Armoury', () => {
    expect(describeObtainment(itemsData.magic_secateurs)).toContain('Earned from Lithe Farm')
  })
})

describe('herbYieldMultiplier', () => {
  it('doubles only for a wielded herb-yield tool', () => {
    expect(herbYieldMultiplier(SECATEURS, itemsData)).toBe(2)
    expect(herbYieldMultiplier({ weapon: { itemId: 'dragon_axe' } }, itemsData)).toBe(1)
    expect(herbYieldMultiplier({}, itemsData)).toBe(1)
    expect(herbYieldMultiplier(null, itemsData)).toBe(1)
  })

  it('is 1 when the secateurs are only carried, never wielded', () => {
    expect(herbYieldMultiplier({ shield: { itemId: 'magic_secateurs' } } as any, itemsData)).toBe(1)
  })
})

describe('harvestCrop herb yield with secateurs', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  const readyHerb = () => {
    const planted = plantCrop(initFarmingState(), 'falador_herb_0', 'greenthorn_seed', 'herb')!
    vi.advanceTimersByTime(getCropDef('greenthorn_seed')!.growthTimeMs + 1)
    return planted.state
  }

  it('doubles the lowest herb roll (5 -> 10)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(harvestCrop(readyHerb(), 'falador_herb_0', 99)!.quantity).toBe(5)
    expect(harvestCrop(readyHerb(), 'falador_herb_0', 99, 2)!.quantity).toBe(10)
  })

  it('doubles the highest herb roll at 99 (15 -> 30)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999)
    expect(harvestCrop(readyHerb(), 'falador_herb_0', 99)!.quantity).toBe(15)
    expect(harvestCrop(readyHerb(), 'falador_herb_0', 99, 2)!.quantity).toBe(30)
  })

  // Herb XP is `floor(harvestXp * quantity)` — floored once, over the doubled
  // quantity, so it tracks the bigger harvest rather than twice a floored half.
  it('scales the herb XP with the doubled quantity', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const perCrop = getCropDef('greenthorn_seed')!.harvestXp
    const base = harvestCrop(readyHerb(), 'falador_herb_0', 50)!
    const boosted = harvestCrop(readyHerb(), 'falador_herb_0', 50, 2)!
    expect(boosted.quantity).toBe(base.quantity * 2)
    expect(boosted.harvestXp).toBe(Math.floor(perCrop * boosted.quantity))
    expect(boosted.harvestXp).toBeGreaterThanOrEqual(base.harvestXp * 2)
  })

  it('leaves trees, fruit trees and vegetables untouched', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    for (const [patchId, seedId, type] of [
      ['falador_tree_0', 'oak_sapling', 'tree'],
      ['catherby_fruitTree_0', 'apple_sapling', 'fruitTree'],
      ['falador_vegetable_0', 'potato_seed', 'vegetable'],
    ] as const) {
      const seeded = plantCrop(initFarmingState(), patchId, seedId, type)!
      vi.advanceTimersByTime(getCropDef(seedId)!.growthTimeMs + 1)
      const base = harvestCrop(seeded.state, patchId, 99)!
      const boosted = harvestCrop(seeded.state, patchId, 99, 2)!
      expect(boosted.quantity).toBe(base.quantity)
    }
  })

  it('never shrinks a harvest for a multiplier below 1', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(harvestCrop(readyHerb(), 'falador_herb_0', 99, 0)!.quantity).toBe(5)
  })
})

describe('Lithe Farm minigame gate', () => {
  const at = (farming: number, herblore: number) => (skill: string) =>
    ({ farming, herblore } as Record<string, number>)[skill] ?? 99

  it('requires both Farming 50 and Herblore 50', () => {
    expect(minigameRequirements('lithe_farm')).toEqual([
      { skill: 'farming', level: 50 },
      { skill: 'herblore', level: 50 },
    ])
  })

  it('fails on either skill alone and passes only with both', () => {
    expect(unmetMinigameRequirements('lithe_farm', at(49, 99))).toEqual([{ skill: 'farming', level: 50 }])
    expect(unmetMinigameRequirements('lithe_farm', at(99, 49))).toEqual([{ skill: 'herblore', level: 50 }])
    expect(unmetMinigameRequirements('lithe_farm', at(50, 50))).toEqual([])
  })

  it('gates every task in the section, not just one', () => {
    const tasks = minigames.tasks.filter((t: any) => t.minigame === 'lithe_farm')
    expect(tasks.length).toBeGreaterThan(0)
    for (const task of tasks) {
      expect(unmetMinigameRequirements((task as any).minigame, at(49, 49))).toHaveLength(2)
    }
  })

  it('still reads a legacy single-skill `req` section', () => {
    expect(minigameRequirements('arcane_proving_grounds')).toEqual([{ skill: 'magic', level: 50 }])
    expect(unmetMinigameRequirements('arcane_proving_grounds', at(99, 99))).toEqual([])
  })

  it('returns nothing for an ungated or unknown minigame', () => {
    expect(minigameRequirements('castle_wars')).toEqual([])
    expect(minigameRequirements('no_such_minigame')).toEqual([])
    expect(unmetMinigameRequirements('no_such_minigame', at(1, 1))).toEqual([])
  })

  it('names EVERY outstanding requirement, not just the first', () => {
    expect(unmetMinigameRequirements('lithe_farm', at(49, 49))).toEqual([
      { skill: 'farming', level: 50 },
      { skill: 'herblore', level: 50 },
    ])
    expect(unmetMinigameRequirements('lithe_farm', at(50, 49))).toEqual([{ skill: 'herblore', level: 50 }])
    expect(unmetMinigameRequirements('lithe_farm', at(50, 50))).toEqual([])
  })

  it('labels a requirement in prose and compact form', () => {
    const req = { skill: 'herblore', level: 50 }
    expect(minigameRequirementLabel(req)).toBe('Herblore level 50')
    expect(minigameRequirementShortLabel(req)).toBe('Herblore 50')
  })

  it('joins several outstanding requirements into one sentence', () => {
    expect(minigameRequirementsLabel(unmetMinigameRequirements('lithe_farm', at(49, 49))))
      .toBe('Farming level 50 and Herblore level 50')
    expect(minigameRequirementsLabel(unmetMinigameRequirements('lithe_farm', at(50, 49))))
      .toBe('Herblore level 50')
    expect(minigameRequirementsLabel([])).toBe('')
  })
})

describe('Lithe Farm on the world map', () => {
  const statsAt = (farming: number, herblore: number) => ({
    farming: { xp: getXPForLevel(farming) },
    herblore: { xp: getXPForLevel(herblore) },
  })

  it('surfaces both requirements to the activity gate', () => {
    expect(activityLevelRequirements('minigame', 'lithe_farm')).toEqual([
      { skill: 'farming', level: 50 },
      { skill: 'herblore', level: 50 },
    ])
  })

  it('locks the world-map row on the second requirement too', () => {
    expect(activityLockReason('minigame', 'lithe_farm', { stats: statsAt(50, 49) }))
      .toEqual({ reason: 'Requires Herblore level 50' })
    expect(activityLockReason('minigame', 'lithe_farm', { stats: statsAt(49, 50) }))
      .toEqual({ reason: 'Requires Farming level 50' })
    expect(activityLockReason('minigame', 'lithe_farm', { stats: statsAt(50, 50) })).toBeNull()
  })

  it('is offered at Seerhold, the farm place that hosts it', () => {
    const refs = (worldActivities as Record<string, any[]>).seerhold
      .filter(a => a.kind === 'minigame').map(a => a.ref)
    expect(refs).toContain('lithe_farm')
  })
})

describe('Lithe Farm content wiring', () => {
  it('grants the Magic Secateurs from a single 2-hour one-shot task', () => {
    const task = minigames.tasks.find((t: any) => t.id === 'lf_magic_secateurs')! as any
    expect(task.minigame).toBe('lithe_farm')
    expect(task.hours).toBe(2)
    expect(task.ticks).toBe(2 * 60 * 60 * 1000 / 600)
    expect(task.product).toBe('magic_secateurs')
    expect(task.oneShot).toBe(true)
    expect((minigames as any).itemNames.magic_secateurs).toBe('Magic Secateurs')
  })

  it('has a collection log slot under the minigames category', () => {
    const cat = (collectionLog as any).categories.find((c: any) => c.id === 'minigames')
    const section = cat.sections.find((s: any) => s.id === 'lithe_farm')
    expect(section.items).toContain('magic_secateurs')
  })
})
