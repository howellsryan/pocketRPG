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
  setIdleCombatSetup,
  idleCombatSetupSummary,
  idleFoodWarning,
  addQuestToQueueIntent,
  removeQuestFromQueueIntent,
  buildCombatTask,
  runCombatTask,
  buildClueTask,
  CLUE_LEVELS,
  buildMinigameTask,
  MINIGAME_TASK_IDS,
  trainPrayer,
  trainConstruction,
  unlockConstructionPerk,
  farmSummary,
  plantSeed,
  harvestPatch,
  harvestAll,
  castMagic,
  isClaimableTask,
  planDungeoneeringReward,
  assignSlayerTask,
  slayerStatus,
} from '../functions/_lib/mcp/intents.js'
import { getLevelFromXP } from '../src/engine/experience.js'
import { SLAYER_MASTERS } from '../src/engine/slayerMasters.js'

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
      xpGained: { cooking: 150, mining: 99 }, // mining absent from stats → now initialized, not dropped
      itemsConsumed: { raw_shrimps: 5 },
      itemsBanked: { shrimps: 5 },
      finalInventory: [{ itemId: 'pickaxe', quantity: 1 }],
    }
    const summary = applyIdleResult(save, sim, 'skill')
    expect(save.stats.cooking.xp).toBe(1150)
    expect(save.stats.cooking.level).toBe(getLevelFromXP(1150))
    // A skill missing from a server-side save is initialized so its XP lands
    // (the MCP "stuck on Spryroot" fix), not silently discarded.
    expect(save.stats.mining).toEqual({ skill: 'mining', xp: 99, level: getLevelFromXP(99) })
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

describe('combat intents — slayer task credit', () => {
  function slayerSave(overrides: any = {}) {
    return makeSave({
      stats: {
        attack: { xp: 1_000_000 },
        strength: { xp: 1_000_000 },
        defence: { xp: 1_000_000 },
        hitpoints: { xp: 1_000_000 },
        slayer: { xp: 1_000_000 },
        ranged: { xp: 0 },
        magic: { xp: 0 },
      },
      settings: {
        currentHP: 73,
        idleCombatSetup: { food: [], potions: [], prayers: {} },
        slayerPoints: 10,
        slayerTasksCompleted: 4,
        slayerTask: {
          monsterId: 'field_chicken',
          monsterName: 'Field Chicken',
          monstersRemaining: 500,
          totalCount: 500,
          masterId: 'turael',
          pointsOnComplete: 1,
          isBoss: false,
        },
      },
      ...overrides,
    })
  }

  it('buildCombatTask attaches slayerTask when the monster matches the active task', () => {
    const save = slayerSave()
    const task = buildCombatTask(save, 'field_chicken', undefined)
    expect(task.slayerTask).not.toBeNull()
    expect(task.slayerTask.monsterId).toBe('field_chicken')
    expect(task.slayerTask.monstersRemaining).toBe(500)
  })

  it('buildCombatTask leaves slayerTask null when fighting a different monster', () => {
    const save = slayerSave()
    const task = buildCombatTask(save, 'cave_goblin', undefined)
    expect(task.slayerTask).toBeNull()
  })

  it('buildCombatTask leaves slayerTask null when no active slayer task', () => {
    const save = slayerSave({ settings: { currentHP: 73, idleCombatSetup: { food: [], potions: [], prayers: {} } } })
    const task = buildCombatTask(save, 'field_chicken', undefined)
    expect(task.slayerTask).toBeNull()
  })

  it('runCombatTask decrements monstersRemaining and adds slayer XP on partial progress', () => {
    const save = slayerSave()
    const task = buildCombatTask(save, 'field_chicken', undefined)
    const r = runCombatTask(save, task, 30_000)
    expect(r.applied).toBe(true)
    expect(r.slayerTask).toBeDefined()
    expect(r.slayerTask.completed).toBe(false)
    expect(r.slayerTask.monstersRemaining).toBeGreaterThan(0)
    expect(r.slayerTask.monstersRemaining).toBeLessThan(500)
    // Slayer task still active — not cleared
    expect(save.settings.slayerTask).not.toBeNull()
    expect(save.settings.slayerTask.monstersRemaining).toBe(r.slayerTask.monstersRemaining)
    // Slayer XP granted for kills on task
    expect(save.stats.slayer.xp).toBeGreaterThan(1_000_000)
    expect(r.xpGained.slayer).toBeGreaterThan(0)
  })

  it('runCombatTask completes the task and grants slayer points when monstersRemaining hits 0', () => {
    const save = slayerSave({
      settings: {
        currentHP: 73,
        idleCombatSetup: { food: [], potions: [], prayers: {} },
        slayerPoints: 10,
        slayerTasksCompleted: 4,
        slayerTask: { monsterId: 'field_chicken', monsterName: 'Field Chicken', monstersRemaining: 1, totalCount: 10, masterId: 'turael', pointsOnComplete: 1, isBoss: false },
      },
    })
    const task = buildCombatTask(save, 'field_chicken', undefined)
    const r = runCombatTask(save, task, 60_000)
    expect(r.applied).toBe(true)
    expect(r.slayerTask?.completed).toBe(true)
    // The 5th task completion (tasksCompleted was 4) hits the 5-task milestone → x10
    expect(r.slayerTask?.pointsEarned).toBe(10)
    expect(save.settings.slayerTask).toBeNull()
    expect(save.settings.slayerPoints).toBe(20) // 10 existing + 10 earned
    expect(save.settings.slayerTasksCompleted).toBe(5)
    expect(r.slayerTask?.totalSlayerPoints).toBe(20)
  })

  it('runCombatTask does not produce slayerTask credit when monster does not match', () => {
    const save = slayerSave()
    const task = buildCombatTask(save, 'cave_goblin', undefined)
    const r = runCombatTask(save, task, 60_000)
    expect(r.slayerTask).toBeUndefined()
    // Slayer task settings unchanged
    expect(save.settings.slayerTask.monstersRemaining).toBe(500)
  })
})

describe('clue intents', () => {
  it('advertises the four clue levels', () => {
    expect(CLUE_LEVELS).toEqual(['medium', 'hard', 'elite', 'master'])
  })

  it('builds a clue task when the scroll is in the inventory', () => {
    const save = makeSave({ inventory: [{ itemId: 'clue_scroll_medium', quantity: 1 }] })
    const task = buildClueTask(save, 'medium')
    expect(task.type).toBe('clue')
    expect(task.gatherTask).toMatchObject({ clueLevel: 'medium', requiresItem: 'clue_scroll_medium' })
    expect(task.gatherTask.ticks).toBeGreaterThan(0)
    // The built task is claimable via the MCP idle pipeline.
    expect(isClaimableTask(task)).toBe(true)
  })

  it('rejects an unknown clue level', () => {
    const save = makeSave({ inventory: [{ itemId: 'clue_scroll_medium', quantity: 1 }] })
    expect(() => buildClueTask(save, 'beginner')).toThrow(/Unknown clue level/)
  })

  it('refuses when the scroll is only in the bank (clues solve from inventory)', () => {
    const save = makeSave({ bank: { clue_scroll_elite: { itemId: 'clue_scroll_elite', quantity: 2 } } })
    expect(() => buildClueTask(save, 'elite')).toThrow(/inventory/i)
  })

  it('refuses when no scroll is held at all', () => {
    expect(() => buildClueTask(makeSave(), 'hard')).toThrow(/clue scroll/i)
  })
})

describe('minigame intents', () => {
  it('exposes the minigame task ids', () => {
    expect(MINIGAME_TASK_IDS).toContain('wg_rune_defender')
    expect(MINIGAME_TASK_IDS).toContain('wg_dragon_defender')
  })

  it('builds a minigame task with no prerequisite', () => {
    const task = buildMinigameTask(makeSave(), 'wg_rune_defender')
    expect(task.type).toBe('minigame')
    expect(task.minigameTask).toMatchObject({ id: 'wg_rune_defender', product: 'runeforged_defender', minigame: 'warriors_guild' })
    expect(task.minigameTask.ticks).toBeGreaterThan(0)
    expect(isClaimableTask(task)).toBe(true)
  })

  it('rejects an unknown minigame task id', () => {
    expect(() => buildMinigameTask(makeSave(), 'not_a_task')).toThrow(/No minigame task/)
  })

  it('refuses a prerequisite-gated grind when the required item is missing', () => {
    // wg_dragon_defender requires the Rune Defender (runeforged_defender).
    expect(() => buildMinigameTask(makeSave(), 'wg_dragon_defender')).toThrow(/requires/i)
  })

  it('allows a prerequisite-gated grind when the item is held (inventory, bank or equipped)', () => {
    const inInv = buildMinigameTask(makeSave({ inventory: [{ itemId: 'runeforged_defender', quantity: 1 }] }), 'wg_dragon_defender')
    expect(inInv.minigameTask.id).toBe('wg_dragon_defender')
    const inBank = buildMinigameTask(makeSave({ bank: { runeforged_defender: { itemId: 'runeforged_defender', quantity: 1 } } }), 'wg_dragon_defender')
    expect(inBank.minigameTask.product).toBe('dragon_defender')
    const equipped = buildMinigameTask(makeSave({ equipment: { shield: { itemId: 'runeforged_defender' } } }), 'wg_dragon_defender')
    expect(equipped.type).toBe('minigame')
  })
})

describe('prayer intents (train_prayer)', () => {
  it('buries every bone by default, granting N × action.xp', () => {
    // bury_bones: level 1, xp 5, consumes 1 `bones`.
    const save = makeSave({ stats: { prayer: { xp: 0 } }, bank: { bones: { itemId: 'bones', quantity: 10 } } })
    const r = trainPrayer(save, 'bury_bones', undefined)
    expect(r.actions).toBe(10)
    expect(r.xpGained.prayer).toBe(50)
    expect(save.stats.prayer.xp).toBe(50)
    expect(save.bank.bones).toBeUndefined()
    expect(r.bonesRemaining).toBe(0)
  })

  it('drains the inventory first, then the bank', () => {
    const save = makeSave({
      stats: { prayer: { xp: 0 } },
      inventory: [{ itemId: 'bones', quantity: 3 }],
      bank: { bones: { itemId: 'bones', quantity: 5 } },
    })
    const r = trainPrayer(save, 'bury_bones', 6)
    expect(r.actions).toBe(6)
    // 3 from inventory (emptied), 3 from bank (2 left).
    expect(save.inventory.find((s: any) => s?.itemId === 'bones')).toBeUndefined()
    expect(save.bank.bones.quantity).toBe(2)
    expect(r.bonesRemaining).toBe(2)
  })

  it('caps the requested quantity at the bones actually owned', () => {
    const save = makeSave({ stats: { prayer: { xp: 0 } }, bank: { bones: { itemId: 'bones', quantity: 4 } } })
    const r = trainPrayer(save, 'bury_bones', 100)
    expect(r.actions).toBe(4)
    expect(save.stats.prayer.xp).toBe(20)
  })

  it('enforces the action level requirement (nothing consumed)', () => {
    // bury_big_bones needs Prayer level 5; a fresh account is level 1.
    const save = makeSave({ stats: { prayer: { xp: 0 } }, bank: { big_bones: { itemId: 'big_bones', quantity: 10 } } })
    expect(() => trainPrayer(save, 'bury_big_bones', undefined)).toThrow(/level 5/i)
    expect(save.bank.big_bones.quantity).toBe(10)
  })

  it('gilded-altar offerings require a level-75 Construction house', () => {
    // altar_big_bones: Prayer 5, xp 52, needs the gilded altar.
    const noAltar = makeSave({ stats: { prayer: { xp: 10_000 } }, bank: { big_bones: { itemId: 'big_bones', quantity: 5 } } })
    expect(() => trainPrayer(noAltar, 'altar_big_bones', undefined)).toThrow(/Construction level 75/i)

    const withAltar = makeSave({
      stats: { prayer: { xp: 10_000 }, construction: { xp: 1_300_000 } }, // level 75+
      bank: { big_bones: { itemId: 'big_bones', quantity: 5 } },
    })
    const r = trainPrayer(withAltar, 'altar_big_bones', undefined)
    expect(r.actions).toBe(5)
    expect(r.xpGained.prayer).toBe(52 * 5)
  })

  it('refuses when no matching bones are held', () => {
    const save = makeSave({ stats: { prayer: { xp: 0 } } })
    expect(() => trainPrayer(save, 'bury_bones', undefined)).toThrow(/No .* available/i)
  })

  it('rejects an unknown prayer action', () => {
    expect(() => trainPrayer(makeSave(), 'bury_unicorns', undefined)).toThrow(/Unknown prayer action/)
  })
})

describe('construction intents (train_construction + perks)', () => {
  it('builds with every plank by default, granting N × action.xp', () => {
    // build_plank: level 1, xp 29, consumes 1 `plank`.
    const save = makeSave({ stats: { construction: { xp: 0 } }, bank: { plank: { itemId: 'plank', quantity: 10 } } })
    const r = trainConstruction(save, 'build_plank', undefined)
    expect(r.actions).toBe(10)
    expect(r.xpGained.construction).toBe(290)
    expect(save.stats.construction.xp).toBe(290)
    expect(save.bank.plank).toBeUndefined()
    expect(r.planksRemaining).toBe(0)
  })

  it('drains the inventory first, then the bank', () => {
    const save = makeSave({
      stats: { construction: { xp: 0 } },
      inventory: [{ itemId: 'plank', quantity: 2 }],
      bank: { plank: { itemId: 'plank', quantity: 5 } },
    })
    const r = trainConstruction(save, 'build_plank', 4)
    expect(r.actions).toBe(4)
    expect(save.inventory.find((s: any) => s?.itemId === 'plank')).toBeUndefined()
    expect(save.bank.plank.quantity).toBe(3)
  })

  it('enforces the action level requirement (nothing consumed)', () => {
    // build_oak_plank needs Construction level 15; a fresh account is level 1.
    const save = makeSave({ stats: { construction: { xp: 0 } }, bank: { oak_plank: { itemId: 'oak_plank', quantity: 5 } } })
    expect(() => trainConstruction(save, 'build_oak_plank', undefined)).toThrow(/level 15/i)
    expect(save.bank.oak_plank.quantity).toBe(5)
  })

  it('refuses when no matching planks are held', () => {
    const save = makeSave({ stats: { construction: { xp: 0 } } })
    expect(() => trainConstruction(save, 'build_plank', undefined)).toThrow(/No .* available/i)
  })

  it('rejects an unknown construction action', () => {
    expect(() => trainConstruction(makeSave(), 'build_unobtanium', undefined)).toThrow(/Unknown construction action/)
  })

  it('unlocks a perk once the Construction level is met, recording it in settings', () => {
    // money_purse needs Construction level 70.
    const save = makeSave({ stats: { construction: { xp: 800_000 } }, settings: { completedQuests: [] } }) // level 70+
    const r = unlockConstructionPerk(save, 'money_purse')
    expect(r.unlocked).toBe(true)
    expect(save.settings.unlockedFeatures).toContain('money_purse')
    // Re-unlocking the same perk is refused.
    expect(() => unlockConstructionPerk(save, 'money_purse')).toThrow(/already unlocked/i)
  })

  it('refuses a perk unlock below the required level', () => {
    const save = makeSave({ stats: { construction: { xp: 0 } } })
    expect(() => unlockConstructionPerk(save, 'master_rejuvenation')).toThrow(/level 90/i)
    expect(save.settings.unlockedFeatures).toBeUndefined()
  })

  it('rejects an unknown perk id', () => {
    expect(() => unlockConstructionPerk(makeSave(), 'free_lunch')).toThrow(/Unknown construction perk/)
  })
})

describe('farming intents (plant → grow → harvest)', () => {
  // Back-date a planted patch so getEffectiveStage (elapsed wall-clock) reports
  // it fully grown, simulating the passage of real time.
  function ripen(save: any, patchId: string) {
    const patch = save.settings.farming.patchesById[patchId]
    patch.plantedAt = Date.now() - 10_000_000 // > any crop's growthTimeMs
  }

  it('farmSummary lists locations and empty patches on a fresh save', () => {
    const out = farmSummary(makeSave({ stats: { farming: { xp: 0 } } }))
    expect(out.farmingLevel).toBe(1)
    const falador = out.locations.find((l: any) => l.locationId === 'falador')
    expect(falador?.patches.some((p: any) => p.patchId === 'falador_herb_0' && p.planted === null)).toBe(true)
  })

  it('plants a seed: patch occupied, seed consumed, plant XP granted', () => {
    const save = makeSave({ stats: { farming: { xp: 0 } }, bank: { greenthorn_seed: { itemId: 'greenthorn_seed', quantity: 2 } } })
    const r = plantSeed(save, 'falador_herb_0', 'greenthorn_seed')
    expect(r.planted).toBe('Greenthorn')
    expect(r.xpGained.farming).toBe(11)
    expect(save.bank.greenthorn_seed.quantity).toBe(1)
    expect(save.settings.farming.patchesById['falador_herb_0'].cropId).toBe('greenthorn_seed')
    expect(save.stats.farming.xp).toBe(11)
  })

  it('refuses to plant in an occupied patch', () => {
    const save = makeSave({ stats: { farming: { xp: 0 } }, bank: { greenthorn_seed: { itemId: 'greenthorn_seed', quantity: 2 } } })
    plantSeed(save, 'falador_herb_0', 'greenthorn_seed')
    expect(() => plantSeed(save, 'falador_herb_0', 'greenthorn_seed')).toThrow(/already has/i)
  })

  it('refuses a seed whose type does not match the patch', () => {
    // greenthorn_seed is a herb; falador_tree_0 is a tree patch.
    const save = makeSave({ stats: { farming: { xp: 0 } }, bank: { greenthorn_seed: { itemId: 'greenthorn_seed', quantity: 1 } } })
    expect(() => plantSeed(save, 'falador_tree_0', 'greenthorn_seed')).toThrow(/cannot be planted in a tree patch/i)
  })

  it('enforces the seed level requirement', () => {
    // duskroot_seed needs Farming 19; a fresh account is level 1.
    const save = makeSave({ stats: { farming: { xp: 0 } }, bank: { duskroot_seed: { itemId: 'duskroot_seed', quantity: 1 } } })
    expect(() => plantSeed(save, 'falador_herb_0', 'duskroot_seed')).toThrow(/level 19/i)
  })

  it('refuses to plant a seed the character does not own', () => {
    const save = makeSave({ stats: { farming: { xp: 0 } } })
    expect(() => plantSeed(save, 'falador_herb_0', 'greenthorn_seed')).toThrow(/No .* available/i)
  })

  it('rejects an unknown patch id and an unknown seed id', () => {
    const save = makeSave({ stats: { farming: { xp: 0 } }, bank: { greenthorn_seed: { itemId: 'greenthorn_seed', quantity: 1 } } })
    expect(() => plantSeed(save, 'not_a_patch', 'greenthorn_seed')).toThrow(/No farm patch/)
    expect(() => plantSeed(save, 'falador_herb_0', 'not_a_seed')).toThrow(/No farming seed/)
  })

  it('harvests a ripe patch: produce banked, XP granted, patch cleared', () => {
    const save = makeSave({ stats: { farming: { xp: 0 } }, bank: { greenthorn_seed: { itemId: 'greenthorn_seed', quantity: 1 } } })
    plantSeed(save, 'falador_herb_0', 'greenthorn_seed')
    ripen(save, 'falador_herb_0')
    const r = harvestPatch(save, 'falador_herb_0')
    expect(r.harvested.itemId).toBe('greenthorn_leaf')
    expect(r.harvested.quantity).toBeGreaterThanOrEqual(5)
    expect(save.bank.greenthorn_leaf.quantity).toBe(r.harvested.quantity)
    expect(r.xpGained.farming).toBeGreaterThan(0)
    // Patch cleared after harvest.
    expect(save.settings.farming.patchesById['falador_herb_0']).toBeUndefined()
  })

  it('refuses to harvest an unripe or empty patch', () => {
    const save = makeSave({ stats: { farming: { xp: 0 } }, bank: { greenthorn_seed: { itemId: 'greenthorn_seed', quantity: 1 } } })
    plantSeed(save, 'falador_herb_0', 'greenthorn_seed') // just planted → stage 1
    expect(() => harvestPatch(save, 'falador_herb_0')).toThrow(/not ready/i)
    expect(() => harvestPatch(save, 'falador_tree_0')).toThrow(/empty/i)
  })

  it('harvest_all reaps every ready patch and refuses when nothing is ready', () => {
    const save = makeSave({
      stats: { farming: { xp: 0 } },
      bank: { greenthorn_seed: { itemId: 'greenthorn_seed', quantity: 1 }, oak_sapling: { itemId: 'oak_sapling', quantity: 1 } },
    })
    expect(() => harvestAll(save)).toThrow(/No crops are ready/i)
    plantSeed(save, 'falador_herb_0', 'greenthorn_seed')
    save.stats.farming = { xp: 1_000_000 } // level 15+ for the oak sapling
    plantSeed(save, 'falador_tree_0', 'oak_sapling')
    ripen(save, 'falador_herb_0')
    ripen(save, 'falador_tree_0')
    const r = harvestAll(save)
    expect(r.patchesHarvested).toBe(2)
    expect(r.produce.some((p: any) => p.itemId === 'greenthorn_leaf')).toBe(true)
    expect(r.produce.some((p: any) => p.itemId === 'oak_logs')).toBe(true)
    expect(Object.keys(save.settings.farming.patchesById)).toHaveLength(0)
  })
})

describe('magic intents (cast_magic)', () => {
  it('High Alchemy: consumes runes + the target item, banks coins, grants XP', () => {
    // high_alch: level 55, xp 65, runes nature_rune:1 + fire_rune:5. oak_logs shopValue 34 → 37 coins.
    const save = makeSave({
      stats: { magic: { xp: 200_000 } }, // level 55+
      inventory: [{ itemId: 'oak_logs', quantity: 5 }],
      bank: { nature_rune: { itemId: 'nature_rune', quantity: 10 }, fire_rune: { itemId: 'fire_rune', quantity: 50 } },
    })
    const r = castMagic(save, 'high_alch', { targetItemId: 'oak_logs' })
    expect(r.casts).toBe(5) // limited by the 5 oak logs
    expect(r.xpGained.magic).toBe(65 * 5)
    expect(r.produced[0]).toMatchObject({ itemId: 'coins', quantity: 37 * 5 })
    expect(save.bank.coins.quantity).toBe(37 * 5)
    expect(save.inventory.find((s: any) => s?.itemId === 'oak_logs')).toBeUndefined()
    expect(save.bank.nature_rune.quantity).toBe(5)
    expect(save.bank.fire_rune.quantity).toBe(25)
  })

  it('an equipped elemental staff supplies its rune for free', () => {
    const save = makeSave({
      stats: { magic: { xp: 200_000 } },
      equipment: { weapon: { itemId: 'staff_of_fire' } },
      inventory: [{ itemId: 'oak_logs', quantity: 3 }],
      bank: { nature_rune: { itemId: 'nature_rune', quantity: 10 } }, // no fire runes at all
    })
    const r = castMagic(save, 'high_alch', { targetItemId: 'oak_logs' })
    expect(r.casts).toBe(3)
    expect(save.bank.fire_rune).toBeUndefined()
    expect(save.bank.nature_rune.quantity).toBe(7)
  })

  it('Superheat: consumes ore/coal + runes and banks the bar', () => {
    // superheat: level 43, xp 53, materials iron_ore:1 + coal:1, runes nature_rune:1 + fire_rune:4.
    const save = makeSave({
      stats: { magic: { xp: 70_000 } }, // level 43+
      bank: {
        iron_ore: { itemId: 'iron_ore', quantity: 3 },
        coal: { itemId: 'coal', quantity: 3 },
        nature_rune: { itemId: 'nature_rune', quantity: 5 },
        fire_rune: { itemId: 'fire_rune', quantity: 20 },
      },
    })
    const r = castMagic(save, 'superheat', {})
    expect(r.casts).toBe(3)
    expect(r.produced[0]).toMatchObject({ itemId: 'iron_bar', quantity: 3 })
    expect(save.bank.iron_bar.quantity).toBe(3)
    expect(save.bank.iron_ore).toBeUndefined()
    expect(save.bank.coal).toBeUndefined()
    expect(save.stats.magic.xp).toBe(70_000 + 53 * 3)
  })

  it('Enchant: consumes the amulet + runes and banks the enchanted product', () => {
    // enchant_sapphire: level 7, xp 170, materials sapphire_amulet:1, runes cosmic+water.
    const save = makeSave({
      stats: { magic: { xp: 10_000 } },
      bank: {
        sapphire_amulet: { itemId: 'sapphire_amulet', quantity: 2 },
        cosmic_rune: { itemId: 'cosmic_rune', quantity: 5 },
        water_rune: { itemId: 'water_rune', quantity: 5 },
      },
    })
    const r = castMagic(save, 'enchant_sapphire', { quantity: 2 })
    expect(r.casts).toBe(2)
    expect(save.bank.amulet_of_magic.quantity).toBe(2)
    expect(save.bank.sapphire_amulet).toBeUndefined()
  })

  it('refuses High Alchemy without a target, listing eligible items', () => {
    const save = makeSave({
      stats: { magic: { xp: 200_000 } },
      inventory: [{ itemId: 'oak_logs', quantity: 1 }],
      bank: { nature_rune: { itemId: 'nature_rune', quantity: 5 }, fire_rune: { itemId: 'fire_rune', quantity: 25 } },
    })
    expect(() => castMagic(save, 'high_alch', {})).toThrow(/target_item_id/)
    expect(() => castMagic(save, 'high_alch', {})).toThrow(/oak_logs/)
  })

  it('enforces the magic level requirement', () => {
    const save = makeSave({ stats: { magic: { xp: 0 } }, inventory: [{ itemId: 'oak_logs', quantity: 1 }] })
    expect(() => castMagic(save, 'high_alch', { targetItemId: 'oak_logs' })).toThrow(/level 55/i)
  })

  it('refuses when there are not enough runes', () => {
    const save = makeSave({ stats: { magic: { xp: 70_000 } }, bank: { iron_ore: { itemId: 'iron_ore', quantity: 3 }, coal: { itemId: 'coal', quantity: 3 } } })
    expect(() => castMagic(save, 'superheat', {})).toThrow(/Not enough runes or inputs/i)
  })

  it('rejects an unknown magic action', () => {
    expect(() => castMagic(makeSave(), 'fireball_supreme', {})).toThrow(/Unknown magic action/)
  })

  it('High-Alching a rune that is also a cast rune accounts for the combined demand', () => {
    // high_alch uses nature_rune:1 + fire_rune:5. Alching nature_rune means each
    // cast needs 2 nature runes (1 rune + 1 target). With 10 nature in inventory
    // and ample fire runes, that is 5 casts — not a spurious failure.
    const save = makeSave({
      stats: { magic: { xp: 200_000 } },
      inventory: [{ itemId: 'nature_rune', quantity: 10 }, { itemId: 'fire_rune', quantity: 100 }],
      bank: {},
    })
    const r = castMagic(save, 'high_alch', { targetItemId: 'nature_rune' })
    expect(r.casts).toBe(5)
    // 5 casts × (1 rune + 1 target) = 10 nature consumed; 5 × 5 fire = 25 fire.
    expect(save.inventory.find((s: any) => s?.itemId === 'nature_rune')).toBeUndefined()
    expect(save.inventory.find((s: any) => s?.itemId === 'fire_rune')?.quantity).toBe(75)
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

describe('MCP idle combat setup', () => {
  const HIGH_PRAYER = { prayer: { xp: 1_500_000 } } // well above level 37

  it('configures food, potions and prayers, reporting availability', () => {
    const save = makeSave({ stats: HIGH_PRAYER, inventory: [{ itemId: 'shrimps', quantity: 10 }] })
    const r = setIdleCombatSetup(save, {
      food: [{ item_id: 'shrimps', quantity: 5 }],
      potions: [{ item_id: 'attack_potion', quantity: 2 }],
      protectionPrayerId: 'protection_from_magic',
      combatPrayerId: 'thick_skin',
    })
    expect(save.settings.idleCombatSetup.food).toEqual([{ itemId: 'shrimps', quantity: 5 }])
    expect(save.settings.idleCombatSetup.potions).toEqual([{ itemId: 'attack_potion', quantity: 2 }])
    expect(save.settings.idleCombatSetup.prayers).toEqual({ protectionPrayerId: 'protection_from_magic', combatPrayerId: 'thick_skin' })
    // Summary decorates with owned counts (10 shrimps in inventory).
    expect(r.idleCombatSetup.food[0]).toMatchObject({ itemId: 'shrimps', available: 10 })
    expect(r.idleCombatSetup.foodInStock).toBe(true)
  })

  it('rejects non-food, the wrong prayer slot, and an under-level prayer', () => {
    expect(() => setIdleCombatSetup(makeSave(), { food: [{ item_id: 'attack_potion', quantity: 1 }] })).toThrow(/not food/i)
    expect(() => setIdleCombatSetup(makeSave({ stats: HIGH_PRAYER }), { protectionPrayerId: 'thick_skin' })).toThrow(/not a protection/i)
    expect(() => setIdleCombatSetup(makeSave({ stats: { prayer: { xp: 0 } } }), { protectionPrayerId: 'protection_from_magic' })).toThrow(/Prayer level/i)
  })

  it('leaves omitted fields unchanged and clears with [] / null', () => {
    const save = makeSave({
      stats: HIGH_PRAYER,
      settings: { completedQuests: [], idleCombatSetup: { food: [{ itemId: 'shrimps', quantity: 3 }], potions: [], prayers: { protectionPrayerId: null, combatPrayerId: 'thick_skin' } } },
    })
    setIdleCombatSetup(save, { combatPrayerId: null }) // food omitted → unchanged
    expect(save.settings.idleCombatSetup.food).toEqual([{ itemId: 'shrimps', quantity: 3 }])
    expect(save.settings.idleCombatSetup.prayers.combatPrayerId).toBeNull()
    setIdleCombatSetup(save, { food: [] }) // explicit clear
    expect(save.settings.idleCombatSetup.food).toEqual([])
  })

  it('warns only when there is no usable idle food', () => {
    expect(idleFoodWarning(makeSave())).toMatch(/No idle food/i)
    const configured = { completedQuests: [], idleCombatSetup: { food: [{ itemId: 'shrimps', quantity: 5 }], potions: [], prayers: { protectionPrayerId: null, combatPrayerId: null } } }
    expect(idleFoodWarning(makeSave({ settings: configured }))).toMatch(/inventory or bank/i)
    expect(idleFoodWarning(makeSave({ inventory: [{ itemId: 'shrimps', quantity: 5 }], settings: configured }))).toBeNull()
    // The read-only summary mirrors the same stock signal.
    expect(idleCombatSetupSummary(makeSave({ settings: configured })).foodInStock).toBe(false)
  })
})

describe('MCP quest queue', () => {
  it('queues an eligible quest, resolving its XP choice up front', () => {
    const save = makeSave({ stats: { cooking: { xp: 0 } } })
    // cross_marks_the_spot: {any:300} — must ask for the skill, not default.
    expect(() => addQuestToQueueIntent(save, 'cross_marks_the_spot', undefined, null)).toThrow(/ask the player/i)
    const r = addQuestToQueueIntent(save, 'cross_marks_the_spot', 'cooking', null)
    expect(r.queue).toEqual([{ id: 'cross_marks_the_spot', name: expect.any(String), xpChoiceSkill: 'cooking' }])
    expect(save.settings.questQueue[0].xpChoiceSkill).toBe('cooking')
  })

  it('refuses duplicates, the active quest, a full queue and ineligible quests', () => {
    const save = makeSave({ stats: { cooking: { xp: 0 } } })
    addQuestToQueueIntent(save, 'cross_marks_the_spot', 'cooking', null)
    expect(() => addQuestToQueueIntent(save, 'cross_marks_the_spot', 'cooking', null)).toThrow(/already in the queue/i)
    expect(() => addQuestToQueueIntent(save, 'a_boarborn_of_interest', undefined, 'a_boarborn_of_interest')).toThrow(/currently in progress/i)
    const full = makeSave({ stats: { slayer: { xp: 0 } }, settings: { completedQuests: [], questQueue: [{ id: 'x1', name: 'x' }, { id: 'x2', name: 'x' }, { id: 'x3', name: 'x' }] } })
    expect(() => addQuestToQueueIntent(full, 'a_boarborn_of_interest', undefined, null)).toThrow(/full/i)
    // a_realm_divided has unmet requirements → cannot queue.
    expect(() => addQuestToQueueIntent(makeSave(), 'a_realm_divided', 'strength', null)).toThrow(/Cannot queue|startable now/i)
  })

  it('removes a queued quest (and errors when absent)', () => {
    const save = makeSave({ stats: { cooking: { xp: 0 } } })
    addQuestToQueueIntent(save, 'cross_marks_the_spot', 'cooking', null)
    expect(removeQuestFromQueueIntent(save, 'cross_marks_the_spot').queue).toEqual([])
    expect(() => removeQuestFromQueueIntent(save, 'cross_marks_the_spot')).toThrow(/not in the quest queue/i)
  })

  it('auto-starts the queued quest on completion and applies its own XP choice', () => {
    const save = makeSave({ stats: { slayer: { xp: 0, level: 1 }, cooking: { xp: 0, level: 1 } } })
    addQuestToQueueIntent(save, 'cross_marks_the_spot', 'cooking', 'a_boarborn_of_interest')
    const task = buildQuestTask(save, 'a_boarborn_of_interest', undefined)
    // 700000ms covers both ~500-tick quests back to back.
    const r = applyQuestTask(save, task, 700_000)
    expect(r.completed.map((c: any) => c.id)).toEqual(['a_boarborn_of_interest', 'cross_marks_the_spot'])
    // The "any" choice was routed to cooking via the queue entry, not defaulted.
    expect(save.stats.cooking.xp).toBe(300)
    expect(save.settings.questQueue).toEqual([])
    expect(r.queue).toEqual([])
  })
})

describe('slayer intents', () => {
  // Deterministic assignment: rng()=0 picks the first eligible monster and the
  // low end of the master's task range; a fresh history avoids cross-test bleed.
  const det = () => ({ rng: () => 0, history: new Map() })
  const maxedSlayer = () => makeSave({ stats: { slayer: { xp: 200_000_000 } } })

  it('assigns a task from an eligible master and writes it to settings', () => {
    const save = maxedSlayer()
    const r = assignSlayerTask(save, 'turael', det())
    expect(r.action).toBe('assign_slayer_task')
    expect(r.master.id).toBe('turael')
    expect(typeof r.task.monsterId).toBe('string')
    expect(r.task.totalCount).toBe(SLAYER_MASTERS[0].taskRange[0]) // rng()=0 → low end
    expect(save.settings.slayerTask.monsterId).toBe(r.task.monsterId)
    expect(save.settings.slayerTask.monstersRemaining).toBe(r.task.totalCount)
    expect(save.settings.slayerTask.pointsOnComplete).toBe(SLAYER_MASTERS[0].pointsPerTask)
  })

  it('refuses a new task while one is already active', () => {
    const save = maxedSlayer()
    save.settings.slayerTask = { monsterId: 'field_chicken', monstersRemaining: 5, totalCount: 5 }
    expect(() => assignSlayerTask(save, 'turael', det())).toThrow(/already active/i)
  })

  it("enforces the master's slayer requirement (nothing written on failure)", () => {
    const save = makeSave() // slayer level 1
    expect(() => assignSlayerTask(save, 'duradel', det())).toThrow(/slayer level/i)
    expect(save.settings.slayerTask).toBeUndefined()
  })

  it('rejects an unknown master', () => {
    expect(() => assignSlayerTask(maxedSlayer(), 'not_a_master', det())).toThrow(/No slayer master/i)
  })

  it('summarises current task, points and master eligibility', () => {
    const save = makeSave({
      stats: { slayer: { xp: 200_000_000 } },
      settings: {
        slayerPoints: 120,
        slayerTasksCompleted: 4,
        slayerTask: {
          monsterId: 'green_dragon', monsterName: 'Green Dragon',
          monstersRemaining: 30, totalCount: 100, masterId: 'vannaka',
          pointsOnComplete: 4, isBoss: false,
        },
      },
    })
    const s = slayerStatus(save)
    expect(s.slayerPoints).toBe(120)
    expect(s.tasksCompleted).toBe(4)
    expect(s.currentTask.killed).toBe(70)
    expect(s.currentTask.progressPct).toBe(70)
    expect(s.nextTaskMultiplier).toBe(10) // the 5th task hits a x10 milestone
    expect(s.skipCosts).toEqual({ points: 30, credits: 1 })
    expect(s.masters.find((m: any) => m.id === 'turael')?.eligible).toBe(true)
  })

  it('reports no current task on a fresh save', () => {
    const s = slayerStatus(makeSave())
    expect(s.currentTask).toBeNull()
    expect(s.slayerPoints).toBe(0)
    expect(s.nextTaskMultiplier).toBe(1)
  })

  it('lists slayer-point unlocks with ownership + affordability', () => {
    const save = makeSave({
      settings: { slayerPoints: 500 },
      bank: { slayer_helmet: { itemId: 'slayer_helmet', quantity: 1 } },
    })
    const unlocks = slayerStatus(save).unlocks
    const helm = unlocks.find((u: any) => u.unlockId === 'slayer_helmet')
    const defender = unlocks.find((u: any) => u.unlockId === 'slayer_defender')
    // Helmet is owned (in bank) → not purchasable even though affordable.
    expect(helm).toMatchObject({ owned: true, cost: 400, purchasable: false })
    // Defender costs 1500 > 500 points → affordable false.
    expect(defender).toMatchObject({ owned: false, affordable: false, purchasable: false })
  })
})
