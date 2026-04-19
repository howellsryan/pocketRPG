import { describe, it, expect } from 'vitest'
import {
  QUEST_STATUS,
  countItemHeld,
  isPrereqMet,
  areRequirementsMet,
  getObjectiveProgress,
  areObjectivesComplete,
  getQuestStatus,
  canStartQuest,
  canCompleteQuest,
  consumeDeliverables,
  getQuestPoints,
} from '../src/engine/quests.js'
import { getXPForLevel } from '../src/engine/experience.js'

// Helper: craft a stats object at a given level for a given skill
const atLevel = (skill: string, level: number) => ({
  [skill]: { skill, xp: getXPForLevel(level), level }
})

const emptyInv = () => new Array(28).fill(null)

describe('Quest Engine', () => {
  describe('countItemHeld', () => {
    it('counts items in bank only', () => {
      const bank = { feathers: { itemId: 'feathers', quantity: 40 } }
      expect(countItemHeld('feathers', bank, emptyInv())).toBe(40)
    })

    it('sums bank + inventory', () => {
      const bank = { bones: { itemId: 'bones', quantity: 20 } }
      const inv = emptyInv()
      inv[0] = { itemId: 'bones', quantity: 15 }
      inv[5] = { itemId: 'bones', quantity: 5 }
      expect(countItemHeld('bones', bank, inv)).toBe(40)
    })

    it('ignores noted inventory stacks (cannot be delivered)', () => {
      const inv = emptyInv()
      inv[0] = { itemId: 'clay', quantity: 10, noted: true }
      expect(countItemHeld('clay', {}, inv)).toBe(0)
    })

    it('returns 0 for missing items', () => {
      expect(countItemHeld('nope', {}, emptyInv())).toBe(0)
    })
  })

  describe('isPrereqMet', () => {
    it('returns true when quest has no prereqs', () => {
      expect(isPrereqMet({ prerequisites: [] }, {})).toBe(true)
      expect(isPrereqMet({}, {})).toBe(true)
    })

    it('returns true only when every prereq is completed', () => {
      const quest = { prerequisites: ['q1', 'q2'] }
      expect(isPrereqMet(quest, {})).toBe(false)
      expect(isPrereqMet(quest, { q1: QUEST_STATUS.COMPLETED })).toBe(false)
      expect(isPrereqMet(quest, {
        q1: QUEST_STATUS.COMPLETED,
        q2: QUEST_STATUS.COMPLETED
      })).toBe(true)
    })

    it('in_progress prereq does not count as met', () => {
      const quest = { prerequisites: ['q1'] }
      expect(isPrereqMet(quest, { q1: QUEST_STATUS.IN_PROGRESS })).toBe(false)
    })
  })

  describe('areRequirementsMet', () => {
    it('returns true when no requirements present', () => {
      expect(areRequirementsMet({}, { stats: {}, bank: {}, inventory: emptyInv() })).toBe(true)
    })

    it('checks skill levels via XP', () => {
      const quest = { requirements: { skills: [{ skill: 'attack', level: 20 }] } }
      expect(areRequirementsMet(quest, { stats: atLevel('attack', 19), bank: {}, inventory: emptyInv() })).toBe(false)
      expect(areRequirementsMet(quest, { stats: atLevel('attack', 20), bank: {}, inventory: emptyInv() })).toBe(true)
      expect(areRequirementsMet(quest, { stats: atLevel('attack', 50), bank: {}, inventory: emptyInv() })).toBe(true)
    })

    it('checks required held items', () => {
      const quest = { requirements: { items: [{ itemId: 'anti_dragon_shield', quantity: 1 }] } }
      expect(areRequirementsMet(quest, { stats: {}, bank: {}, inventory: emptyInv() })).toBe(false)
      expect(areRequirementsMet(quest, {
        stats: {},
        bank: { anti_dragon_shield: { itemId: 'anti_dragon_shield', quantity: 1 } },
        inventory: emptyInv()
      })).toBe(true)
    })
  })

  describe('getObjectiveProgress', () => {
    it('deliver objective tracks bank+inventory totals', () => {
      const obj = { type: 'deliver', itemId: 'bones', quantity: 50 }
      const ctx = {
        bank: { bones: { itemId: 'bones', quantity: 30 } },
        inventory: (() => { const i = emptyInv(); i[0] = { itemId: 'bones', quantity: 15 }; return i })()
      }
      const progress = getObjectiveProgress(obj, ctx as any)
      expect(progress).toEqual({ current: 45, required: 50, done: false })

      ctx.bank.bones.quantity = 60
      const progress2 = getObjectiveProgress(obj, ctx as any)
      expect(progress2.done).toBe(true)
      expect(progress2.current).toBe(50) // capped at required
    })

    it('kill objective uses per-quest delta, not absolute total', () => {
      const obj = { type: 'kill', monsterId: 'goblin', quantity: 10 }
      // 100 total kills lifetime, but only 5 since quest started
      const ctx = {
        monsterKillCounts: { goblin: 100 },
        killProgress: { goblin: 5 }
      }
      const progress = getObjectiveProgress(obj, ctx as any)
      expect(progress.done).toBe(false)
      expect(progress.current).toBe(5)

      ctx.killProgress.goblin = 10
      expect(getObjectiveProgress(obj, ctx as any).done).toBe(true)
      ctx.killProgress.goblin = 25
      const p3 = getObjectiveProgress(obj, ctx as any)
      expect(p3.done).toBe(true)
      expect(p3.current).toBe(10) // capped
    })

    it('level objective reads skill level from XP', () => {
      const obj = { type: 'level', skill: 'strength', level: 50 }
      expect(getObjectiveProgress(obj, { stats: atLevel('strength', 49) } as any).done).toBe(false)
      expect(getObjectiveProgress(obj, { stats: atLevel('strength', 50) } as any).done).toBe(true)
    })
  })

  describe('getQuestStatus', () => {
    const quest = {
      id: 'q1',
      prerequisites: [],
      requirements: { skills: [{ skill: 'attack', level: 10 }] },
      objectives: [{ type: 'deliver', itemId: 'bones', quantity: 1 }]
    }

    it('locked when requirements not met', () => {
      const ctx = { stats: atLevel('attack', 5), bank: {}, inventory: emptyInv() }
      expect(getQuestStatus(quest, {}, ctx)).toBe(QUEST_STATUS.LOCKED)
    })

    it('available when requirements met and not started', () => {
      const ctx = { stats: atLevel('attack', 10), bank: {}, inventory: emptyInv() }
      expect(getQuestStatus(quest, {}, ctx)).toBe(QUEST_STATUS.AVAILABLE)
    })

    it('in_progress persists regardless of requirement drops', () => {
      const ctx = { stats: atLevel('attack', 1), bank: {}, inventory: emptyInv() }
      expect(getQuestStatus(quest, { q1: QUEST_STATUS.IN_PROGRESS }, ctx)).toBe(QUEST_STATUS.IN_PROGRESS)
    })

    it('completed status is sticky', () => {
      const ctx = { stats: {}, bank: {}, inventory: emptyInv() }
      expect(getQuestStatus(quest, { q1: QUEST_STATUS.COMPLETED }, ctx)).toBe(QUEST_STATUS.COMPLETED)
    })
  })

  describe('canCompleteQuest', () => {
    const quest = {
      id: 'q1',
      prerequisites: [],
      objectives: [
        { type: 'deliver', itemId: 'bones', quantity: 2 },
        { type: 'kill',    monsterId: 'goblin', quantity: 3 }
      ]
    }

    it('requires in_progress status', () => {
      const ctx = {
        stats: {}, bank: { bones: { itemId: 'bones', quantity: 5 } },
        inventory: emptyInv(), monsterKillCounts: {}, killProgress: { goblin: 5 }
      }
      expect(canCompleteQuest(quest, {}, ctx)).toBe(false)
      expect(canCompleteQuest(quest, { q1: QUEST_STATUS.IN_PROGRESS }, ctx)).toBe(true)
      expect(canCompleteQuest(quest, { q1: QUEST_STATUS.COMPLETED }, ctx)).toBe(false)
    })

    it('fails if any objective is incomplete', () => {
      const states = { q1: QUEST_STATUS.IN_PROGRESS }
      const ctx = {
        stats: {}, bank: { bones: { itemId: 'bones', quantity: 1 } },
        inventory: emptyInv(), monsterKillCounts: {}, killProgress: { goblin: 5 }
      }
      expect(canCompleteQuest(quest, states, ctx)).toBe(false)
    })
  })

  describe('consumeDeliverables', () => {
    it('consumes from bank first, then inventory', () => {
      const quest = { objectives: [{ type: 'deliver', itemId: 'bones', quantity: 5 }] }
      const bank = { bones: { itemId: 'bones', quantity: 3 } }
      const inv = emptyInv()
      inv[0] = { itemId: 'bones', quantity: 4 }
      const out = consumeDeliverables(quest, bank, inv)
      // Bank fully drained, inventory lost 2
      expect(out.bank.bones).toBeUndefined()
      expect(out.inventory[0]).toEqual({ itemId: 'bones', quantity: 2 })
    })

    it('does not mutate the input bank/inventory', () => {
      const quest = { objectives: [{ type: 'deliver', itemId: 'clay', quantity: 1 }] }
      const bank = { clay: { itemId: 'clay', quantity: 3 } }
      const inv = emptyInv()
      consumeDeliverables(quest, bank, inv)
      expect(bank.clay.quantity).toBe(3)
    })

    it('skips non-deliver objectives', () => {
      const quest = { objectives: [{ type: 'kill', monsterId: 'goblin', quantity: 10 }] }
      const bank = { bones: { itemId: 'bones', quantity: 3 } }
      const out = consumeDeliverables(quest, bank, emptyInv())
      expect(out.bank.bones.quantity).toBe(3)
    })

    it('leaves noted stacks untouched', () => {
      const quest = { objectives: [{ type: 'deliver', itemId: 'bones', quantity: 2 }] }
      const inv = emptyInv()
      inv[0] = { itemId: 'bones', quantity: 5, noted: true }
      inv[1] = { itemId: 'bones', quantity: 3 }
      const out = consumeDeliverables(quest, {}, inv)
      expect(out.inventory[0]).toEqual({ itemId: 'bones', quantity: 5, noted: true })
      expect(out.inventory[1]).toEqual({ itemId: 'bones', quantity: 1 })
    })
  })

  describe('getQuestPoints', () => {
    const data = {
      a: { rewards: { questPoints: 1 } },
      b: { rewards: { questPoints: 3 } },
      c: { rewards: { questPoints: 5 } },
      d: { rewards: {} }
    }
    it('sums only completed quests', () => {
      expect(getQuestPoints({
        a: QUEST_STATUS.COMPLETED,
        b: QUEST_STATUS.IN_PROGRESS,
        c: QUEST_STATUS.COMPLETED
      }, data)).toBe(6)
    })
    it('ignores unknown / missing rewards', () => {
      expect(getQuestPoints({ d: QUEST_STATUS.COMPLETED, x: QUEST_STATUS.COMPLETED }, data)).toBe(0)
    })
  })
})
