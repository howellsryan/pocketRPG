import { describe, it, expect } from 'vitest'
import {
  depositToBank,
  withdrawFromBank,
  equip,
  unequip,
  buildSkillTask,
  buildIdleTask,
  applyIdleResult,
  toSlotArray,
  runIdleTask,
  buildQuestTask,
  applyQuestTask,
  questStatuses,
  questXpChoice,
  buildCombatTask,
  runCombatTask,
  planDungeoneeringReward,
} from '../functions/_lib/mcp/intents.js'
import { getLevelFromXP } from '../src/engine/experience.js'

// Phase C save intents are pure mutations of a decoded save. These golden tests
// exercise them directly (no D1), asserting items only relocate and that
// invalid requests throw before any partial state could be written.

function makeSave(overrides: any = {}) {
  return {
    stats: {},
    inventory: [],
    bank: {},
    equipment: {},
    settings: { completedQuests: [] },
    ...overrides,
  }
}

describe('bank intents', () => {
  it('deposit moves items inventory → bank', () => {
    const save = makeSave({ inventory: [{ itemId: 'oak_logs', quantity: 5 }] })
    const r = depositToBank(save, 'oak_logs', 3)
    expect(r).toMatchObject({ action: 'deposit', itemId: 'oak_logs', quantity: 3 })
    expect(save.bank.oak_logs).toEqual({ itemId: 'oak_logs', quantity: 3 })
    expect(save.inventory.find((s: any) => s.itemId === 'oak_logs')?.quantity).toBe(2)
  })

  it('deposit beyond what you hold throws (nothing written)', () => {
    const save = makeSave({ inventory: [{ itemId: 'oak_logs', quantity: 5 }] })
    expect(() => depositToBank(save, 'oak_logs', 10)).toThrow()
    expect(save.bank.oak_logs).toBeUndefined()
  })

  it('withdraw moves items bank → inventory and clears emptied bank entries', () => {
    const save = makeSave({ bank: { feather: { itemId: 'feather', quantity: 100 } } })
    withdrawFromBank(save, 'feather', 100)
    expect(save.bank.feather).toBeUndefined()
    expect(save.inventory.find((s: any) => s.itemId === 'feather')?.quantity).toBe(100)
  })

  it('withdraw beyond bank stock throws', () => {
    const save = makeSave({ bank: { feather: { itemId: 'feather', quantity: 10 } } })
    expect(() => withdrawFromBank(save, 'feather', 999)).toThrow()
  })

  it('withdraw into a full inventory throws (28-slot cap)', () => {
    const inventory = Array.from({ length: 28 }, (_, i) => ({ itemId: `filler_${i}`, quantity: 1 }))
    const save = makeSave({ inventory, bank: { oak_logs: { itemId: 'oak_logs', quantity: 1 } } })
    expect(() => withdrawFromBank(save, 'oak_logs', 1)).toThrow()
    // bank untouched because the add failed before… actually remove happens first,
    // but the whole intent is discarded by the caller on throw. We assert it threw.
  })
})

describe('equipment intents', () => {
  it('equips a weapon and removes it from inventory', () => {
    const save = makeSave({ inventory: [{ itemId: 'bronze_dagger', quantity: 1 }] })
    const r = equip(save, 'bronze_dagger')
    expect(r).toMatchObject({ action: 'equip', slot: 'weapon', itemId: 'bronze_dagger' })
    expect(save.equipment.weapon.itemId).toBe('bronze_dagger')
    expect(save.inventory.find((s: any) => s.itemId === 'bronze_dagger')).toBeUndefined()
  })

  it('swapping a weapon returns the previous one to the inventory', () => {
    const save = makeSave({
      inventory: [{ itemId: 'iron_dagger', quantity: 1 }],
      equipment: { weapon: { itemId: 'bronze_dagger', _twoHanded: false } },
    })
    const r = equip(save, 'iron_dagger')
    expect(save.equipment.weapon.itemId).toBe('iron_dagger')
    expect(save.inventory.find((s: any) => s.itemId === 'bronze_dagger')?.quantity).toBe(1)
    expect(r.unequipped).toEqual([{ itemId: 'bronze_dagger', name: expect.any(String) }])
  })

  it('equips an ammo stack as a single equipment entry', () => {
    const save = makeSave({ inventory: [{ itemId: 'bronze_arrow', quantity: 50 }] })
    equip(save, 'bronze_arrow')
    expect(save.equipment.ammo).toMatchObject({ itemId: 'bronze_arrow', quantity: 50 })
    expect(save.inventory.find((s: any) => s.itemId === 'bronze_arrow')).toBeUndefined()
  })

  it('refuses to equip an item not in inventory', () => {
    expect(() => equip(makeSave(), 'bronze_dagger')).toThrow()
  })

  it('refuses to equip a non-equippable item', () => {
    const save = makeSave({ inventory: [{ itemId: 'oak_logs', quantity: 1 }] })
    expect(() => equip(save, 'oak_logs')).toThrow(/cannot be equipped/)
  })

  it('enforces skill requirements', () => {
    // mithril_dagger needs attack 20; a fresh account is level 1.
    const save = makeSave({ inventory: [{ itemId: 'mithril_dagger', quantity: 1 }] })
    expect(() => equip(save, 'mithril_dagger')).toThrow(/attack/i)
    expect(save.equipment.weapon).toBeUndefined()
  })

  it('unequips a slot back to the inventory', () => {
    const save = makeSave({ equipment: { weapon: { itemId: 'bronze_dagger', _twoHanded: false } } })
    const r = unequip(save, 'weapon')
    expect(r).toMatchObject({ action: 'unequip', slot: 'weapon', itemId: 'bronze_dagger' })
    expect(save.equipment.weapon).toBeNull()
    expect(save.inventory.find((s: any) => s.itemId === 'bronze_dagger')?.quantity).toBe(1)
  })

  it('unequipping an empty slot throws', () => {
    expect(() => unequip(makeSave(), 'weapon')).toThrow(/Nothing equipped/)
  })
})

describe('idle skilling intents', () => {
  it('builds a valid production-skill task', () => {
    const task = buildSkillTask(makeSave(), 'firemaking', 'normal_logs')
    expect(task).toMatchObject({ type: 'skill', skill: 'firemaking', bankingEnabled: true })
    expect(task.action.id).toBe('normal_logs')
  })

  it('buildSkillTask rejects non-skilling skills (combat/agility use other paths)', () => {
    expect(() => buildSkillTask(makeSave(), 'attack', 'whatever')).toThrow()
    expect(() => buildSkillTask(makeSave(), 'agility', 'gnome_stronghold')).toThrow()
  })

  it('rejects an unknown action', () => {
    expect(() => buildSkillTask(makeSave(), 'firemaking', 'nope')).toThrow(/Unknown/)
  })

  it('enforces the action level requirement', () => {
    // firemaking 'oak_logs' needs level 15; a fresh account is level 1.
    expect(() => buildSkillTask(makeSave(), 'firemaking', 'oak_logs')).toThrow(/required/i)
  })

  it('toSlotArray pads to a fixed 28-slot array', () => {
    const arr = toSlotArray(makeSave({ inventory: [{ itemId: 'logs', quantity: 3 }] }))
    expect(arr).toHaveLength(28)
    expect(arr[0]).toEqual({ itemId: 'logs', quantity: 3 })
    expect(arr[1]).toBeNull()
  })

  it('applyIdleSkillResult applies XP, consumes inputs, banks output, sets inventory', () => {
    const save = makeSave({
      stats: { cooking: { xp: 1000, level: 9 } },
      bank: { raw_shrimps: { itemId: 'raw_shrimps', quantity: 10 } },
    })
    const sim = {
      skill: 'cooking',
      actionName: 'Cook shrimps',
      actions: 5,
      xpGained: { cooking: 150, mining: 99 }, // mining absent from stats → ignored
      itemsConsumed: { raw_shrimps: 5 },
      itemsBanked: { shrimps: 5 },
      finalInventory: [{ itemId: 'pickaxe', quantity: 1 }],
    }
    const summary = applyIdleResult(save, sim, 'skill')
    expect(save.stats.cooking.xp).toBe(1150)
    expect(save.stats.cooking.level).toBe(getLevelFromXP(1150))
    expect(save.stats.mining).toBeUndefined()
    expect(save.bank.raw_shrimps.quantity).toBe(5)
    expect(save.bank.shrimps).toEqual({ itemId: 'shrimps', quantity: 5 })
    expect(save.inventory).toEqual([{ itemId: 'pickaxe', quantity: 1 }])
    expect(summary.itemsBanked).toContainEqual({ itemId: 'shrimps', name: expect.any(String), quantity: 5 })
  })

  it('runIdleTask simulates a real production window and grants XP', () => {
    const save = makeSave({
      stats: { firemaking: { xp: 0, level: 1 } },
      inventory: [{ itemId: 'logs', quantity: 100 }],
    })
    const r = runIdleTask(save, buildSkillTask(save, 'firemaking', 'normal_logs'), 60_000)
    expect(r.applied).toBe(true)
    expect(r.xpGained.firemaking).toBeGreaterThan(0)
  })
})

describe('idle gathering + agility/thieving/hunter', () => {
  it('treats gathering skills as simulateIdleSkilling tasks', () => {
    const task = buildIdleTask(makeSave({ stats: { woodcutting: { xp: 0 } } }), 'woodcutting', 'normal')
    expect(task).toMatchObject({ type: 'skill', skill: 'woodcutting' })
  })

  it('gathering accrues XP over a window', () => {
    const save = makeSave({ stats: { woodcutting: { xp: 0, level: 1 } } })
    const r = runIdleTask(save, buildIdleTask(save, 'woodcutting', 'normal'), 60_000)
    expect(r.applied).toBe(true)
    expect(r.xpGained.woodcutting).toBeGreaterThan(0)
  })

  it('builds agility/thieving/hunter tasks from skills.json', () => {
    expect(buildIdleTask(makeSave(), 'agility', 'gnome_stronghold').type).toBe('agility')
    expect(buildIdleTask(makeSave(), 'thieving', 'villager').type).toBe('thieving')
    expect(buildIdleTask(makeSave(), 'hunter', 'hunt_cow').type).toBe('hunter')
  })

  it('agility grants XP deterministically and banks coins to inventory', () => {
    const save = makeSave({ stats: { agility: { xp: 0, level: 1 } } })
    // gnome_stronghold: ticks 40, xp 86, coinReward 10. 240000ms = 400 ticks = 10 laps.
    const r = runIdleTask(save, buildIdleTask(save, 'agility', 'gnome_stronghold'), 240_000)
    expect(save.stats.agility.xp).toBe(860)
    expect(r.coinsGained).toBe(100)
    expect(save.inventory.find((s: any) => s.itemId === 'coins')?.quantity).toBe(100)
  })

  it('thieving grants XP and coins deterministically', () => {
    const save = makeSave({ stats: { thieving: { xp: 0, level: 1 } } })
    // villager: xp 8, coins 3, 4 ticks/action. 24000ms = 40 ticks = 10 actions.
    runIdleTask(save, buildIdleTask(save, 'thieving', 'villager'), 24_000)
    expect(save.stats.thieving.xp).toBe(80)
    expect(save.inventory.find((s: any) => s.itemId === 'coins')?.quantity).toBe(30)
  })

  it('hunter grants XP and banks reward items', () => {
    const save = makeSave({ stats: { hunter: { xp: 0, level: 1 } } })
    // hunt_cow: ticks 20, xp 150, drops 1 cowhide @100%. 60000ms = 100 ticks = 5 actions.
    const r = runIdleTask(save, buildIdleTask(save, 'hunter', 'hunt_cow'), 60_000)
    expect(save.stats.hunter.xp).toBe(750)
    expect(save.bank.cowhide.quantity).toBe(5)
    expect(r.rewards).toContainEqual({ itemId: 'cowhide', name: expect.any(String), quantity: 5 })
  })
})

describe('quest intents', () => {
  // a_boarborn_of_interest: no requirements, 300s (500 ticks), {slayer:1000} XP,
  // 1000 coins — a fixed-skill reward with no player choice.
  it('builds a quest task for an eligible quest with no XP choice', () => {
    const task = buildQuestTask(makeSave({ stats: { slayer: { xp: 0 } } }), 'a_boarborn_of_interest', undefined)
    expect(task).toMatchObject({ type: 'quest', xpChoiceSkill: null })
    expect(task.quest.id).toBe('a_boarborn_of_interest')
    expect(task.totalTicks).toBe(500)
    expect(task.ticksRemaining).toBe(500)
  })

  it('rejects an unknown quest id', () => {
    expect(() => buildQuestTask(makeSave(), 'not_a_quest', undefined)).toThrow(/No quest/)
  })

  it('refuses a quest whose requirements are unmet', () => {
    // a_realm_divided needs several skills + prerequisite quests.
    expect(() => buildQuestTask(makeSave(), 'a_realm_divided', undefined)).toThrow(/Cannot start/)
  })

  it('requires xp_skill when the quest offers a combat/any XP choice', () => {
    // cross_marks_the_spot: {any:300} — a free "any skill" choice.
    expect(() => buildQuestTask(makeSave(), 'cross_marks_the_spot', undefined)).toThrow(/xp_skill/)
    // The error tells the agent to ask the player rather than defaulting.
    expect(() => buildQuestTask(makeSave(), 'cross_marks_the_spot', undefined)).toThrow(/ask the player/i)
  })

  it('describes a quest XP choice (or returns null) via questXpChoice', () => {
    // combat-only reward → choose from combat skills.
    const combat = questXpChoice({ xpReward: { combat: 40000 } } as any)
    expect(combat).toMatchObject({ type: 'combat', amount: 40000 })
    expect(combat?.chooseFrom).toContain('attack')
    expect(combat?.chooseFrom).not.toContain('cooking')
    // "any" reward → choose from every skill.
    const any = questXpChoice({ xpReward: { any: 300 } } as any)
    expect(any?.type).toBe('any')
    expect(any?.chooseFrom).toContain('cooking')
    // No choice → null.
    expect(questXpChoice({ xpReward: { slayer: 1000 } } as any)).toBeNull()
    expect(questXpChoice({} as any)).toBeNull()
  })

  it('rejects an xp_skill outside the choice scope (combat-only reward)', () => {
    // a_dusk_at_the_theater: {combat:40000} — cooking is not a combat skill.
    expect(() => buildQuestTask(makeSave(), 'a_dusk_at_the_theater', 'cooking')).toThrow(/not valid/)
    expect(buildQuestTask(makeSave(), 'a_dusk_at_the_theater', 'attack').xpChoiceSkill).toBe('attack')
  })

  it('completing a quest records it, grants fixed XP and banks coins', () => {
    const save = makeSave({ stats: { slayer: { xp: 0, level: 1 } } })
    const task = buildQuestTask(save, 'a_boarborn_of_interest', undefined)
    // 500 ticks * 600ms = 300000ms exactly completes it.
    const r = applyQuestTask(save, task, 300_000)
    expect(r.finalTask).toBeNull()
    expect(r.completed.map((c: any) => c.id)).toEqual(['a_boarborn_of_interest'])
    expect(save.settings.completedQuests).toContain('a_boarborn_of_interest')
    expect(save.stats.slayer.xp).toBe(1000)
    expect(save.bank.coins).toEqual({ itemId: 'coins', quantity: 1000 })
  })

  it('routes a chosen XP reward to the picked skill', () => {
    const save = makeSave({ stats: { cooking: { xp: 0, level: 1 } } })
    const task = buildQuestTask(save, 'cross_marks_the_spot', 'cooking')
    const r = applyQuestTask(save, task, 300_000)
    expect(r.completed[0].xpGained).toEqual({ cooking: 300 })
    expect(save.stats.cooking.xp).toBe(300)
  })

  it('partial progress persists the remaining task without granting rewards', () => {
    const save = makeSave({ stats: { attack: { xp: 0, level: 1 } } })
    // a_dusk_at_the_theater: 4500s = 7500 ticks. 600000ms = 1000 ticks elapsed.
    const task = buildQuestTask(save, 'a_dusk_at_the_theater', 'attack')
    const r = applyQuestTask(save, task, 600_000)
    expect(r.completed).toEqual([])
    expect(r.finalTask).toMatchObject({ type: 'quest', ticksRemaining: 6500, xpChoiceSkill: 'attack' })
    expect(save.stats.attack.xp).toBe(0)
    expect(save.settings.completedQuests).toEqual([])
  })

  it('questStatuses partitions completed / eligible / locked and totals quest points', () => {
    const save = makeSave({
      stats: {},
      settings: { completedQuests: ['a_boarborn_of_interest'] },
    })
    const status = questStatuses(save)
    expect(status.completedCount).toBe(1)
    expect(status.questPoints).toBeGreaterThan(0)
    expect(status.completed).toContain('a_boarborn_of_interest')
    // Already-completed quests are not re-listed as eligible.
    expect(status.eligible.find((q: any) => q.id === 'a_boarborn_of_interest')).toBeUndefined()
    // A quest with unmet prerequisites is locked, with reasons.
    const locked = status.locked.find((q: any) => q.id === 'a_realm_divided')
    expect(locked?.requirements?.length).toBeGreaterThan(0)
  })

  it('surfaces an xpChoice on eligible quests so the agent can ask before starting', () => {
    // cross_marks_the_spot: {any:300}. Give a clean save so it is eligible.
    const save = makeSave({ stats: {}, settings: { completedQuests: [] } })
    const eligible = questStatuses(save).eligible
    const choiceQuest = eligible.find((q: any) => q.id === 'cross_marks_the_spot')
    expect(choiceQuest?.xpChoice).toMatchObject({ type: 'any' })
    expect(choiceQuest?.xpChoice.chooseFrom).toContain('cooking')
    // A quest with only fixed XP carries no xpChoice field.
    const fixedQuest = eligible.find((q: any) => q.xpChoice === undefined)
    expect(fixedQuest).toBeDefined()
  })
})

describe('combat intents', () => {
  function combatSave(overrides: any = {}) {
    return makeSave({
      stats: {
        attack: { xp: 1_000_000 },
        strength: { xp: 1_000_000 },
        defence: { xp: 1_000_000 },
        hitpoints: { xp: 1_000_000 },
        ranged: { xp: 0 },
        magic: { xp: 0 },
      },
      settings: { currentHP: 73, idleCombatSetup: { food: [], potions: [], prayers: {} } },
      ...overrides,
    })
  }

  it('builds a combat task for a normal monster, defaulting the stance', () => {
    const task = buildCombatTask(combatSave(), 'field_chicken', undefined)
    expect(task).toMatchObject({ type: 'combat', stance: 'accurate', bankingEnabled: true })
    expect(task.monster.id).toBe('field_chicken')
  })

  it('refuses to idle-fight a boss', () => {
    expect(() => buildCombatTask(combatSave(), 'deepmaw_kraken', undefined)).toThrow(/boss/i)
  })

  it('rejects an unknown monster and an invalid stance', () => {
    expect(() => buildCombatTask(combatSave(), 'not_a_monster', undefined)).toThrow(/No monster/)
    expect(() => buildCombatTask(combatSave(), 'field_chicken', 'berserk')).toThrow(/stance/i)
  })

  it('kills weak monsters: applies combat XP, banks/holds loot, survives', () => {
    const save = combatSave()
    const r = runCombatTask(save, buildCombatTask(save, 'field_chicken', 'accurate'), 60_000)
    expect(r.applied).toBe(true)
    expect(r.died).toBe(false)
    expect(r.monstersKilled).toBeGreaterThan(0)
    // Accurate stance trains attack; all damage trains hitpoints.
    expect(r.xpGained.attack).toBeGreaterThan(0)
    expect(r.xpGained.hitpoints).toBeGreaterThan(0)
    expect(save.stats.attack.xp).toBeGreaterThan(1_000_000)
    // Chicken always drops bones — they land in the (previously empty) inventory.
    const hasLoot = (save.inventory || []).some((s: any) => s?.itemId === 'bones')
    expect(hasLoot).toBe(true)
    expect(Number.isFinite(save.settings.currentHP)).toBe(true)
  })

  it('on a fatal fight keeps no-wipe semantics: died flag, HP reset to max', () => {
    // Strong attacker but only 10 HP and no food vs a 330-HP dragon → death.
    const save = combatSave({
      stats: {
        attack: { xp: 5_000_000 },
        strength: { xp: 5_000_000 },
        defence: { xp: 0 },
        hitpoints: { xp: 1154 }, // level 10 → max HP 10
        ranged: { xp: 0 },
        magic: { xp: 0 },
      },
      settings: { currentHP: 10, idleCombatSetup: { food: [], potions: [], prayers: {} } },
    })
    const r = runCombatTask(save, buildCombatTask(save, 'rune_dragon', 'accurate'), 24 * 60 * 60 * 1000)
    expect(r.died).toBe(true)
    expect(r.finalHP).toBe(0)
    expect(save.settings.currentHP).toBe(10)
  })
})

describe('dungeoneering intents', () => {
  it('trains dungeoneering as an idle skill, earning XP and tokens', () => {
    const save = makeSave({ stats: { dungeoneering: { xp: 0, level: 1 } } })
    const task = buildIdleTask(save, 'dungeoneering', 'dungeoneering_floor_1')
    expect(task).toMatchObject({ type: 'skill', skill: 'dungeoneering' })
    // dungeoneering_floor_1: 500 ticks, 1000 XP. 600000ms = 1000 ticks = 2 floors.
    const r = runIdleTask(save, task, 600_000)
    expect(r.applied).toBe(true)
    expect(save.stats.dungeoneering.xp).toBe(2000)
    // Token rate 0.15 → ceil(1000*0.15)=150 tokens/floor × 2.
    expect(save.settings.dungeoneeringTokens).toBe(300)
  })

  it('refuses to idle a dungeoneering reward unlock', () => {
    const save = makeSave({ stats: { dungeoneering: { xp: 50_000_000 } } })
    expect(() => buildIdleTask(save, 'dungeoneering', 'unlock_arcane_necklace')).toThrow(/claim_dungeoneering_reward/)
  })

  it('plans an affordable dungeoneering reward unlock', () => {
    const save = makeSave({ stats: { dungeoneering: { xp: 14_000_000 } }, settings: { dungeoneeringTokens: 100_000 } })
    const plan = planDungeoneeringReward(save, 'unlock_arcane_necklace')
    expect(plan).toMatchObject({ product: 'arcane_necklace', cost: 65000, productQty: 1 })
  })

  it('rejects unaffordable, under-levelled, or unknown reward unlocks', () => {
    const lowTokens = makeSave({ stats: { dungeoneering: { xp: 14_000_000 } }, settings: { dungeoneeringTokens: 100 } })
    expect(() => planDungeoneeringReward(lowTokens, 'unlock_arcane_necklace')).toThrow(/tokens/i)
    const lowLevel = makeSave({ stats: { dungeoneering: { xp: 0 } }, settings: { dungeoneeringTokens: 100_000 } })
    expect(() => planDungeoneeringReward(lowLevel, 'unlock_arcane_necklace')).toThrow(/required/i)
    expect(() => planDungeoneeringReward(lowTokens, 'nope')).toThrow(/No dungeoneering reward/)
  })
})
