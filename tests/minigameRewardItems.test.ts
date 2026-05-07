import { describe, expect, it } from 'vitest'
import minigames from '../src/data/minigames.json'
import items from '../src/data/items.json'
import { getEquippedSkillXpMultiplier, hasToolForSkill } from '../src/engine/skilling.js'
import { getXPForLevel } from '../src/engine/experience.js'
import { checkEquipRequirements } from '../src/engine/equipment.js'

describe('new minigame tasks', () => {
  it('includes expected tasks and durations', () => {
    const byName = new Map(minigames.tasks.map(t => [t.name, t]))
    expect(byName.get('Obtain decorative armour')?.hours).toBe(2)
    expect(byName.get('Grind Angler Net')?.hours).toBe(5)
    expect(byName.get('Obtain Imbued God Cape')?.hours).toBe(2)
    expect(byName.get('Grind full void')?.hours).toBe(10)
    expect(byName.get('Grind full void')?.products).toEqual({ void_hat: 1, void_body: 1, void_bottoms: 1, void_gloves: 1 })
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
    expect(multiplier).toBe(1.05)
    expect(getEquippedSkillXpMultiplier('fishing', {}, items as any)).toBe(1)
  })

  it('qualifies as tool when equipped only or in inventory', () => {
    const stats = { fishing: { xp: getXPForLevel(99) } } as any
    expect(hasToolForSkill('fishing', { weapon: { itemId: 'angler_net' } } as any, [], items as any, stats)).toBe(true)
    expect(hasToolForSkill('fishing', {} as any, [{ itemId: 'angler_net', quantity: 1 }] as any, items as any, stats)).toBe(true)
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
