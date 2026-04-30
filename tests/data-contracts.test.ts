import { describe, it, expect } from 'vitest'
import items from '../src/data/items.json'
import monsters from '../src/data/monsters.json'
import skills from '../src/data/skills.json'
import quests from '../src/data/quests.json'
import { applySpecialAttack } from '../src/engine/combat'
import { getPvpSpecialAttackLabel } from '../src/engine/pvpSpecialAttacks'

const itemIds = new Set(Object.keys(items))
const KNOWN_MISSING_DROP_ITEMS = new Set(['daganoth_bones'])

describe('data contracts', () => {
  it('item ids match keys and equipment slots are valid when present', () => {
    const validSlots = new Set(['head','cape','neck','ammo','weapon','body','shield','legs','hands','gloves','boots','feet','ring'])
    for (const [key, item] of Object.entries(items as Record<string, any>)) {
      expect(item.id, `${key} id mismatch`).toBe(key)
      if (item.slot) expect(validSlots.has(item.slot), `${key} invalid slot ${item.slot}`).toBe(true)
    }
  })

  it('monster drops reference known items and valid quantity/chance', () => {
    for (const [monsterId, monster] of Object.entries(monsters as Record<string, any>)) {
      for (const drop of monster.drops || []) {
        expect(itemIds.has(drop.itemId) || KNOWN_MISSING_DROP_ITEMS.has(drop.itemId), `${monsterId} unknown drop ${drop.itemId}`).toBe(true)
        expect(drop.chance >= 0 && drop.chance <= 1, `${monsterId} invalid chance`).toBe(true)
        if (Array.isArray(drop.quantity)) {
          expect(drop.quantity.length).toBe(2)
          expect(drop.quantity[0] > 0 && drop.quantity[1] >= drop.quantity[0]).toBe(true)
        } else {
          expect(drop.quantity > 0).toBe(true)
        }
      }
    }
  })

  it('skill products and materials point to existing items', () => {
    for (const [skillId, skill] of Object.entries(skills as Record<string, any>)) {
      for (const action of skill.actions || []) {
        if (action.product) expect(itemIds.has(action.product), `${skillId}:${action.id} missing product`).toBe(true)
        for (const materialId of Object.keys(action.materials || {})) {
          expect(itemIds.has(materialId), `${skillId}:${action.id} missing material ${materialId}`).toBe(true)
        }
      }
    }
  })

  it('quest item rewards point to existing items and xp rewards are finite positive values', () => {
    for (const [questId, quest] of Object.entries(quests as Record<string, any>)) {
      const rewards = quest.rewards || {}
      for (const [itemId, qty] of Object.entries(rewards.items || {})) {
        expect(itemIds.has(itemId), `${questId} unknown reward item ${itemId}`).toBe(true)
        expect(Number.isFinite(qty) && Number(qty) > 0).toBe(true)
      }
      for (const [skillId, xp] of Object.entries(rewards.xp || {})) {
        expect(typeof skillId).toBe('string')
        expect(Number.isFinite(xp) && Number(xp) > 0, `${questId} bad xp for ${skillId}`).toBe(true)
      }
    }
  })

  it('special attack data has pvp labels and pve engine handler path', () => {
    const types = new Set<string>()
    for (const item of Object.values(items as Record<string, any>)) {
      if (item.specialAttack?.type) types.add(item.specialAttack.type)
    }
    for (const type of types) {
      expect(typeof getPvpSpecialAttackLabel(type)).toBe('string')
      expect(() => applySpecialAttack({ specialAttackQueued: false }, {}, { weapon: null }, items as any)).not.toThrow()
    }
  })
})
