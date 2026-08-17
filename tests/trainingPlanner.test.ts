import { describe, it, expect } from 'vitest'
import { planTraining, plannableSkillIds, compactTrainingPlan } from '../src/engine/trainingPlanner.js'
import { getXPForLevel } from '../src/engine/experience.js'
import skillsData from '../src/data/skills.json'

// The question that exposed the whole gap: a player at 10,765 Prayer XP asking
// how many bones to 77. The helper answered 3,575 by picking big bones for the
// whole early run and ignoring the account type.
const PRAYER_XP = 10_765
const ALL_SKILLS_MAXED = { construction: 99 }
const NO_HOUSE = { construction: 1 }

function segmentIds(plan: any) {
  return plan.segments.map((s: any) => s.actionId)
}

function totalOf(plan: any, itemId: string) {
  return plan.totals.materials.find((m: any) => m.itemId === itemId)?.quantity ?? 0
}

describe('planTraining — prayer to 77', () => {
  it('uses the gilded altar ladder when the player has the house for it', () => {
    const plan = planTraining({ skillId: 'prayer', currentXp: PRAYER_XP, targetLevel: 77, levels: ALL_SKILLS_MAXED })
    // Ashen Hydra Bones (686 XP / 3 ticks ≈ 228.7 XP/tick, unlocked at 70) beats
    // Dagganoth Bones (437 XP / 3 ticks ≈ 145.7 XP/tick) once it's available, so
    // a plan running past level 70 correctly switches to it for the last leg —
    // this is the ladder as authored (#961), not a planner regression.
    expect(segmentIds(plan)).toEqual(['scatter_gargoyle_dust', 'altar_dragon_bones', 'altar_dagganoth_bones', 'altar_ashen_hydra_bones'])
    expect(totalOf(plan, 'gargoyle_dust')).toBe(94)
    expect(totalOf(plan, 'dragon_bones')).toBe(59)
    expect(totalOf(plan, 'nagadoth_bones')).toBe(1603)
    expect(totalOf(plan, 'ashen_hydra_bones')).toBe(1076)
    expect(plan.totals.actions).toBe(2832)
  })

  it('prefers Gargoyle Dust to big bones from level 20 — the bug in the original answer', () => {
    const plan = planTraining({ skillId: 'prayer', currentXp: PRAYER_XP, targetLevel: 77, levels: ALL_SKILLS_MAXED })
    // 125 XP/action beats altar big bones' 52 at the same 3 ticks, so big bones
    // must not appear at all; the helper billed 224 of them.
    expect(segmentIds(plan)).not.toContain('altar_big_bones')
    expect(segmentIds(plan)).not.toContain('bury_big_bones')
    expect(totalOf(plan, 'big_bones')).toBe(0)
  })

  it('reaches at least the target XP', () => {
    const plan = planTraining({ skillId: 'prayer', currentXp: PRAYER_XP, targetLevel: 77, levels: ALL_SKILLS_MAXED })
    const banked = plan.segments.reduce((sum: number, s: any) => sum + s.xpGained, 0)
    expect(PRAYER_XP + banked).toBeGreaterThanOrEqual(getXPForLevel(77))
  })
})

describe('planTraining — account type', () => {
  it('doubles the count for a Grindman, because every gain is halved', () => {
    const normal = planTraining({ skillId: 'prayer', currentXp: PRAYER_XP, targetLevel: 77, levels: ALL_SKILLS_MAXED })
    const grindman = planTraining({ skillId: 'prayer', currentXp: PRAYER_XP, targetLevel: 77, levels: ALL_SKILLS_MAXED, isGrindman: true })
    expect(grindman.accountXpMultiplier).toBe(0.5)
    expect(grindman.totals.actions).toBeGreaterThan(normal.totals.actions * 1.95)
    expect(grindman.totals.actions).toBeLessThanOrEqual(normal.totals.actions * 2 + plan_segmentCount(grindman))
    expect(grindman.notes.join(' ')).toMatch(/Grindman/)
  })

  it('still reaches the target for a Grindman', () => {
    const plan = planTraining({ skillId: 'prayer', currentXp: PRAYER_XP, targetLevel: 77, levels: ALL_SKILLS_MAXED, isGrindman: true })
    const banked = plan.segments.reduce((sum: number, s: any) => sum + s.xpGained, 0)
    expect(PRAYER_XP + banked).toBeGreaterThanOrEqual(getXPForLevel(77))
  })
})

// The batch floor (bankXp floors action.xp * actions, not each action) can save
// at most one action per segment versus flooring per action.
function plan_segmentCount(plan: any) {
  return plan.segments.length
}

describe('planTraining — gates outside the skill', () => {
  it('excludes gilded-altar options without Construction 75 and says why', () => {
    const plan = planTraining({ skillId: 'prayer', currentXp: PRAYER_XP, targetLevel: 77, levels: NO_HOUSE })
    for (const id of segmentIds(plan)) expect(id.startsWith('altar_')).toBe(false)
    expect(plan.blockedOptions.map((b: any) => b.actionId)).toContain('altar_dagganoth_bones')
    expect(plan.blockedOptions[0].reason).toMatch(/Construction 75/)
    expect(plan.notes.join(' ')).toMatch(/Locked options/)
  })

  it('costs materially more without the altar', () => {
    const withAltar = planTraining({ skillId: 'prayer', currentXp: PRAYER_XP, targetLevel: 77, levels: ALL_SKILLS_MAXED })
    const without = planTraining({ skillId: 'prayer', currentXp: PRAYER_XP, targetLevel: 77, levels: NO_HOUSE })
    expect(without.totals.actions).toBeGreaterThan(withAltar.totals.actions)
  })

  it('reads a missing construction level as 1 rather than unlocking the altar', () => {
    const plan = planTraining({ skillId: 'prayer', currentXp: PRAYER_XP, targetLevel: 77 })
    for (const id of segmentIds(plan)) expect(id.startsWith('altar_')).toBe(false)
  })
})

describe('planTraining — objectives', () => {
  it('fewest_items can differ from fastest where ticks and materials disagree', () => {
    const fast = planTraining({ skillId: 'smithing', currentXp: 0, targetLevel: 60, objective: 'fastest' })
    const few = planTraining({ skillId: 'smithing', currentXp: 0, targetLevel: 60, objective: 'fewest_items' })
    expect(fast.objective).toBe('fastest')
    expect(few.objective).toBe('fewest_items')
    const fewUnits = few.totals.materials.reduce((s: number, m: any) => s + m.quantity, 0)
    const fastUnits = fast.totals.materials.reduce((s: number, m: any) => s + m.quantity, 0)
    expect(fewUnits).toBeLessThanOrEqual(fastUnits)
  })
})

describe('planTraining — fewest_items on a skill that consumes nothing', () => {
  // Gathering actions have no materials, so every one scores Infinity under
  // fewest_items. With nothing left to separate them the first-listed (slowest)
  // action won the entire run — 869 hours of shrimps for 99 Fishing.
  it('falls back to speed rather than picking the worst action', () => {
    const fast = planTraining({ skillId: 'fishing', currentXp: 0, targetLevel: 99, objective: 'fastest' })
    const few = planTraining({ skillId: 'fishing', currentXp: 0, targetLevel: 99, objective: 'fewest_items' })
    expect(few.totals.actions).toBe(fast.totals.actions)
    expect(segmentIds(few)).toEqual(segmentIds(fast))
  })

  it('holds for every material-free skill, not just fishing', () => {
    for (const skillId of ['woodcutting', 'mining', 'agility', 'thieving', 'hunter']) {
      const fast = planTraining({ skillId, currentXp: 0, targetLevel: 80, objective: 'fastest' })
      const few = planTraining({ skillId, currentXp: 0, targetLevel: 80, objective: 'fewest_items' })
      expect(few.totals.ticks, skillId).toBe(fast.totals.ticks)
    }
  })
})

describe('planTraining — a ladder that does not start at level 1', () => {
  it("names the level Magic's ladder begins at instead of a dead end", () => {
    const plan = planTraining({ skillId: 'magic', currentXp: 0, targetLevel: 40 })
    expect(plan.error).toBe('NO_OPTION')
    expect(plan.message).toMatch(/below level 7/)
  })

  it('plans magic normally once past the floor', () => {
    const plan = planTraining({ skillId: 'magic', currentXp: getXPForLevel(20), targetLevel: 40 })
    expect(plan.error).toBeUndefined()
    expect(plan.totals.actions).toBeGreaterThan(0)
  })
})

describe('planTraining — action cost comes from the skill, not one field', () => {
  it('reads thieving speed from pickpocketTicks, which is the only tick field npcs have', () => {
    const plan = planTraining({ skillId: 'thieving', currentXp: 0, targetLevel: 99 })
    // Every npc lacks `ticks`; reading it made each one a single tick and
    // quoted ~15h to 99. The real ladder is 4+ ticks a pickpocket.
    expect(plan.totals.ticks).toBeGreaterThanOrEqual(plan.totals.actions * 4)
    expect(plan.totals.hours).toBeGreaterThan(50)
  })

  it('never ranks a slower npc above a faster one paying the same XP', () => {
    const plan = planTraining({ skillId: 'thieving', currentXp: 0, targetLevel: 99 })
    for (const seg of plan.segments) {
      const npc = (skillsData as any).thieving.npcs.find((n: any) => n.id === seg.actionId)
      const rivals = (skillsData as any).thieving.npcs.filter(
        (n: any) => n.level <= seg.fromLevel && n.id !== seg.actionId,
      )
      const chosenRate = npc.xp / (npc.pickpocketTicks || 4)
      for (const rival of rivals) {
        expect(chosenRate).toBeGreaterThanOrEqual(rival.xp / (rival.pickpocketTicks || 4))
      }
    }
  })

  it('counts magic runes, which are declared as runeReq rather than materials', () => {
    const plan = planTraining({ skillId: 'magic', currentXp: getXPForLevel(20), targetLevel: 45 })
    expect(plan.totals.materials.length).toBeGreaterThan(0)
    expect(plan.totals.materials.some((m: any) => m.itemId.endsWith('_rune'))).toBe(true)
  })

  it('counts a tool speed-up toward the time estimate', () => {
    const base = { skillId: 'woodcutting', currentXp: 0, targetLevel: 70 }
    const untooled = planTraining(base)
    const tooled = planTraining({
      ...base,
      gear: { equipment: { weapon: { itemId: 'dragon_axe' } }, inventory: [], stats: { woodcutting: { xp: 13_034_431 } } },
    })
    expect(tooled.totals.ticks).toBeLessThan(untooled.totals.ticks)
  })

  it('leaves skills that use no tool at their listed tick cost', () => {
    // The toolless penalty must not leak onto skills with no tool concept —
    // routing everything through the engine's tool model risks exactly that.
    for (const skillId of ['prayer', 'cooking', 'firemaking', 'herblore', 'crafting', 'smithing']) {
      const plan = planTraining({ skillId, currentXp: 0, targetLevel: 70, levels: ALL_SKILLS_MAXED })
      const raw = plan.segments.reduce((sum: number, seg: any) => {
        const action = (skillsData as any)[skillId].actions.find((a: any) => a.id === seg.actionId)
        return sum + seg.actions * action.ticks
      }, 0)
      expect(plan.totals.ticks, skillId).toBe(raw)
    }
  })

  it('charges the toolless penalty rather than quoting bare tick counts', () => {
    // Mining/woodcutting/fishing without a tool really are
    // NO_TOOL_ACTION_TICK_MULTIPLIER (2x) slower. Clamping that away halved
    // every estimate for the accounts most likely to be asking.
    for (const skillId of ['mining', 'woodcutting', 'fishing']) {
      const plan = planTraining({ skillId, currentXp: 0, targetLevel: 99 })
      const rawTicks = plan.segments.reduce((sum: number, seg: any) => {
        const action = (skillsData as any)[skillId].actions.find((a: any) => a.id === seg.actionId)
        return sum + seg.actions * action.ticks
      }, 0)
      expect(plan.totals.ticks, skillId).toBeGreaterThan(rawTicks)
    }
  })
})

describe('planTraining — ladders outside skills.json', () => {
  it('plans Construction, the skill the gilded-altar gate sends players to', () => {
    expect(plannableSkillIds()).toContain('construction')
    const plan = planTraining({ skillId: 'construction', currentXp: 0, targetLevel: 75 })
    expect(plan.error).toBeUndefined()
    expect(plan.skill).toBe('Construction')
    expect(plan.totals.materials.some((m: any) => m.itemId.endsWith('plank'))).toBe(true)
  })

  it('reaches the level the altar needs', () => {
    const plan = planTraining({ skillId: 'construction', currentXp: 0, targetLevel: 75 })
    const banked = plan.segments.reduce((sum: number, s: any) => sum + s.xpGained, 0)
    expect(banked).toBeGreaterThanOrEqual(getXPForLevel(75))
  })
})

describe('planTraining — reported figures agree with each other', () => {
  it('quotes an xpEach consistent with the segment it belongs to', () => {
    // Burn stepping merges many levels into one segment; xpEach used to be
    // captured at the first level and contradicted xpGained / actions.
    for (const skillId of ['cooking', 'prayer', 'fishing']) {
      const plan = planTraining({ skillId, currentXp: 0, targetLevel: 60, levels: ALL_SKILLS_MAXED })
      for (const seg of plan.segments) {
        expect(seg.xpEach, `${skillId} ${seg.actionId}`).toBeCloseTo(seg.xpGained / seg.actions, 1)
      }
    }
  })

  it('totals match the sum of the segments', () => {
    const plan = planTraining({ skillId: 'cooking', currentXp: 0, targetLevel: 70 })
    expect(plan.totals.actions).toBe(plan.segments.reduce((s: number, x: any) => s + x.actions, 0))
    expect(plan.totals.ticks).toBe(plan.segments.reduce((s: number, x: any) => s + x.ticks, 0))
  })
})

describe('planTraining — cooking burn', () => {
  it('charges for burnt food: more raws than the XP alone implies', () => {
    const plan = planTraining({ skillId: 'cooking', currentXp: 0, targetLevel: 30 })
    expect(plan.notes.join(' ')).toMatch(/burnt food/i)
    const first = plan.segments[0]
    const recipe = (skillsData as any).cooking.actions.find((a: any) => a.id === first.actionId)
    // Naive count ignoring burn; the plan must need strictly more than that.
    const naive = Math.ceil((getXPForLevel(first.toLevel) - 0) / recipe.xp)
    expect(first.actions).toBeGreaterThan(naive)
  })
})

describe('planTraining — owned materials', () => {
  it('reports what the player already has and what they are short', () => {
    const plan = planTraining({
      skillId: 'prayer',
      currentXp: PRAYER_XP,
      targetLevel: 77,
      levels: ALL_SKILLS_MAXED,
      owned: { nagadoth_bones: 1000, gargoyle_dust: 500 },
    })
    const naga = plan.totals.materials.find((m: any) => m.itemId === 'nagadoth_bones')
    expect(naga.owned).toBe(1000)
    expect(naga.short).toBe(naga.quantity - 1000)
    const dust = plan.totals.materials.find((m: any) => m.itemId === 'gargoyle_dust')
    // Owned exceeds the requirement — short must clamp at 0, never go negative.
    expect(dust.short).toBe(0)
  })
})

describe('planTraining — ties break toward what the player owns', () => {
  // From level 40 both bury_dagganoth_bones and scatter_gargoyle_dust pay 125 XP
  // over 3 ticks. Nothing separates them but their order in skills.json, so the
  // player's own stock is the only non-arbitrary tiebreak.
  const base = { skillId: 'prayer', currentXp: getXPForLevel(40), targetLevel: 50, levels: NO_HOUSE }

  it('picks the listed-first option when the player owns neither', () => {
    const plan = planTraining(base)
    expect(segmentIds(plan)).toEqual(['bury_dagganoth_bones'])
  })

  it('picks the equal-XP option the player already has in the bank', () => {
    const plan = planTraining({ ...base, owned: { gargoyle_dust: 50_000 } })
    expect(segmentIds(plan)).toEqual(['scatter_gargoyle_dust'])
  })

  it('never lets owning something beat a strictly better option', () => {
    // Owning big bones must not drag the plan down to 52 XP a go.
    const plan = planTraining({ ...base, owned: { big_bones: 50_000 } })
    expect(segmentIds(plan)).not.toContain('bury_big_bones')
    expect(segmentIds(plan)).toEqual(['bury_dagganoth_bones'])
  })
})

describe('planTraining — refusals', () => {
  it('refuses a skill with no repeatable ladder rather than returning an empty plan', () => {
    const plan = planTraining({ skillId: 'farming', currentXp: 0, targetLevel: 50 })
    expect(plan.error).toBe('NO_LADDER')
    expect(plan.message).toMatch(/not trained by repeating an action/)
  })

  it('refuses an unknown skill and lists the ones it can plan', () => {
    const plan = planTraining({ skillId: 'slayer', currentXp: 0, targetLevel: 50 })
    expect(plan.error).toBe('UNKNOWN_SKILL')
    expect(plan.message).toMatch(/prayer/)
  })

  it('returns alreadyThere when the target is behind the player', () => {
    const plan = planTraining({ skillId: 'prayer', currentXp: PRAYER_XP, targetLevel: 10 })
    expect(plan.alreadyThere).toBe(true)
    expect(plan.totals.actions).toBe(0)
  })

  it('only advertises skills that actually have a ladder', () => {
    expect(plannableSkillIds()).toContain('prayer')
    expect(plannableSkillIds()).not.toContain('farming')
  })
})

describe('compactTrainingPlan — the payload must never be truncated mid-JSON', () => {
  const BUDGET = 5600

  // The MCP layer emits indent-2, which runs ~1.6x the compact length. Budget
  // against the compact form and the real payload sails past the slice.
  const pretty = (p: any) => JSON.stringify(p, null, 2)

  it('brings every skill 1 to 99 inside the budget as the tool actually serialises it', () => {
    for (const skillId of plannableSkillIds()) {
      const plan = planTraining({ skillId, currentXp: 0, targetLevel: 99, levels: ALL_SKILLS_MAXED })
      if (plan.error) continue
      const compact = compactTrainingPlan({ characterId: 7, ...plan }, BUDGET, pretty)
      expect(pretty(compact).length, skillId).toBeLessThanOrEqual(BUDGET)
    }
  })

  it('keeps the totals — they are the answer — and says what it dropped', () => {
    // Herblore is the worst case (13 segments over 26 materials) and now fits,
    // so the shedding itself is driven with a budget it cannot possibly meet.
    const plan = planTraining({ skillId: 'herblore', currentXp: 0, targetLevel: 99 })
    const compact = compactTrainingPlan({ characterId: 7, ...plan }, 1500)
    expect(compact.totals.materials).toEqual(plan.totals.materials)
    expect(compact.totals.actions).toBe(plan.totals.actions)
    expect(compact.notes.join(' ')).toMatch(/Trimmed to fit/)
    // Totals are never shed, so an impossible budget sheds everything else and
    // stops — best effort down to an irreducible core, never a broken answer.
    expect(compact.segments.length).toBeLessThanOrEqual(6)
    expect(compact.segments[0].ticks).toBeUndefined()
    expect(compact.segments[0].materials).toBeUndefined()
  })

  it('sheds in order, keeping whole segments before per-segment detail', () => {
    const plan = planTraining({ skillId: 'herblore', currentXp: 0, targetLevel: 99 })
    const justOver = JSON.stringify({ characterId: 7, ...plan }).length - 200
    const compact = compactTrainingPlan({ characterId: 7, ...plan }, justOver)
    // First shed is the material split; every segment survives it.
    expect(compact.segments).toHaveLength(plan.segments.length)
    expect(compact.segments[0].materials).toBeUndefined()
    expect(compact.segments[0].actions).toBe(plan.segments[0].actions)
  })

  it('leaves a plan that already fits completely untouched', () => {
    const plan = planTraining({ skillId: 'prayer', currentXp: PRAYER_XP, targetLevel: 77, levels: ALL_SKILLS_MAXED })
    expect(compactTrainingPlan(plan, BUDGET)).toBe(plan)
  })

  it('passes an error payload straight through', () => {
    const plan = planTraining({ skillId: 'farming', currentXp: 0, targetLevel: 50 })
    expect(compactTrainingPlan(plan, 10)).toBe(plan)
  })
})

describe('planTraining — bounded', () => {
  it('plans 1 to 99 for every plannable skill without running away', () => {
    for (const skillId of plannableSkillIds()) {
      const plan = planTraining({ skillId, currentXp: 0, targetLevel: 99, levels: ALL_SKILLS_MAXED })
      if (plan.error) continue
      expect(plan.segments.length).toBeLessThanOrEqual(99)
      const banked = plan.segments.reduce((sum: number, s: any) => sum + s.xpGained, 0)
      expect(banked).toBeGreaterThanOrEqual(getXPForLevel(99))
    }
  })
})
