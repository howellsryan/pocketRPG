import { describe, expect, it } from 'vitest'
import minigames from '../src/data/minigames.json'
import items from '../src/data/items.json'
import { getEquippedSkillXpMultiplier, hasToolForSkill } from '../src/engine/skilling.js'
import { getXPForLevel } from '../src/engine/experience.js'
import { checkEquipRequirements } from '../src/engine/equipment.js'
import { simulateIdleGather } from '../src/engine/idleEngine.js'

describe('new minigame tasks', () => {
  it('includes expected tasks and durations', () => {
    const byName = new Map(minigames.tasks.map(t => [t.name, t]))
    expect(byName.get('Obtain decorative armour')?.hours).toBe(2)
    expect(byName.get('Grind Angler Net')?.hours).toBe(5)
    expect(byName.get('Obtain Imbued God Cape')?.hours).toBe(2)
    expect(byName.get('Grind for Void King Set')?.hours).toBe(6)
    expect(byName.get('Grind for Void King Set')?.rewardItems).toEqual(['void_knight_helm', 'void_knight_top', 'void_knight_robe', 'void_knight_gloves'])
    expect(byName.get('Obtain decorative armour')?.minigame).toBe('castle_wars')
    expect(byName.get('Grind Angler Net')?.minigame).toBe('fishing_trawler')
    expect(byName.get('Obtain Imbued God Cape')?.minigame).toBe('mage_arena')
    expect(byName.get('Grind for Void King Set')?.minigame).toBe('pest_control')
  })
})

describe('reward item definitions', () => {
  it('defines decorative top and imbued cape correctly', () => {
    expect(items.decorative_top.defenceBonus).toEqual({ stab: 20, slash: 20, crush: 20, magic: 20, ranged: 20 })
    expect(items.decorative_top.shopValue).toBe(1_000_000)
    expect(items.imbued_god_cape.requirements.magic).toBe(50)
    expect(items.imbued_god_cape.attackBonus.magic).toBe(15)
    expect(items.imbued_god_cape.defenceBonus.magic).toBe(15)
    expect(items.imbued_god_cape.otherBonus.magicDamage).toBe(3)
  })

  it('defines void pieces with shared requirements', () => {
    for (const id of ['void_hat','void_body','void_bottoms','void_gloves'] as const) {
      expect(items[id].requirements).toEqual({ defence: 42, attack: 42, strength: 42, ranged: 42, hitpoints: 42, magic: 42 })
      expect(items[id].attackBonus).toEqual({ stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 })
      expect(items[id].isUntradeable).toBe(true)
      expect(items[id].shopValue).toBe(1_000_000)
    }
  })
})

describe('angler net fishing integration', () => {
  it('is fishing tool with harpoon timing and equipped xp bonus', () => {
    expect(items.angler_net.toolFor).toBe('fishing')
    expect(items.angler_net.speedMultiplier).toBe(items.harpoon.speedMultiplier)
    const multiplier = getEquippedSkillXpMultiplier('fishing', { weapon: { itemId: 'angler_net' } }, items as any)
    expect(multiplier).toBe(1.1)
    expect(getEquippedSkillXpMultiplier('fishing', {}, items as any)).toBe(1)
  })

  it('qualifies as tool when equipped only or in inventory', () => {
    const stats = { fishing: { xp: getXPForLevel(99) } } as any
    expect(hasToolForSkill('fishing', { weapon: { itemId: 'angler_net' } } as any, [], items as any, stats)).toBe(true)
    expect(hasToolForSkill('fishing', {} as any, [{ itemId: 'angler_net', quantity: 1 }] as any, items as any, stats)).toBe(true)
  })
})

describe('void set idle reward', () => {
  it('grants all 4 void king pieces when the idle grind completes', () => {
    const task = minigames.tasks.find(t => t.id === 'pc_void_set')!
    const idleTask = { type: 'gather', gatherTask: task, bankingEnabled: true }
    const sixHoursMs = 6 * 60 * 60 * 1000 + 1000
    const result = simulateIdleGather(idleTask as any, sixHoursMs, [], {}, items as any, {})
    expect(result).not.toBeNull()
    expect(result!.itemsGained).toHaveProperty('void_knight_helm', 1)
    expect(result!.itemsGained).toHaveProperty('void_knight_top', 1)
    expect(result!.itemsGained).toHaveProperty('void_knight_robe', 1)
    expect(result!.itemsGained).toHaveProperty('void_knight_gloves', 1)
    // Must not award only the product key
    expect(Object.keys(result!.itemsGained)).toHaveLength(4)
  })

  it('returns null when not enough time has elapsed', () => {
    const task = minigames.tasks.find(t => t.id === 'pc_void_set')!
    const idleTask = { type: 'gather', gatherTask: task, bankingEnabled: true }
    const oneHourMs = 1 * 60 * 60 * 1000
    const result = simulateIdleGather(idleTask as any, oneHourMs, [], {}, items as any, {})
    expect(result).toBeNull()
  })

  it('rewardItems derivation: tasks with rewardItems yield all entries; tasks without yield product', () => {
    // Mirror the getMinigameRewardEntries logic used by grantMinigameTaskRewards
    function deriveRewards(task: any) {
      const qty = task.qty || 1
      if (Array.isArray(task.rewardItems) && task.rewardItems.length > 0) {
        return task.rewardItems.map((itemId: string) => ({ itemId, qty }))
      }
      return task.product ? [{ itemId: task.product, qty }] : []
    }
    const voidTask = minigames.tasks.find(t => t.id === 'pc_void_set')!
    const voidRewards = deriveRewards(voidTask)
    expect(voidRewards.map((r: any) => r.itemId)).toEqual([
      'void_knight_helm', 'void_knight_top', 'void_knight_robe', 'void_knight_gloves'
    ])

    const haloTask = minigames.tasks.find(t => t.id === 'cw_halo')!
    const haloRewards = deriveRewards(haloTask)
    expect(haloRewards).toEqual([{ itemId: 'halo', qty: 1 }])
  })
})

describe('equip requirements', () => {
    it('enforces imbued god cape magic and void stat requirements', () => {
    const low = { attack:{xp:0},strength:{xp:0},defence:{xp:0},ranged:{xp:0},hitpoints:{xp:0},magic:{xp:getXPForLevel(49)-1} } as any
    const ok = { attack:{xp:getXPForLevel(42)},strength:{xp:getXPForLevel(42)},defence:{xp:getXPForLevel(42)},ranged:{xp:getXPForLevel(42)},hitpoints:{xp:getXPForLevel(42)},magic:{xp:getXPForLevel(50)} } as any
    expect(checkEquipRequirements(items.imbued_god_cape as any, low, new Set())).toBeTruthy()
    expect(checkEquipRequirements(items.imbued_god_cape as any, ok, new Set())).toBeNull()
    expect(checkEquipRequirements(items.void_body as any, low, new Set())).toBeTruthy()
    expect(checkEquipRequirements(items.void_body as any, ok, new Set())).toBeNull()
  })
})
