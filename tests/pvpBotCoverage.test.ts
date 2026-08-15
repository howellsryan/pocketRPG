// Wilderness bot ladder coverage — the world only spawns a bot the player may
// actually attack, which is one inside the ±PVP_LEVEL_BRACKET band
// (templateForCombatLevel in world/server/pvpBots.ts), so every reachable
// combat level (3..126) must have at least one bot template within that band.
// This test fails the moment adding/removing/re-statting a bot opens a stretch
// of the ladder with no opponent in it.

import { describe, it, expect } from 'vitest'
import { combatLevelFromLevels } from '../src/engine/combatLevel.js'
import { PVP_LEVEL_BRACKET } from '../world/shared/pvpArea'
import pvpBots from '../src/data/pvpBots.json' assert { type: 'json' }
import itemsData from '../src/data/items.json' assert { type: 'json' }
import spellsData from '../src/data/spells.json' assert { type: 'json' }
import { EQUIPMENT_SLOTS } from '../src/utils/constants.js'

// Fresh character (all level 1, HP 10) floors at CB 3; all-99 caps at 126.
const MIN_PLAYER_CB = 3
const MAX_PLAYER_CB = 126

// Compute each bot's combat level exactly the way the world does when it spawns
// one (world/server/pvpBots.ts botTemplateCombatLevel).
function botCombatLevel(template: any): number {
  return combatLevelFromLevels(template.stats)
}

describe('wilderness bot combat-level coverage', () => {
  const botLevels = pvpBots.bots.map((b: any) => ({ id: b.id, cb: botCombatLevel(b) }))

  it('every combat level from 3 to 126 has at least one bot within ±10', () => {
    const gaps: number[] = []
    for (let cb = MIN_PLAYER_CB; cb <= MAX_PLAYER_CB; cb++) {
      const covered = botLevels.some((b) => Math.abs(b.cb - cb) <= PVP_LEVEL_BRACKET)
      if (!covered) gaps.push(cb)
    }
    expect(gaps, `no bot within ±${PVP_LEVEL_BRACKET} of combat level(s): ${gaps.join(', ')}`).toEqual([])
  })

  it('bot combat levels stay inside the playable range', () => {
    for (const bot of botLevels) {
      expect(bot.cb, bot.id).toBeGreaterThanOrEqual(MIN_PLAYER_CB)
      expect(bot.cb, bot.id).toBeLessThanOrEqual(MAX_PLAYER_CB)
    }
  })
})

describe('pvp bot template integrity', () => {
  it('every bot has exactly 28 inventory slots', () => {
    for (const bot of pvpBots.bots) {
      expect(bot.inventory.length, bot.id).toBe(28)
    }
  })

  it('every bot meets the requirements of its own equipment', () => {
    for (const bot of pvpBots.bots) {
      for (const [slot, entry] of Object.entries(bot.equipment as Record<string, any>)) {
        if (!entry) continue
        const item = (itemsData as any)[entry.itemId]
        expect(item, `${bot.id} ${slot} ${entry.itemId}`).toBeDefined()
        for (const [skill, required] of Object.entries(item.requirements || {})) {
          const have = (bot.stats as any)[skill] ?? 1
          expect(have, `${bot.id} ${entry.itemId} needs ${skill} ${required}`).toBeGreaterThanOrEqual(required as number)
        }
      }
    }
  })

  it('every bot wears its kit in a real equipment slot', () => {
    // `hands` / `feet` are not slots: getEquipmentBonuses walks EQUIPMENT_SLOTS,
    // so gear filed under any other key is worn for show and adds nothing.
    for (const bot of pvpBots.bots) {
      for (const [slot, entry] of Object.entries(bot.equipment as Record<string, any>)) {
        expect(EQUIPMENT_SLOTS, `${bot.id} ${slot}`).toContain(slot)
        expect((itemsData as any)[entry.itemId].slot, `${bot.id} ${entry.itemId}`).toBe(slot)
      }
    }
  })

  it('every bot meets the requirements of the weapons it carries to swap to', () => {
    for (const bot of pvpBots.bots) {
      for (const slot of bot.inventory) {
        const item = slot ? (itemsData as any)[(slot as any).itemId] : null
        if (item?.slot !== 'weapon') continue
        for (const [skill, required] of Object.entries(item.requirements || {})) {
          expect((bot.stats as any)[skill] ?? 1, `${bot.id} ${item.id} needs ${skill} ${required}`)
            .toBeGreaterThanOrEqual(required as number)
        }
      }
    }
  })

  it('every ranged bot carries ammunition its own weapon accepts', () => {
    for (const bot of pvpBots.bots) {
      const weapon = (itemsData as any)[bot.equipment.weapon?.itemId]
      if (weapon?.attackStyle !== 'ranged' || !weapon.ammoType || weapon.scaleCharged) continue
      const ammo = (bot.equipment as any).ammo
      expect(ammo, `${bot.id} wields ${weapon.id} with no ammo`).toBeDefined()
      const ammoItem = (itemsData as any)[ammo.itemId]
      expect(ammoItem.ammoKind, `${bot.id} ${ammo.itemId} vs ${weapon.id}`).toBe(weapon.ammoType)
      expect(ammo.quantity).toBeGreaterThan(0)
      const required = weapon.requiredAmmoIds ?? (weapon.requiredAmmoId ? [weapon.requiredAmmoId] : null)
      if (required) expect(required).toContain(ammo.itemId)
    }
  })

  it('every magic bot can actually cast — a powered staff, or a spell it has the runes and level for', () => {
    // A magic weapon that is not a powered staff needs a selected spell, or the
    // world refuses every swing it takes ("you need to select a spell").
    for (const bot of pvpBots.bots) {
      const weapon = (itemsData as any)[bot.equipment.weapon?.itemId]
      if (weapon?.attackStyle !== 'magic' || weapon.poweredStaff) continue
      const spell = (spellsData as any)[(bot as any).spell]
      expect(spell, `${bot.id} wields ${weapon.id} with no castable spell`).toBeDefined()
      expect(bot.stats.magic, `${bot.id} cannot cast ${spell.id}`).toBeGreaterThanOrEqual(spell.levelReq ?? 1)
      for (const [runeId, qty] of Object.entries(spell.runeReq || {})) {
        const carried = bot.inventory.reduce((sum: number, s: any) => sum + (s?.itemId === runeId ? s.quantity : 0), 0)
        expect(carried, `${bot.id} carries no ${runeId} for ${spell.id}`).toBeGreaterThanOrEqual(qty as number)
      }
    }
  })

  it('bot ids and usernames are unique', () => {
    const ids = pvpBots.bots.map((b: any) => b.id)
    const names = pvpBots.bots.map((b: any) => b.username)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(names).size).toBe(names.length)
  })

  it('every bot has a valid combat stance and food to survive on', () => {
    const VALID_STANCES = new Set(['accurate', 'aggressive', 'defensive', 'controlled', 'rapid', 'longrange'])
    for (const bot of pvpBots.bots) {
      expect(VALID_STANCES.has(bot.combatStance), `${bot.id} stance ${bot.combatStance}`).toBe(true)
      const hasFood = bot.inventory.some((slot: any) => {
        if (!slot) return false
        const item = (itemsData as any)[slot.itemId]
        return item && (item.heals > 0 || item.healsHP > 0)
      })
      expect(hasFood, `${bot.id} carries no food`).toBe(true)
    }
  })
})
